"""State 12 — end-to-end through the whole chain.

    httpx -> FastAPI -> Temporal (real, time-skipping) -> activities -> LangGraph -> fake model
          -> Postgres -> API / SSE

Nothing is stubbed except the model provider, which is a deterministic in-process client (Rule 34).
The Temporal worker runs the *real* activities against the *real* database, so this is the test that
would catch a break anywhere between the HTTP edge and the durable event table.

Requires both `TEST_DATABASE_URL` and the Temporal test server:

    export TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:55432/botbuilder_test
    uv run pytest tests/integration/test_end_to_end.py
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx
import pytest
import pytest_asyncio
from app.activities.container import ActivityContainer, install, reset
from app.api.app import create_app
from app.infrastructure.config import Settings
from app.infrastructure.database.session import Database
from app.infrastructure.models.base import Completion, GenerationRequest, StreamChunk
from app.infrastructure.temporal.starter import TemporalRunStarter
from app.infrastructure.temporal.worker import AGENT_ACTIVITIES
from app.workflows.run_agent import RunAgentWorkflow
from sqlalchemy import text
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
REQUIRED = os.getenv("TEMPORAL_TEST_SERVER") == "1"
PREFIX = "/api/v1"
SECRET = "e2e-test-secret-long-enough-for-hmac-sha256"

if not TEST_DATABASE_URL:  # pragma: no cover - import-time guard
    pytest.skip("TEST_DATABASE_URL is not set", allow_module_level=True)

_TRUNCATE = (
    "TRUNCATE users, workspaces, runs, run_events, messages, conversations, bots, bot_versions, "
    "tools, tool_versions, knowledge_sources, files, artifacts RESTART IDENTITY CASCADE"
)


class ScriptedModel:
    """A deterministic provider: replies with fixed text, optionally after a delay.

    The delay is what makes real cancellation observable — the run is genuinely mid-model when the
    user's cancel arrives.
    """

    provider = "fake"

    def __init__(self, text: str, *, delay: float = 0.0) -> None:
        self.text = text
        self.delay = delay

    async def complete(self, request: GenerationRequest) -> Completion:
        return Completion(text=self.text, input_tokens=3, output_tokens=4, model=request.model.model_id)

    async def stream(self, request: GenerationRequest) -> AsyncIterator[StreamChunk]:
        if self.delay:
            await asyncio.sleep(self.delay)
        yield StreamChunk(text=self.text)
        yield StreamChunk(finish_reason="stop", usage={"input_tokens": 3, "output_tokens": 4})


@dataclass
class Harness:
    http: httpx.AsyncClient
    model: ScriptedModel
    database: Database

    async def sign_up(self) -> dict[str, str]:
        response = await self.http.post(
            f"{PREFIX}/auth/register",
            json={"email": "e2e@example.com", "name": "Owner", "password": "swordfish-123"},
        )
        assert response.status_code == 201, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def temporal_env():
    try:
        async with await WorkflowEnvironment.start_time_skipping() as env:
            yield env
    except Exception as exc:
        if isinstance(exc, pytest.skip.Exception):
            raise
        if REQUIRED and isinstance(exc, (AssertionError, RuntimeError)):
            raise
        pytest.skip(f"Temporal test environment unavailable: {type(exc).__name__}: {exc}")


@pytest_asyncio.fixture(loop_scope="module")
async def harness(temporal_env, tmp_path) -> AsyncIterator[Harness]:
    settings = Settings(
        _env_file=None,
        environment="test",
        log_level="WARNING",
        jwt_secret=SECRET,
        database_url=TEST_DATABASE_URL,
        data_dir=str(tmp_path / "data"),
    )
    database = Database(settings)
    queue = f"e2e-{uuid.uuid4().hex[:8]}"
    model = ScriptedModel("Hello from the model")

    install(
        ActivityContainer(
            settings,
            database,
            model_client_builder=lambda _model: model,
            tool_executor_builder=None,
        )
    )

    async with database.engine.begin() as connection:
        await connection.execute(text(_TRUNCATE))

    app = create_app(settings)
    # Both API and worker share one engine on this event loop, so request commits are visible to
    # activities immediately (no second pool, no cross-loop surprises).
    app.state.database = database
    app.state.run_starter = TemporalRunStarter(temporal_env.client, task_queue=queue)

    transport = httpx.ASGITransport(app=app)
    async with (
        Worker(
            temporal_env.client,
            task_queue=queue,
            workflows=[RunAgentWorkflow],
            activities=AGENT_ACTIVITIES,
        ),
        httpx.AsyncClient(transport=transport, base_url="http://e2e") as http,
    ):
        yield Harness(http=http, model=model, database=database)

    reset()
    await database.dispose()


async def _create_bot(http: httpx.AsyncClient, headers: dict, **payload) -> dict:
    body = {"name": "E2E Bot", **payload}
    response = await http.post(f"{PREFIX}/bots", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def _wait_for_run(http: httpx.AsyncClient, headers: dict, run_id: str, *, timeout: float = 20.0):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        run = (await http.get(f"{PREFIX}/runs/{run_id}", headers=headers)).json()
        if run["status"] in {"succeeded", "failed", "cancelled", "timed_out"}:
            return run
        await asyncio.sleep(0.1)
    raise AssertionError(f"run {run_id} did not reach a terminal state in {timeout}s")


class TestEndToEnd:
    async def test_chat_message_produces_a_persisted_reply_and_events(self, harness: Harness) -> None:
        headers = await harness.sign_up()
        bot = await _create_bot(harness.http, headers, bot_type="agent")
        conversation = (
            await harness.http.post(
                f"{PREFIX}/conversations",
                headers=headers,
                json={"bot_id": bot["id"], "title": "Hello"},
            )
        ).json()

        sent = await harness.http.post(
            f"{PREFIX}/conversations/{conversation['id']}/messages",
            headers=headers,
            json={"content": "say hello"},
        )
        assert sent.status_code == 202, sent.text
        run_id = sent.json()["run_id"]

        run = await _wait_for_run(harness.http, headers, run_id)
        assert run["status"] == "succeeded", run
        assert run["output"] == "Hello from the model"

        detail = (
            await harness.http.get(f"{PREFIX}/conversations/{conversation['id']}", headers=headers)
        ).json()
        assistant = detail["messages"][-1]
        assert assistant["sender"] == "bot"
        assert assistant["content"] == "Hello from the model"
        assert assistant["isStreaming"] is False

        events = (await harness.http.get(f"{PREFIX}/runs/{run_id}/events", headers=headers)).json()
        types = [event["type"] for event in events]
        assert "run.started" in types
        assert "agent.started" in types
        assert "run.completed" in types
        assert [event["seq"] for event in events] == list(range(1, len(events) + 1))

    async def test_the_run_is_replayable_over_sse(self, harness: Harness) -> None:
        headers = await harness.sign_up()
        bot = await _create_bot(harness.http, headers)
        run_id = (
            await harness.http.post(
                f"{PREFIX}/runs", headers=headers, json={"bot_id": bot["id"], "input": "hi"}
            )
        ).json()["run_id"]
        await _wait_for_run(harness.http, headers, run_id)

        async with harness.http.stream("GET", f"{PREFIX}/runs/{run_id}/stream", headers=headers) as response:
            assert response.status_code == 200
            lines = [line async for line in response.aiter_lines() if line]

        assert any(line.startswith("event: run.completed") for line in lines)
        assert any(line.startswith("id: ") for line in lines)

    async def test_cancellation_mid_run_terminates_it(self, harness: Harness) -> None:
        harness.model.delay = 30.0  # the model blocks mid-run
        try:
            headers = await harness.sign_up()
            bot = await _create_bot(harness.http, headers)
            run_id = (
                await harness.http.post(
                    f"{PREFIX}/runs", headers=headers, json={"bot_id": bot["id"], "input": "slow"}
                )
            ).json()["run_id"]

            # Let the worker actually begin executing the agent before cancelling.
            await asyncio.sleep(0.5)
            cancelled = await harness.http.post(f"{PREFIX}/runs/{run_id}/cancel", headers=headers)
            assert cancelled.status_code == 202
            assert cancelled.json()["status"] == "cancelled"

            run = await _wait_for_run(harness.http, headers, run_id)
            assert run["status"] == "cancelled"
            events = (await harness.http.get(f"{PREFIX}/runs/{run_id}/events", headers=headers)).json()
            assert "run.completed" not in [event["type"] for event in events]
        finally:
            harness.model.delay = 0.0

    async def test_a_deterministic_bot_answers_without_a_model(self, harness: Harness) -> None:
        """The `simple` path must never reach the model gateway, even in the full stack (Rule 4)."""
        headers = await harness.sign_up()
        bot = await _create_bot(
            harness.http,
            headers,
            bot_type="simple",
            deterministic_rules=[{"trigger": "hello", "response": "hi there"}],
        )
        conversation = (
            await harness.http.post(f"{PREFIX}/conversations", headers=headers, json={"bot_id": bot["id"]})
        ).json()
        run_id = (
            await harness.http.post(
                f"{PREFIX}/conversations/{conversation['id']}/messages",
                headers=headers,
                json={"content": "hello"},
            )
        ).json()["run_id"]

        run = await _wait_for_run(harness.http, headers, run_id)
        assert run["status"] == "succeeded", run
        assert "hi there" in run["output"]
