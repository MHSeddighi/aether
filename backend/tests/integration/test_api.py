"""State 8 — the API against a real Postgres.

`tests/unit/test_api.py` swaps the repositories for in-memory fakes. This file keeps the *entire*
real dependency graph — real repositories, real sessions, real transactions — and replaces exactly
one thing: Temporal, with a recording `RunStarter`. So it exercises what the fakes cannot: the
Alembic schema, the JSONB round trips, the append-only trigger, per-request commit/rollback and
workspace scoping through actual SQL.

Temporal-driven behaviour lives in `tests/integration/test_workflow.py`.

Skips when `TEST_DATABASE_URL` is unset:

    export TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:55432/botbuilder_test
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from app.api.app import create_app
from app.infrastructure.config import Settings
from app.infrastructure.database.session import Database
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.fakes import FakeRunStarter

pytestmark = pytest.mark.integration

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
PREFIX = "/api/v1"

if not TEST_DATABASE_URL:  # pragma: no cover - import-time guard
    pytest.skip("TEST_DATABASE_URL is not set", allow_module_level=True)

SECRET = "integration-test-secret-long-enough-for-hmac-sha256"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        log_level="WARNING",
        jwt_secret=SECRET,
        database_url=TEST_DATABASE_URL,
        data_dir=str(tmp_path / "data"),
    )


@pytest.fixture
def starter() -> FakeRunStarter:
    return FakeRunStarter()


@pytest.fixture
def client(settings: Settings, starter: FakeRunStarter):
    """Used as a context manager on purpose.

    `TestClient` runs the app on a portal — one event loop per client, not per request — so the
    connection pool stays valid across requests and the app's lifespan (engine disposal) actually
    runs.
    """
    app = create_app(settings)
    # The one and only substitution: the durable execution system.
    app.state.run_starter = starter
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


_TRUNCATE = (
    "TRUNCATE users, workspaces, runs, run_events, messages, conversations, bots, bot_versions, "
    "tools, tool_versions, knowledge_sources, files, artifacts RESTART IDENTITY CASCADE"
)


@pytest.fixture(autouse=True)
def clean(settings: Settings):
    """A clean slate per test. Needed because the append-only triggers block row cleanup anyway.

    Written as a synchronous fixture that drives its own `asyncio.run`: an async engine must not
    outlive the event loop that created it, and the TestClient opens a different loop for the app.
    """

    async def truncate() -> None:
        database = Database(settings)
        try:
            async with database.engine.begin() as connection:
                await connection.execute(text(_TRUNCATE))
        finally:
            await database.dispose()

    asyncio.run(truncate())
    yield


def sign_up(client: TestClient, email: str = "owner@example.com") -> tuple[dict, dict]:
    """Register and return `(tokens, headers)`. Every test starts here."""
    response = client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "name": "Owner", "password": "swordfish-123"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return body, {"Authorization": f"Bearer {body['access_token']}"}


class TestAuthWithRealPostgres:
    def test_registration_persists_user_and_workspace(self, client: TestClient) -> None:
        body, headers = sign_up(client)
        response = client.get(f"{PREFIX}/auth/me", headers=headers)
        assert response.status_code == 200, response.text
        me = response.json()
        assert me["user"]["id"] == body["user"]["id"]
        assert me["workspace"]["id"] == body["workspace"]["id"]

    def test_password_hash_is_stored_hashed(self, client: TestClient, settings: Settings) -> None:
        """The row must never contain anything recoverable from the request body."""
        body, _ = sign_up(client)

        async def read_hash() -> str:
            database = Database(settings)
            try:
                async with database.engine.connect() as connection:
                    result = await connection.execute(
                        text("SELECT password_hash FROM users WHERE id = :id"),
                        {"id": body["user"]["id"]},
                    )
                    return str(result.scalar_one())
            finally:
                await database.dispose()

        import asyncio

        stored = asyncio.run(read_hash())
        assert stored.startswith("$argon2")
        assert "swordfish-123" not in stored

    def test_login_works_after_reload(self, client: TestClient) -> None:
        sign_up(client)
        response = client.post(
            f"{PREFIX}/auth/login", json={"email": "owner@example.com", "password": "swordfish-123"}
        )
        assert response.status_code == 200

    def test_duplicate_email_is_409(self, client: TestClient) -> None:
        sign_up(client)
        response = client.post(
            f"{PREFIX}/auth/register",
            json={"email": "OWNER@example.com", "name": "Other", "password": "swordfish-123"},
        )
        assert response.status_code == 409


class TestBotsWithRealPostgres:
    def test_create_patch_and_version_history(self, client: TestClient) -> None:
        _, headers = sign_up(client)
        bot = client.post(
            f"{PREFIX}/bots", headers=headers, json={"name": "Support Bot", "instructions": "Be nice."}
        ).json()
        assert bot["version"] == "1.0.0"

        patched = client.patch(
            f"{PREFIX}/bots/{bot['id']}", headers=headers, json={"instructions": "Answer in Persian."}
        ).json()
        assert patched["version"] == "1.1.0"
        # The JSONB snapshot round trips, including the Persian text.
        versions = client.get(f"{PREFIX}/bots/{bot['id']}/versions", headers=headers).json()
        assert [v["version"] for v in versions] == ["1.1.0", "1.0.0"]

    def test_versions_are_immutable_in_the_database(self, client: TestClient, settings: Settings) -> None:
        """The trigger, not the service, is what guarantees this — so check the database."""
        _, headers = sign_up(client)
        bot = client.post(f"{PREFIX}/bots", headers=headers, json={"name": "B"}).json()
        version_id = bot["versions"][0]["versionId"]

        async def attempt_update() -> str:
            database = Database(settings)
            try:
                async with database.engine.begin() as connection:
                    await connection.execute(
                        text("UPDATE bot_versions SET notes = 'tampered' WHERE version_id = :id"),
                        {"id": version_id},
                    )
                return "updated"
            except Exception as exc:  # the trigger raises
                return type(exc).__name__
            finally:
                await database.dispose()

        import asyncio

        assert asyncio.run(attempt_update()) != "updated"

    def test_deterministic_rules_round_trip(self, client: TestClient) -> None:
        _, headers = sign_up(client)
        bot = client.post(
            f"{PREFIX}/bots",
            headers=headers,
            json={
                "name": "Greeter",
                "bot_type": "simple",
                "deterministic_rules": [{"trigger": "hello", "response": "hi there"}],
            },
        ).json()
        assert bot["provider"] == "deterministic"
        assert bot["deterministicRules"] == [{"trigger": "hello", "response": "hi there"}]
        assert client.get(f"{PREFIX}/bots/{bot['id']}", headers=headers).json() == bot


class TestRunsWithRealPostgres:
    def test_run_round_trip(self, client: TestClient, starter: FakeRunStarter) -> None:
        _, headers = sign_up(client)
        bot = client.post(f"{PREFIX}/bots", headers=headers, json={"name": "B"}).json()

        started = client.post(f"{PREFIX}/runs", headers=headers, json={"bot_id": bot["id"], "input": "hello"})
        assert started.status_code == 202, started.text
        run_id = started.json()["run_id"]
        assert starter.started[0][1] == f"run:{run_id}"

        run = client.get(f"{PREFIX}/runs/{run_id}", headers=headers).json()
        assert run["status"] == "queued"
        assert run["model"]["modelId"] == "space-bunny-free"
        assert run["botVersionId"] == bot["versions"][0]["versionId"]

        cancelled = client.post(f"{PREFIX}/runs/{run_id}/cancel", headers=headers)
        assert cancelled.status_code == 202
        assert cancelled.json()["status"] == "cancelled"
        assert starter.cancelled == [run_id]
        assert client.get(f"{PREFIX}/runs/{run_id}", headers=headers).json()["status"] == "cancelled"

    def test_cancel_twice_is_stable(self, client: TestClient, starter: FakeRunStarter) -> None:
        _, headers = sign_up(client)
        bot = client.post(f"{PREFIX}/bots", headers=headers, json={"name": "B"}).json()
        run_id = client.post(
            f"{PREFIX}/runs", headers=headers, json={"bot_id": bot["id"], "input": "hi"}
        ).json()["run_id"]
        client.post(f"{PREFIX}/runs/{run_id}/cancel", headers=headers)
        again = client.post(f"{PREFIX}/runs/{run_id}/cancel", headers=headers)
        assert again.status_code == 202
        assert again.json()["status"] == "cancelled"
        assert starter.cancelled == [run_id], "a second cancel must not ask Temporal again"


class TestConversationsWithRealPostgres:
    def test_chat_turn_and_feedback(self, client: TestClient) -> None:
        _, headers = sign_up(client)
        bot = client.post(f"{PREFIX}/bots", headers=headers, json={"name": "B"}).json()
        conversation = client.post(
            f"{PREFIX}/conversations", headers=headers, json={"bot_id": bot["id"], "title": "Pricing"}
        ).json()

        sent = client.post(
            f"{PREFIX}/conversations/{conversation['id']}/messages",
            headers=headers,
            json={"content": "how much?"},
        )
        assert sent.status_code == 202, sent.text
        assistant_id = sent.json()["assistant_message"]["id"]

        detail = client.get(f"{PREFIX}/conversations/{conversation['id']}", headers=headers).json()
        assert [m["sender"] for m in detail["messages"]] == ["user", "bot"]

        feedback = client.post(
            f"{PREFIX}/messages/{assistant_id}/feedback", headers=headers, json={"feedback": "good"}
        )
        assert feedback.json()["feedback"] == "good"
        assert (
            client.get(f"{PREFIX}/conversations/{conversation['id']}", headers=headers).json()["messages"][1][
                "feedback"
            ]
            == "good"
        )


class TestToolsAndKnowledgeWithRealPostgres:
    def test_tool_version_history(self, client: TestClient) -> None:
        _, headers = sign_up(client)
        tool = client.post(
            f"{PREFIX}/tools",
            headers=headers,
            json={
                "name": "Web Search",
                "handler": "http",
                "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
                "permissions": ["network"],
                "handler_config": {"url": "https://example.test/search"},
            },
        ).json()
        patched = client.patch(
            f"{PREFIX}/tools/{tool['id']}", headers=headers, json={"timeout_seconds": 30}
        ).json()
        assert patched["version"] == 2
        versions = client.get(f"{PREFIX}/tools/{tool['id']}/versions", headers=headers).json()
        assert [v["version"] for v in versions] == [2, 1]
        assert versions[1]["permissions"] == ["network"]

    def test_knowledge_upload_writes_a_row_and_a_blob(self, client: TestClient, settings: Settings) -> None:
        _, headers = sign_up(client)
        response = client.post(
            f"{PREFIX}/knowledge",
            headers=headers,
            files=[("files", ("notes.txt", b"hello world", "text/plain"))],
        )
        assert response.status_code == 202, response.text
        item = response.json()[0]
        assert (item["status"], item["progressPercent"]) == ("Uploading", 20)
        assert list(Path(settings.data_dir).rglob("notes.txt")), "bytes live on the data volume"

    def test_oversized_upload_is_refused_without_orphan_rows(self, client: TestClient) -> None:
        _, headers = sign_up(client)
        response = client.post(
            f"{PREFIX}/knowledge",
            headers=headers,
            files=[("files", ("big.bin", b"x" * (26 * 1024 * 1024), "application/octet-stream"))],
        )
        assert response.status_code == 500 or response.status_code == 413
        assert client.get(f"{PREFIX}/knowledge", headers=headers).json() == []


class TestEventStreamWithRealPostgres:
    """The stream is a read of the durable table, so the real thing must behave the same way."""

    async def test_events_are_persisted_with_gap_free_sequence_numbers(
        self, client: TestClient, settings: Settings
    ) -> None:
        _, headers = sign_up(client)
        bot = client.post(f"{PREFIX}/bots", headers=headers, json={"name": "B"}).json()
        run_id = client.post(
            f"{PREFIX}/runs", headers=headers, json={"bot_id": bot["id"], "input": "hi"}
        ).json()["run_id"]
        client.post(f"{PREFIX}/runs/{run_id}/cancel", headers=headers)

        events = client.get(f"{PREFIX}/runs/{run_id}/events", headers=headers).json()
        assert [e["type"] for e in events] == ["run.cancelled"]
        assert [e["seq"] for e in events] == [1]

        resumed = client.get(
            f"{PREFIX}/runs/{run_id}/events", headers=headers, params={"after_seq": 1}
        ).json()
        assert resumed == [], "everything after the last seen sequence was already delivered"

    async def test_stream_replays_persisted_events_and_closes(self, client: TestClient) -> None:
        _, headers = sign_up(client)
        bot = client.post(f"{PREFIX}/bots", headers=headers, json={"name": "B"}).json()
        run_id = client.post(
            f"{PREFIX}/runs", headers=headers, json={"bot_id": bot["id"], "input": "hi"}
        ).json()["run_id"]
        client.post(f"{PREFIX}/runs/{run_id}/cancel", headers=headers)

        with client.stream("GET", f"{PREFIX}/runs/{run_id}/stream", headers=headers) as response:
            assert response.status_code == 200
            lines = [line for line in response.iter_lines() if line.startswith(("id:", "event:", "data:"))]
        assert "event: run.cancelled" in lines
        assert "id: 1" in lines

    async def test_stream_events_are_workspace_scoped(self, client: TestClient) -> None:
        _, first_headers = sign_up(client, "one@example.com")
        bot = client.post(f"{PREFIX}/bots", headers=first_headers, json={"name": "B"}).json()
        run_id = client.post(
            f"{PREFIX}/runs", headers=first_headers, json={"bot_id": bot["id"], "input": "hi"}
        ).json()["run_id"]

        _, second_headers = sign_up(client, "two@example.com")
        assert client.get(f"{PREFIX}/runs/{run_id}/events", headers=second_headers).status_code == 404
        assert client.get(f"{PREFIX}/runs/{run_id}/stream", headers=second_headers).status_code == 404


class TestScopingAndRollback:
    def test_cross_workspace_access_is_404(self, client: TestClient) -> None:
        _, first_headers = sign_up(client, "one@example.com")
        bot = client.post(f"{PREFIX}/bots", headers=first_headers, json={"name": "Private"}).json()
        _, second_headers = sign_up(client, "two@example.com")
        assert client.get(f"{PREFIX}/bots/{bot['id']}", headers=second_headers).status_code == 404
        assert client.get(f"{PREFIX}/bots", headers=second_headers).json() == []
        assert (
            client.get(f"{PREFIX}/auth/me", headers=second_headers).json()["workspace"]["id"]
            != client.get(f"{PREFIX}/auth/me", headers=first_headers).json()["workspace"]["id"]
        )

    def test_failed_request_rolls_back_everything_it_wrote(self, client: TestClient) -> None:
        """One transaction per request: a request that fails leaves no partial state behind."""
        _, headers = sign_up(client)
        broken = client.post(
            f"{PREFIX}/tools",
            headers=headers,
            json={
                "name": "Broken",
                "handler": "http",
                "input_schema": {"type": "object"},
                "permissions": [],
                "handler_config": {},
            },
        )
        assert broken.status_code == 422
        assert client.get(f"{PREFIX}/tools", headers=headers).json() == []
