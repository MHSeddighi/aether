"""State 9 — the run event stream.

The contract this pins down (Rule 28): every event carries a monotonic `seq`, a client that
reconnects with the last id it saw receives exactly what it missed, and the stream ends after a
terminal event instead of hanging forever.

These tests drive the real `RunEventStream` against the in-memory repository fake, and the real
router through `TestClient` (which streams the response body).
"""

from __future__ import annotations

import asyncio
import json

import pytest
from app.api.deps import (
    get_bot_service,
    get_conversation_service,
    get_current_user,
    get_event_stream,
    get_knowledge_service,
    get_model_service,
    get_run_service,
    get_tool_service,
)
from app.application.bot_service import BotService
from app.application.conversation_service import ConversationService
from app.application.event_stream import RunEventStream
from app.application.knowledge_service import KnowledgeService
from app.application.model_service import ModelService
from app.application.run_service import RunService
from app.application.tool_service import ToolService
from app.domain.accounts import User
from app.domain.ids import new_id
from app.infrastructure.config import Settings
from app.infrastructure.models.gateway import default_model_config
from fastapi.testclient import TestClient

from tests.fakes import (
    FakeBotRepository,
    FakeConversationRepository,
    FakeKnowledgeRepository,
    FakeRunRepository,
    FakeRunStarter,
    FakeToolRepository,
    InMemoryBlobStore,
)

PREFIX = "/api/v1"

SETTINGS = Settings(
    _env_file=None,
    environment="test",
    log_level="WARNING",
    jwt_secret="s" * 40,
    database_url="postgresql+asyncpg://unused/unused",
    # Keep the tests fast: the poll only matters when the stream is waiting for a terminal event.
    event_poll_interval_seconds=0.01,
)


@pytest.fixture
def runs_repo() -> FakeRunRepository:
    return FakeRunRepository()


@pytest.fixture
def stream(runs_repo: FakeRunRepository) -> RunEventStream:
    return RunEventStream(runs_repo, poll_interval=0.01, max_seconds=5.0)


async def add_event(repo: FakeRunRepository, run_id: str, event_type: str, **data) -> None:
    from app.domain.runs import RunEvent, RunEventType

    await repo.append_event(
        RunEvent(event_id=new_id("evt"), run_id=run_id, seq=1, type=RunEventType(event_type), data=data)
    )


async def seed_run(repo: FakeRunRepository, *, status=None, workspace_id: str = "ws_1"):
    from datetime import UTC, datetime

    from app.domain.models import deterministic_config
    from app.domain.runs import Run, RunStatus

    return await repo.add(
        Run(
            run_id=new_id("run"),
            workspace_id=workspace_id,
            bot_id="bot_1",
            bot_version_id="botver_1",
            bot_version="1.0.0",
            model=deterministic_config(),
            status=status or RunStatus.RUNNING,
            input="hello",
            created_at=datetime.now(UTC),
        )
    )


