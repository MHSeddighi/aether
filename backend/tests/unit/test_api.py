"""State 8 — the HTTP surface.

These tests drive the real routers, the real error envelope and the real dependency graph. Only the
two *infrastructure* collaborators are replaced: the repositories (in-memory fakes) and the
`RunStarter` (a recording fake instead of Temporal). Everything above them — schemas, auth, use cases,
serialisation, status codes, scoping — is production code.

The shapes asserted against are the frontend's, from `web/src/types/agent.ts`.
"""

from __future__ import annotations

import pytest
from app.api.app import create_app
from app.api.deps import (
    get_auth_service,
    get_bot_service,
    get_conversation_service,
    get_current_user,
    get_knowledge_service,
    get_model_service,
    get_run_service,
    get_tool_service,
)
from app.application.auth_service import AuthService
from app.application.bot_service import BotService
from app.application.conversation_service import ConversationService
from app.application.knowledge_service import KnowledgeService
from app.application.model_service import ModelService
from app.application.run_service import RunService
from app.application.tool_service import ToolService
from app.domain.accounts import User
from app.domain.bots import Bot, BotStatus, BotType, BotVersion, DeterministicRule
from app.domain.ids import new_id
from app.domain.models import CatalogModel, Provider
from app.infrastructure.auth.passwords import hash_password, verify_password
from app.infrastructure.auth.tokens import TokenService
from app.infrastructure.config import Settings
from app.infrastructure.models.gateway import default_model_config
from fastapi.testclient import TestClient

from tests.fakes import (
    FakeAccountRepository,
    FakeBotRepository,
    FakeConversationRepository,
    FakeKnowledgeRepository,
    FakeRunRepository,
    FakeRunStarter,
    FakeToolRepository,
    InMemoryBlobStore,
)

SECRET = "api-test-secret-long-enough-for-hmac-sha256-algorithm"
PREFIX = "/api/v1"

SETTINGS = Settings(
    _env_file=None,
    environment="test",
    log_level="WARNING",
    jwt_secret=SECRET,
    database_url="postgresql+asyncpg://unused/unused",
    default_provider="opencode",
    default_model_id="space-bunny-free",
)


class Harness:
    """Builds an app whose infrastructure is faked, and hands out authenticated headers."""

    def __init__(self) -> None:
        self.settings = SETTINGS
        self.tokens = TokenService(SETTINGS)
        self.accounts = FakeAccountRepository()
        self.bots = FakeBotRepository()
        self.runs = FakeRunRepository()
        self.conversations = FakeConversationRepository()
        self.tools = FakeToolRepository()
        self.knowledge = FakeKnowledgeRepository()
        self.blobs = InMemoryBlobStore()
        self.starter = FakeRunStarter()

    # --- collaborators ---------------------------------------------------

    def auth_service(self) -> AuthService:
        return AuthService(self.accounts, self.tokens, verify_password=verify_password)

    def run_service(self) -> RunService:
        return RunService(
            self.runs,
            BotService(self.bots),
            self.starter,
            self.conversations,
            default_timeout_seconds=120.0,
        )

    # --- app -------------------------------------------------------------

    def app(self):
        app = create_app(self.settings)
        harness = self
        overrides = {
            get_auth_service: harness.auth_service,
            get_bot_service: lambda: BotService(harness.bots),
            get_tool_service: lambda: ToolService(harness.tools),
            get_conversation_service: lambda: ConversationService(harness.conversations),
            get_knowledge_service: lambda: KnowledgeService(harness.knowledge, harness.blobs),
            get_run_service: harness.run_service,
            get_model_service: lambda: ModelService(
                lambda name: _Catalog(
                    [CatalogModel(provider=Provider(name), model_id=f"{name}-m", label="L")]
                ),
                default_model_config(SETTINGS),
                ("opencode",),
            ),
        }
        app.dependency_overrides.update(overrides)

        current_user = User(
            user_id="usr_1",
            email="owner@example.com",
            name="Owner",
            workspace_id="ws_1",
            password_hash=hash_password("swordfish-123"),
        )

        async def override_current_user() -> User:
            return current_user

        # One override of the auth gate: the token itself is tested in `test_auth_api.py` with the
        # real dependency in place.
        app.dependency_overrides[get_current_user] = override_current_user
        return app

    def client(self) -> TestClient:
        return TestClient(self.app(), raise_server_exceptions=False)

    # --- seeds -----------------------------------------------------------

    @staticmethod
    def now():
        from datetime import UTC, datetime

        return datetime.now(UTC)

    async def seed_account(self) -> User:
        from app.domain.accounts import Workspace

        await self.accounts.create_workspace(Workspace(workspace_id="ws_1", name="Acme", plan="Team Pro"))
        user = User(
            user_id="usr_1",
            email="owner@example.com",
            name="Owner",
            workspace_id="ws_1",
            password_hash=hash_password("swordfish-123"),
        )
        return await self.accounts.create_user(user)

    async def seed_agent_bot(self, workspace_id: str = "ws_1", **overrides) -> Bot:
        draft = Bot(
            bot_id=new_id("bot"),
            workspace_id=workspace_id,
            name="Support Bot",
            instructions="Answer briefly.",
            provider=Provider.OPENCODE,
            model_id="space-bunny-free",
            **overrides,
        )
        version = BotVersion(
            bot_id=draft.bot_id,
            version_id=new_id("botver"),
            version=draft.version,
            created_at=draft.created_at,
            notes="Initial version",
            model_spec=draft.model_snapshot(),
            instructions=draft.instructions,
        )
        return await self.bots.add(draft, version=version)

    async def seed_simple_bot(self, workspace_id: str = "ws_1") -> Bot:
        return await self.seed_agent_bot(
            workspace_id,
            name="Greeter",
            bot_type=BotType.SIMPLE,
            provider=Provider.DETERMINISTIC,
            model_id="none",
            temperature=0.0,
            deterministic_rules=[DeterministicRule(trigger="hello", response="hi there!")],
        )