class TestRunEventStream:
    async def test_history_returns_events_oldest_first(self, runs_repo, stream) -> None:
        run = await seed_run(runs_repo)
        for kind in ("run.started", "agent.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)
        events = await stream.history(run.run_id)
        assert [e.type.value for e in events] == ["run.started", "agent.started", "run.completed"]
        assert [e.seq for e in events] == [1, 2, 3]

    async def test_history_resumes_after_a_sequence_number(self, runs_repo, stream) -> None:
        run = await seed_run(runs_repo)
        for kind in ("run.started", "agent.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)
        assert [e.seq for e in await stream.history(run.run_id, after_seq=1)] == [2, 3]

    async def test_follow_yields_new_events_as_they_are_appended(self, runs_repo, stream) -> None:
        run = await seed_run(runs_repo)
        await add_event(runs_repo, run.run_id, "run.started")

        received = []

        async def consume() -> None:
            async for event in stream.follow(run.run_id):
                received.append(event)

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.02)
        await add_event(runs_repo, run.run_id, "agent.started")
        await asyncio.sleep(0.02)
        await add_event(runs_repo, run.run_id, "run.completed")
        await asyncio.wait_for(task, timeout=2)
        assert [e.type.value for e in received] == ["run.started", "agent.started", "run.completed"]

    async def test_follow_ends_after_a_terminal_event(self, runs_repo, stream) -> None:
        """The stream must close itself; a client polling a finished run should not wait forever."""
        run = await seed_run(runs_repo)
        await add_event(runs_repo, run.run_id, "run.completed")

        async def consume() -> list:
            return [event async for event in stream.follow(run.run_id)]

        events = await asyncio.wait_for(consume(), timeout=2)
        assert [e.type.value for e in events] == ["run.completed"]

    async def test_follow_closes_when_it_catches_up_with_a_finished_run(self, runs_repo, stream) -> None:
        """Reconnecting after the run ended: send the backlog, then close instead of hanging."""
        from app.domain.runs import RunStatus

        run = await seed_run(runs_repo, status=RunStatus.SUCCEEDED)
        await add_event(runs_repo, run.run_id, "run.completed")

        async def consume() -> list:
            return [event async for event in stream.follow(run.run_id)]

        assert await asyncio.wait_for(consume(), timeout=2) != []

    async def test_follow_resumes_from_the_last_seen_sequence(self, runs_repo, stream) -> None:
        run = await seed_run(runs_repo)
        for kind in ("run.started", "agent.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)

        async def consume() -> list:
            return [event async for event in stream.follow(run.run_id, after_seq=1)]

        resumed = await asyncio.wait_for(consume(), timeout=2)
        assert [e.type.value for e in resumed] == ["agent.started", "run.completed"]
        assert [e.seq for e in resumed] == [2, 3], "no duplicates and no gaps after a reconnect"

    async def test_sequence_numbers_are_gap_free(self, runs_repo, stream) -> None:
        run = await seed_run(runs_repo)
        for _ in range(7):
            await add_event(runs_repo, run.run_id, "agent.step.started")
        await add_event(runs_repo, run.run_id, "run.completed")
        seqs = [e.seq for e in await stream.history(run.run_id)]
        assert seqs == list(range(1, 9))

    async def test_event_payload_is_the_frontend_shape(self, runs_repo, stream) -> None:
        run = await seed_run(runs_repo)
        await add_event(runs_repo, run.run_id, "run.started", botId="bot_1")
        payload = (await stream.history(run.run_id))[0].to_payload()
        assert set(payload) == {"id", "runId", "seq", "type", "ts", "data"}
        assert payload["type"] == "run.started"
        assert payload["data"] == {"botId": "bot_1"}

    async def test_unknown_run_yields_nothing(self, runs_repo, stream) -> None:
        assert [e async for e in stream.follow("run_missing")] == []

    async def test_stream_is_bounded_even_without_a_terminal_event(self, runs_repo) -> None:
        """The backstop: a run that never terminates must not hold a connection forever."""
        run = await seed_run(runs_repo)
        bounded = RunEventStream(runs_repo, poll_interval=0.001, max_seconds=0.05)

        async def consume() -> list:
            return [event async for event in bounded.follow(run.run_id)]

        assert await asyncio.wait_for(consume(), timeout=2) == []


class TestEventRoutes:
    @pytest.fixture
    def client(self, runs_repo: FakeRunRepository) -> TestClient:
        from app.api.app import create_app

        app = create_app(SETTINGS)
        bots = FakeBotRepository()
        conversations = FakeConversationRepository()

        async def build_stream() -> RunEventStream:
            return RunEventStream(runs_repo, poll_interval=0.01, max_seconds=5.0)

        async def fake_user() -> User:
            return User(
                user_id="usr_1",
                email="o@e.com",
                name="O",
                workspace_id="ws_1",
                password_hash="x",
            )

        app.dependency_overrides.update(
            {
                get_bot_service: lambda: BotService(bots),
                get_tool_service: lambda: ToolService(FakeToolRepository()),
                get_knowledge_service: lambda: KnowledgeService(
                    FakeKnowledgeRepository(), InMemoryBlobStore()
                ),
                get_conversation_service: lambda: ConversationService(conversations),
                get_run_service: lambda: RunService(
                    runs_repo, BotService(bots), FakeRunStarter(), conversations
                ),
                get_event_stream: build_stream,
                get_model_service: lambda: ModelService(
                    lambda name: _EmptyCatalog(), default_model_config(SETTINGS), ()
                ),
                get_current_user: fake_user,
            }
        )
        return TestClient(app, raise_server_exceptions=False)

    async def test_events_endpoint_returns_history_with_seq(self, client, runs_repo) -> None:
        run = await seed_run(runs_repo)
        for kind in ("run.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)
        body = client.get(f"{PREFIX}/runs/{run.run_id}/events").json()
        assert [e["type"] for e in body] == ["run.started", "run.completed"]
        assert [e["seq"] for e in body] == [1, 2]

    async def test_events_endpoint_honours_after_seq(self, client, runs_repo) -> None:
        run = await seed_run(runs_repo)
        for kind in ("run.started", "agent.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)
        body = client.get(f"{PREFIX}/runs/{run.run_id}/events", params={"after_seq": 2}).json()
        assert [e["seq"] for e in body] == [3]

    async def test_events_are_empty_for_a_run_with_no_events(self, client, runs_repo) -> None:
        run = await seed_run(runs_repo)
        assert client.get(f"{PREFIX}/runs/{run.run_id}/events").json() == []

    async def test_unknown_run_events_are_404(self, client) -> None:
        assert client.get(f"{PREFIX}/runs/run_missing/events").status_code == 404

    async def test_events_require_authentication(self, runs_repo) -> None:
        from app.api.app import create_app

        app = create_app(SETTINGS)
        with TestClient(app, raise_server_exceptions=False) as client:
            assert client.get(f"{PREFIX}/runs/run_x/events").status_code == 401
            assert client.get(f"{PREFIX}/runs/run_x/stream").status_code == 401

    async def test_stream_emits_sse_frames_with_id_and_event(self, client, runs_repo) -> None:
        run = await seed_run(runs_repo)
        for kind in ("run.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)
        with client.stream("GET", f"{PREFIX}/runs/{run.run_id}/stream") as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            frames = _read_frames(response)
        assert _event_names(frames) == ["run.started", "run.completed"]
        assert _ids(frames) == ["1", "2"]

    async def test_stream_resumes_from_last_event_id(self, client, runs_repo) -> None:
        """The browser sends `Last-Event-ID` automatically on reconnect; the client must receive
        exactly the events it missed."""
        run = await seed_run(runs_repo)
        for kind in ("run.started", "agent.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)
        with client.stream(
            "GET", f"{PREFIX}/runs/{run.run_id}/stream", headers={"Last-Event-ID": "1"}
        ) as response:
            frames = _read_frames(response)
        assert _event_names(frames) == ["agent.started", "run.completed"]

    async def test_stream_falls_back_to_after_seq_when_the_header_is_garbage(self, client, runs_repo) -> None:
        run = await seed_run(runs_repo)
        for kind in ("run.started", "run.completed"):
            await add_event(runs_repo, run.run_id, kind)
        with client.stream(
            "GET", f"{PREFIX}/runs/{run.run_id}/stream?after_seq=1", headers={"Last-Event-ID": "junk"}
        ) as response:
            frames = _read_frames(response)
        assert _event_names(frames) == ["run.completed"]

    async def test_stream_ends_after_the_terminal_event(self, client, runs_repo) -> None:
        """A closed connection is what lets the browser stop reconnecting."""
        run = await seed_run(runs_repo)
        await add_event(runs_repo, run.run_id, "run.failed")
        with client.stream("GET", f"{PREFIX}/runs/{run.run_id}/stream") as response:
            _read_frames(response)
        assert response.is_closed

    async def test_stream_data_payload_matches_the_events_endpoint(self, client, runs_repo) -> None:
        run = await seed_run(runs_repo)
        await add_event(runs_repo, run.run_id, "run.completed", steps=3)
        history = client.get(f"{PREFIX}/runs/{run.run_id}/events").json()
        with client.stream("GET", f"{PREFIX}/runs/{run.run_id}/stream") as response:
            frames = _read_frames(response)
        streamed = json.loads(_data_of(frames, 0))
        assert streamed == history[0]
        assert streamed["data"] == {"steps": 3}

    async def test_stream_rejects_a_negative_resume_point(self, client, runs_repo) -> None:
        run = await seed_run(runs_repo)
        response = client.get(f"{PREFIX}/runs/{run.run_id}/events", params={"after_seq": -1})
        assert response.status_code == 422


class _EmptyCatalog:
    async def models(self, *, force_refresh: bool = False) -> list:
        return []


def _read_frames(response) -> list[str]:
    """Collect the raw SSE text. Reading stops when the server closes the stream."""
    chunks: list[str] = []
    for line in response.iter_lines():
        if line.startswith("id:") or line.startswith("event:") or line.startswith("data:"):
            chunks.append(line)
    return chunks


def _event_names(frames: list[str]) -> list[str]:
    return [f.split(": ", 1)[1] for f in frames if f.startswith("event:")]


def _ids(frames: list[str]) -> list[str]:
    return [f.split(": ", 1)[1] for f in frames if f.startswith("id:")]


def _data_of(frames: list[str], index: int) -> str:
    data = [f.split(": ", 1)[1] for f in frames if f.startswith("data:")]
    return data[index]