class _Catalog:
    def __init__(self, models: list[CatalogModel]) -> None:
        self._models = models

    async def models(self, *, force_refresh: bool = False) -> list[CatalogModel]:
        return self._models


@pytest.fixture
def harness() -> Harness:
    return Harness()


@pytest.fixture
def client(harness: Harness) -> TestClient:
    return harness.client()


BOT_ITEM_KEYS = {
    "id",
    "name",
    "nameFa",
    "botType",
    "description",
    "descriptionFa",
    "avatarIcon",
    "avatarBg",
    "model",
    "provider",
    "modelId",
    "instructions",
    "instructionsFa",
    "toolIds",
    "knowledgeIds",
    "deterministicRules",
    "variables",
    "temperature",
    "topP",
    "maxOutputTokens",
    "status",
    "enabled",
    "version",
    "versions",
    "metrics",
    "billingUsage",
    "lastUsed",
}


# --- bots ----------------------------------------------------------------


class TestBotRoutes:
    async def test_list_is_exactly_the_frontend_shape(self, harness: Harness) -> None:
        await harness.seed_agent_bot()
        with harness.client() as client:
            body = client.get(f"{PREFIX}/bots").json()
        assert isinstance(body, list) and len(body) == 1
        assert set(body[0]) == BOT_ITEM_KEYS
        # camelCase all the way down: the frontend's `BotItem.metrics` is camelCase, so
        # snake_case keys here silently left `metrics.totalRuns` undefined.
        assert body[0]["metrics"] == {
            "totalRuns": 0,
            "avgLatencyMs": 0,
            "tokensConsumed": 0,
            "successRatePercent": 100.0,
        }
        assert body[0]["lastUsed"] == "Never"

    async def test_create_returns_version_one(self, client: TestClient, harness: Harness) -> None:
        response = client.post(
            f"{PREFIX}/bots",
            json={"name": "Support Bot", "instructions": "Be nice.", "model": "ignored label"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["version"] == "1.0.0"
        assert len(body["versions"]) == 1
        assert body["provider"] == "opencode"
        assert body["modelId"] == "space-bunny-free"

    async def test_create_of_a_simple_bot_forces_the_deterministic_provider(self, client: TestClient) -> None:
        response = client.post(
            f"{PREFIX}/bots",
            json={
                "name": "Greeter",
                "bot_type": "simple",
                "provider": "opencode",
                "model_id": "space-bunny-free",
                "deterministic_rules": [{"trigger": "hi", "response": "hello"}],
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert (body["botType"], body["provider"], body["model"]) == (
            "simple",
            "deterministic",
            "Deterministic (No Model)",
        )
        assert body["temperature"] == 0.0

    async def test_simple_bot_without_rules_is_rejected(self, client: TestClient) -> None:
        response = client.post(f"{PREFIX}/bots", json={"name": "Greeter", "bot_type": "simple"})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_unknown_field_is_rejected_not_ignored(self, client: TestClient) -> None:
        """Silently dropping an unknown field is how a typo becomes a mystery bug."""
        response = client.post(f"{PREFIX}/bots", json={"name": "X", "instructoins": "typo"})
        assert response.status_code == 422

    async def test_patch_appends_a_version(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        response = client.patch(
            f"{PREFIX}/bots/{bot.bot_id}", json={"name": "Support Bot", "instructions": "Answer in Persian."}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["version"] == "1.1.0"
        assert [v["version"] for v in body["versions"]] == ["1.1.0", "1.0.0"]

    async def test_patch_leaves_unspecified_fields_alone(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot(description="original description")
        body = client.patch(f"{PREFIX}/bots/{bot.bot_id}", json={"avatar_icon": "Sparkle"}).json()
        assert body["description"] == "original description"
        assert body["avatarIcon"] == "Sparkle"

    async def test_delete_archives_rather_than_removes(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        response = client.delete(f"{PREFIX}/bots/{bot.bot_id}")
        assert response.status_code == 200
        assert response.json()["status"] == "archived"
        assert (await harness.bots.get(bot.bot_id, "ws_1")) is not None

    async def test_unknown_bot_is_404_with_the_error_envelope(self, client: TestClient) -> None:
        response = client.get(f"{PREFIX}/bots/bot_missing")
        assert response.status_code == 404
        error = response.json()["error"]
        assert error["code"] == "not_found" and error["request_id"].startswith("req_")

    async def test_versions_are_newest_first(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        client.patch(f"{PREFIX}/bots/{bot.bot_id}", json={"instructions": "second"})
        versions = client.get(f"{PREFIX}/bots/{bot.bot_id}/versions").json()
        assert [v["version"] for v in versions] == ["1.1.0", "1.0.0"]
        assert versions[0]["model"] == "Space Bunny Free"


# --- runs ----------------------------------------------------------------


class TestRunRoutes:
    async def test_post_returns_202_with_a_run_id_and_queued_status(
        self, client: TestClient, harness: Harness
    ) -> None:
        bot = await harness.seed_agent_bot()
        response = client.post(f"{PREFIX}/runs", json={"bot_id": bot.bot_id, "input": "hello"})
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "queued"
        assert body["run_id"].startswith("run_")
        assert harness.starter.started, "the workflow must actually be started"

    async def test_get_exposes_the_captured_model_configuration(
        self, client: TestClient, harness: Harness
    ) -> None:
        bot = await harness.seed_agent_bot(temperature=0.65)
        run_id = client.post(f"{PREFIX}/runs", json={"bot_id": bot.bot_id, "input": "hi"}).json()["run_id"]
        body = client.get(f"{PREFIX}/runs/{run_id}").json()
        assert body["model"]["provider"] == "opencode"
        assert body["model"]["modelId"] == "space-bunny-free"
        assert body["model"]["temperature"] == 0.65
        assert body["botVersionId"] == bot.versions[0].version_id

    async def test_disabled_bot_is_a_conflict(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot(enabled=False)
        response = client.post(f"{PREFIX}/runs", json={"bot_id": bot.bot_id, "input": "hi"})
        assert response.status_code == 409
        assert response.json()["error"]["details"]["reason"] == "the bot is disabled"
        assert not harness.starter.started

    async def test_archived_bot_is_a_conflict(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot(status=BotStatus.ARCHIVED)
        response = client.post(f"{PREFIX}/runs", json={"bot_id": bot.bot_id, "input": "hi"})
        assert response.status_code == 409

    async def test_cancel_marks_the_run_cancelled(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        run_id = client.post(f"{PREFIX}/runs", json={"bot_id": bot.bot_id, "input": "hi"}).json()["run_id"]
        response = client.post(f"{PREFIX}/runs/{run_id}/cancel")
        assert response.status_code == 202
        assert response.json()["status"] == "cancelled"
        assert harness.starter.cancelled == [run_id]
        assert client.get(f"{PREFIX}/runs/{run_id}").json()["status"] == "cancelled"

    async def test_cancel_of_a_finished_run_is_a_no_op(self, client: TestClient, harness: Harness) -> None:
        """The stop button can land after the answer; that must not be an error."""
        from app.domain.runs import RunStatus

        bot = await harness.seed_agent_bot()
        run_id = client.post(f"{PREFIX}/runs", json={"bot_id": bot.bot_id, "input": "hi"}).json()["run_id"]
        await harness.runs.finish(run_id, status=RunStatus.SUCCEEDED, finished_at=harness.now())
        response = client.post(f"{PREFIX}/runs/{run_id}/cancel")
        assert response.status_code == 202
        assert response.json()["status"] == "succeeded"

    async def test_unknown_run_is_404(self, client: TestClient) -> None:
        assert client.get(f"{PREFIX}/runs/run_missing").status_code == 404

    async def test_list_is_workspace_scoped(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot("ws_1")
        client.post(f"{PREFIX}/runs", json={"bot_id": bot.bot_id, "input": "hi"})
        assert len(client.get(f"{PREFIX}/runs").json()) == 1


# --- conversations -------------------------------------------------------


class TestConversationRoutes:
    async def test_list_omits_messages(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        created = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        client.post(f"{PREFIX}/conversations/{created['id']}/messages", json={"content": "hi"})
        listed = client.get(f"{PREFIX}/conversations").json()
        assert listed[0].keys() >= {"id", "title", "botId", "category", "updatedAt", "mode"}
        assert "messages" not in listed[0], "the sidebar must not download full histories"

    async def test_detail_includes_messages(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        created = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        client.post(f"{PREFIX}/conversations/{created['id']}/messages", json={"content": "hi"})
        detail = client.get(f"{PREFIX}/conversations/{created['id']}").json()
        assert [m["sender"] for m in detail["messages"]] == ["user", "bot"]

    async def test_send_message_returns_the_streaming_placeholder_and_a_run(
        self, client: TestClient, harness: Harness
    ) -> None:
        """This is the frontend's optimistic chat turn, exactly as observed in the UI."""
        bot = await harness.seed_agent_bot()
        conversation = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        response = client.post(
            f"{PREFIX}/conversations/{conversation['id']}/messages", json={"content": "hello there"}
        )
        assert response.status_code == 202
        body = response.json()
        assert body["run_id"].startswith("run_")
        assert body["user_message"]["content"] == "hello there"
        assert body["user_message"]["sender"] == "user"
        assert body["assistant_message"]["isStreaming"] is True
        assert body["assistant_message"]["content"] == ""
        assert harness.starter.started[0][0].assistant_message_id == body["assistant_message"]["id"]

    async def test_send_message_records_the_assistant_message_on_the_run(
        self, client: TestClient, harness: Harness
    ) -> None:
        """`PersistRunResult` fills in the message the frontend is watching; without this link the
        reply would land nowhere."""
        bot = await harness.seed_agent_bot()
        conversation = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        body = client.post(
            f"{PREFIX}/conversations/{conversation['id']}/messages", json={"content": "hi"}
        ).json()
        run = await harness.runs.get(body["run_id"], "ws_1")
        assert run.assistant_message_id == body["assistant_message"]["id"]

    async def test_send_message_to_a_disabled_bot_is_a_conflict(
        self, client: TestClient, harness: Harness
    ) -> None:
        bot = await harness.seed_agent_bot(enabled=False)
        conversation = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        response = client.post(
            f"{PREFIX}/conversations/{conversation['id']}/messages", json={"content": "hi"}
        )
        assert response.status_code == 409

    async def test_rename_and_pin(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        created = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        renamed = client.patch(
            f"{PREFIX}/conversations/{created['id']}", json={"title": "Pricing questions"}
        ).json()
        assert renamed["title"] == "Pricing questions"
        pinned = client.patch(f"{PREFIX}/conversations/{created['id']}", json={"is_pinned": True}).json()
        assert pinned["isPinned"] is True
        assert pinned["title"] == "Pricing questions", "a pin must not clear the title"

    async def test_delete(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        created = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        assert client.delete(f"{PREFIX}/conversations/{created['id']}").status_code == 204
        assert client.get(f"{PREFIX}/conversations/{created['id']}").status_code == 404

    async def test_feedback_is_recorded(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        conversation = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        sent = client.post(
            f"{PREFIX}/conversations/{conversation['id']}/messages", json={"content": "hi"}
        ).json()
        message_id = sent["assistant_message"]["id"]
        response = client.post(f"{PREFIX}/messages/{message_id}/feedback", json={"feedback": "good"})
        assert response.status_code == 200
        assert response.json()["feedback"] == "good"

    async def test_feedback_value_is_validated(self, client: TestClient, harness: Harness) -> None:
        bot = await harness.seed_agent_bot()
        conversation = client.post(f"{PREFIX}/conversations", json={"bot_id": bot.bot_id}).json()
        sent = client.post(
            f"{PREFIX}/conversations/{conversation['id']}/messages", json={"content": "hi"}
        ).json()
        response = client.post(
            f"{PREFIX}/messages/{sent['assistant_message']['id']}/feedback", json={"feedback": "meh"}
        )
        assert response.status_code == 422


# --- tools ---------------------------------------------------------------


class TestToolRoutes:
    async def test_create_and_list(self, client: TestClient) -> None:
        response = client.post(
            f"{PREFIX}/tools",
            json={
                "name": "Web Search",
                "purpose": "Search the docs",
                "category": "search",
                "handler": "http",
                "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
                "permissions": ["network"],
                "handler_config": {"url": "https://example.test/search"},
                "timeout_seconds": 12,
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert (body["connectionState"], body["category"], body["enabled"]) == (
            "Connected",
            "search",
            True,
        )
        assert body["timeoutSeconds"] == 12.0
        assert body["permissions"] == ["network"]

    async def test_create_without_an_input_schema_is_rejected(self, client: TestClient) -> None:
        response = client.post(f"{PREFIX}/tools", json={"name": "Mystery"})
        assert response.status_code == 422
        assert "input_schema" in response.json()["error"]["message"]

    async def test_http_tool_without_the_network_permission_is_rejected(self, client: TestClient) -> None:
        response = client.post(
            f"{PREFIX}/tools",
            json={
                "name": "Search",
                "handler": "http",
                "input_schema": {"type": "object"},
                "handler_config": {"url": "https://example.test"},
            },
        )
        assert response.status_code == 422

    async def test_update_of_the_contract_appends_a_version(
        self, client: TestClient, harness: Harness
    ) -> None:
        from app.domain.tools import Tool

        from tests.unit.test_services import make_tool_version

        tool_id = new_id("tool")
        await harness.tools.add(
            Tool(tool_id=tool_id, workspace_id="ws_1", name="Search"),
            version=make_tool_version(tool_id),
        )
        body = client.patch(f"{PREFIX}/tools/{tool_id}", json={"timeout_seconds": 30}).json()
        assert body["version"] == 2
        versions = client.get(f"{PREFIX}/tools/{tool_id}/versions").json()
        assert [v["version"] for v in versions] == [2, 1]

    async def test_unknown_tool_is_404(self, client: TestClient) -> None:
        assert client.get(f"{PREFIX}/tools/tool_missing").status_code == 404


# --- knowledge -----------------------------------------------------------


class TestKnowledgeRoutes:
    def test_upload_returns_uploading_items(self, client: TestClient) -> None:
        response = client.post(
            f"{PREFIX}/knowledge",
            files=[("files", ("notes.txt", b"hello world", "text/plain"))],
        )
        assert response.status_code == 202
        item = response.json()[0]
        assert (item["status"], item["progressPercent"]) == ("Uploading", 20)
        assert item["name"] == "notes.txt"
        assert item["type"] == "text"
        assert item["fileCount"] == 1

    def test_empty_upload_is_rejected(self, client: TestClient) -> None:
        assert client.post(f"{PREFIX}/knowledge", files=[]).status_code == 422

    def test_rename_and_delete(self, client: TestClient) -> None:
        item = client.post(
            f"{PREFIX}/knowledge", files=[("files", ("notes.txt", b"x", "text/plain"))]
        ).json()[0]
        renamed = client.patch(f"{PREFIX}/knowledge/{item['id']}", json={"name": "Product notes"})
        assert renamed.json()["name"] == "Product notes"
        assert client.delete(f"{PREFIX}/knowledge/{item['id']}").status_code == 204
        assert client.get(f"{PREFIX}/knowledge/{item['id']}").status_code == 404


# --- models --------------------------------------------------------------


class TestModelRoutes:
    def test_catalogue_is_served_from_configuration(self, client: TestClient) -> None:
        body = client.get(f"{PREFIX}/models").json()
        assert body == [
            {
                "provider": "opencode",
                "model_id": "opencode-m",
                "label": "L",
                "free": False,
                "context_window": None,
            }
        ]

    def test_default_model_is_the_configured_one(self, client: TestClient) -> None:
        body = client.get(f"{PREFIX}/models/default").json()
        assert body["provider"] == "opencode"
        assert body["model_id"] == "space-bunny-free"
        assert body["label"] == "Space Bunny Free"
        assert body["retry"]["max_attempts"] >= 1
