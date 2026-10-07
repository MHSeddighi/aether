"""State 8 — the use cases.

Everything here runs against the in-memory fakes in `tests/fakes.py`: no Postgres, no Temporal, no
model provider. The behaviours under test are the ones the API contract depends on — workspace
scoping, version immutability, run lifecycle, cancellation ordering, and the knowledge state machine.
"""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO

import pytest
from app.application.auth_service import AuthService, CredentialsRejected, EmailConflict
from app.application.bot_service import BotNotFound, BotService
from app.application.conversation_service import (
    ConversationNotFound,
    ConversationService,
    MessageNotFound,
)
from app.application.knowledge_service import FileTooLarge, KnowledgeService, chunk_text
from app.application.model_service import ModelService
from app.application.run_service import BotNotRunnable, RunNotFound, RunService, StartRunCommand
from app.application.tool_service import ToolNotFound, ToolService
from app.domain.bots import Bot, BotStatus, BotType, BotVersion, DeterministicRule
from app.domain.conversations import Attachment, Conversation, Message, Sender
from app.domain.failures import ValidationFailure
from app.domain.ids import new_id
from app.domain.knowledge import KnowledgeStatus
from app.domain.models import CatalogModel, Provider
from app.domain.runs import RunStatus
from app.domain.tools import Tool, ToolPermission, ToolVersion
from app.infrastructure.auth.passwords import hash_password
from app.infrastructure.auth.tokens import TokenService
from app.infrastructure.config import Settings

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

SETTINGS = Settings(_env_file=None, jwt_secret="s" * 40)
NOW = datetime.now(UTC)


# --- fixtures ------------------------------------------------------------


@pytest.fixture
def accounts() -> FakeAccountRepository:
    return FakeAccountRepository()


@pytest.fixture
def tokens() -> TokenService:
    return TokenService(SETTINGS)


@pytest.fixture
def auth(accounts: FakeAccountRepository, tokens: TokenService) -> AuthService:
    def hash_password_fn(plaintext: str) -> str:
        return hash_password(plaintext)

    def verify_fn(plaintext: str, stored: str) -> bool:
        from app.infrastructure.auth.passwords import verify_password

        return verify_password(plaintext, stored)

    return AuthService(accounts, tokens, verify_password=verify_fn, hash_password=hash_password_fn)


@pytest.fixture
def bot_repo() -> FakeBotRepository:
    return FakeBotRepository()


@pytest.fixture
def bots(bot_repo: FakeBotRepository) -> BotService:
    return BotService(bot_repo)


@pytest.fixture
def run_repo() -> FakeRunRepository:
    return FakeRunRepository()


@pytest.fixture
def conversation_repo() -> FakeConversationRepository:
    return FakeConversationRepository()


@pytest.fixture
def conversations(conversation_repo: FakeConversationRepository) -> ConversationService:
    return ConversationService(conversation_repo)


@pytest.fixture
def starter() -> FakeRunStarter:
    return FakeRunStarter()


@pytest.fixture
def runs(run_repo: FakeRunRepository, bots: BotService, starter: FakeRunStarter, conversation_repo):
    return RunService(run_repo, bots, starter, conversation_repo)


async def make_bot(
    repo: FakeBotRepository,
    workspace_id: str = "ws_1",
    *,
    name: str = "Support Bot",
    bot_type: BotType = BotType.AGENT,
    **overrides,
) -> Bot:
    fields = {
        "bot_id": new_id("bot"),
        "workspace_id": workspace_id,
        "name": name,
        "bot_type": bot_type,
        "provider": Provider.DETERMINISTIC if bot_type is BotType.SIMPLE else Provider.OPENCODE,
        "model_id": "none" if bot_type is BotType.SIMPLE else "space-bunny-free",
        "instructions": "Be helpful.",
        "deterministic_rules": (
            (DeterministicRule(trigger="hi", response="hello"),) if bot_type is BotType.SIMPLE else ()
        ),
        "temperature": 0.0 if bot_type is BotType.SIMPLE else 0.3,
        **overrides,
    }
    draft = Bot(**fields)
    version = BotVersion(
        bot_id=draft.bot_id,
        version_id=new_id("botver"),
        version="1.0.0",
        created_at=NOW,
        notes="Initial version",
        model_spec=draft.model_snapshot(),
        instructions=draft.instructions,
    )
    return await repo.add(draft, version=version)


# --- auth ----------------------------------------------------------------


class TestAuthService:
    async def test_register_creates_user_workspace_and_tokens(
        self, auth: AuthService, accounts: FakeAccountRepository
    ) -> None:
        response = await auth.register(email="Owner@Example.com", name="Owner", password="swordfish-123")
        assert response.user.email == "owner@example.com", "email must be normalised"
        assert response.user.workspace_id == response.workspace.workspace_id
        assert response.workspace.plan == SETTINGS.default_plan
        assert response.tokens["token_type"] == "bearer"
        assert await accounts.get_workspace(response.workspace.workspace_id) is not None

    async def test_duplicate_email_is_a_conflict(self, auth: AuthService) -> None:
        await auth.register(email="dup@example.com", name="A", password="swordfish-123")
        with pytest.raises(EmailConflict):
            await auth.register(email="DUP@example.com", name="B", password="swordfish-123")

    async def test_short_password_is_rejected_before_any_write(
        self, auth: AuthService, accounts: FakeAccountRepository
    ) -> None:
        with pytest.raises(ValidationFailure, match="at least 8"):
            await auth.register(email="a@example.com", name="A", password="short")
        assert not accounts.users, "a rejected registration must not leave a half-created account"

    async def test_login_accepts_the_right_password_and_rejects_the_wrong_one(
        self, auth: AuthService
    ) -> None:
        await auth.register(email="owner@example.com", name="Owner", password="swordfish-123")
        assert (await auth.login(email="owner@example.com", password="swordfish-123")).user.email
        with pytest.raises(CredentialsRejected):
            await auth.login(email="owner@example.com", password="not-the-password")

    async def test_unknown_email_and_wrong_password_are_indistinguishable(self, auth: AuthService) -> None:
        """Otherwise the login form becomes an account-enumeration oracle."""
        await auth.register(email="owner@example.com", name="Owner", password="swordfish-123")
        with pytest.raises(CredentialsRejected) as unknown:
            await auth.login(email="nobody@example.com", password="swordfish-123")
        with pytest.raises(CredentialsRejected) as wrong:
            await auth.login(email="owner@example.com", password="wrong-password-1")
        assert str(unknown.value) == str(wrong.value) == "invalid email or password"

    async def test_refresh_returns_a_new_pair(self, auth: AuthService) -> None:
        registered = await auth.register(email="owner@example.com", name="O", password="swordfish-123")
        refreshed = await auth.refresh(registered.tokens["refresh_token"])
        assert refreshed.tokens["access_token"] != registered.tokens["access_token"]
        assert refreshed.user.user_id == registered.user.user_id

    async def test_access_token_cannot_be_used_to_refresh(self, auth: AuthService) -> None:
        registered = await auth.register(email="owner@example.com", name="O", password="swordfish-123")
        with pytest.raises(CredentialsRejected):
            await auth.refresh(registered.tokens["access_token"])

    async def test_disabled_account_cannot_log_in(self, auth: AuthService, accounts) -> None:
        registered = await auth.register(email="owner@example.com", name="O", password="swordfish-123")
        accounts.users[registered.user.user_id] = registered.user.model_copy(update={"is_active": False})
        with pytest.raises(CredentialsRejected, match="disabled"):
            await auth.login(email="owner@example.com", password="swordfish-123")

    async def test_refresh_is_refused_after_the_workspace_changed(self, auth: AuthService, accounts) -> None:
        """A token must not outlive the membership that granted it."""
        registered = await auth.register(email="owner@example.com", name="O", password="swordfish-123")
        accounts.users[registered.user.user_id] = registered.user.model_copy(
            update={"workspace_id": "ws_moved"}
        )
        with pytest.raises(CredentialsRejected, match="no longer valid"):
            await auth.refresh(registered.tokens["refresh_token"])

    async def test_session_mints_no_tokens(self, auth: AuthService) -> None:
        registered = await auth.register(email="owner@example.com", name="O", password="swordfish-123")
        response = await auth.session(registered.user.user_id)
        assert response.to_identity_dict() == {
            "user": registered.user.to_dict(),
            "workspace": response.workspace.to_dict(),
        }
        assert "access_token" not in response.tokens


# --- bots ----------------------------------------------------------------


class TestBotService:
    async def test_create_starts_at_version_one(self, bots: BotService) -> None:
        bot = await bots.create(
            "ws_1",
            Bot(bot_id="", workspace_id="ws_1", name="New", provider=Provider.OPENCODE, model_id="m"),
        )
        assert bot.version == "1.0.0"
        assert len(bot.versions) == 1

    async def test_update_appends_a_version_and_bumps_the_label(self, bots: BotService) -> None:
        created = await bots.create(
            "ws_1",
            Bot(bot_id="", workspace_id="ws_1", name="Bot", provider=Provider.OPENCODE, model_id="m"),
        )
        updated = await bots.update("ws_1", created.bot_id, {"instructions": "Answer in Persian"})
        assert updated.version == "1.1.0"
        assert [v.version for v in updated.versions] == ["1.1.0", "1.0.0"]
        assert updated.versions[1].instructions != "Answer in Persian", "history must be untouched"

    async def test_presentation_only_change_does_not_bump_the_version(self, bots: BotService) -> None:
        created = await bots.create(
            "ws_1",
            Bot(bot_id="", workspace_id="ws_1", name="Bot", provider=Provider.OPENCODE, model_id="m"),
        )
        updated = await bots.update("ws_1", created.bot_id, {"description": "now documented"})
        assert updated.version == "1.0.0", "renaming a bot is not a behavioural change"

    async def test_unknown_field_is_rejected(self, bots: BotService) -> None:
        created = await bots.create(
            "ws_1",
            Bot(bot_id="", workspace_id="ws_1", name="Bot", provider=Provider.OPENCODE, model_id="m"),
        )
        with pytest.raises(ValidationFailure, match="unknown bot fields"):
            await bots.update("ws_1", created.bot_id, {"nope": 1})

    async def test_archived_bot_is_revived_as_a_draft_when_edited(self, bots: BotService) -> None:
        created = await bots.create(
            "ws_1",
            Bot(bot_id="", workspace_id="ws_1", name="Bot", provider=Provider.OPENCODE, model_id="m"),
        )
        await bots.archive("ws_1", created.bot_id)
        edited = await bots.update("ws_1", created.bot_id, {"description": "back in business"})
        assert edited.status is BotStatus.DRAFT

    async def test_archive_keeps_the_row(self, bots: BotService) -> None:
        created = await bots.create(
            "ws_1",
            Bot(bot_id="", workspace_id="ws_1", name="Bot", provider=Provider.OPENCODE, model_id="m"),
        )
        archived = await bots.archive("ws_1", created.bot_id)
        assert archived.status is BotStatus.ARCHIVED
        assert (await bots.get("ws_1", created.bot_id)).bot_id == created.bot_id

    async def test_another_workspaces_bot_is_invisible(self, bots: BotService) -> None:
        await make_bot(bot_repo_of(bots), "ws_other")
        with pytest.raises(BotNotFound):
            await bots.get("ws_1", "bot_whatever")

    async def test_simple_bot_must_use_the_deterministic_provider(self, bots: BotService) -> None:
        with pytest.raises(ValidationFailure, match="deterministic"):
            await bots.create(
                "ws_1",
                Bot(
                    bot_id="",
                    workspace_id="ws_1",
                    name="Rules",
                    bot_type=BotType.SIMPLE,
                    provider=Provider.OPENCODE,
                    model_id="space-bunny-free",
                    deterministic_rules=[DeterministicRule(trigger="hi", response="yo")],
                    temperature=0.0,
                ),
            )


def bot_repo_of(bots: BotService) -> FakeBotRepository:
    return bots._bots


# --- runs ----------------------------------------------------------------


class TestRunService:
    async def test_start_persists_a_queued_run_and_starts_one_workflow(
        self, runs: RunService, bot_repo: FakeBotRepository, starter: FakeRunStarter
    ) -> None:
        bot = await make_bot(bot_repo)
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hello"))
        assert run.status.value == "queued"
        assert len(starter.started) == 1
        request, workflow_id = starter.started[0]
        assert workflow_id == f"run:{run.run_id}"
        assert request.bot_version_id == bot.versions[0].version_id

    async def test_start_captures_the_model_configuration_on_the_run(
        self, runs: RunService, bot_repo: FakeBotRepository
    ) -> None:
        """Rule 36: a run must be reproducible, so the model config is frozen onto the run row."""
        bot = await make_bot(bot_repo, temperature=0.7)
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi"))
        assert run.model.provider is Provider.OPENCODE
        assert run.model.temperature == 0.7
        # Changing the bot afterwards must not change what this run captured.
        await bot_repo.update(
            bot.model_copy(update={"temperature": 0.1}),
            version=BotVersion(
                bot_id=bot.bot_id,
                version_id=new_id("botver"),
                version="1.1.0",
                created_at=NOW,
                model_spec=bot.model_snapshot(),
                instructions=bot.instructions,
            ),
            notes="new",
        )
        assert (await runs.get("ws_1", run.run_id)).model.temperature == 0.7

    async def test_disabled_or_archived_bot_cannot_start_a_run(
        self, runs: RunService, bot_repo: FakeBotRepository, starter: FakeRunStarter
    ) -> None:
        bot = await make_bot(bot_repo, enabled=False)
        with pytest.raises(BotNotRunnable, match="disabled"):
            await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi"))
        assert not starter.started

        archived = await make_bot(bot_repo, name="Archived", status=BotStatus.ARCHIVED)
        with pytest.raises(BotNotRunnable, match="archived"):
            await runs.start("ws_1", StartRunCommand(bot_id=archived.bot_id, input="hi"))

    async def test_missing_bot_is_not_runnable(self, runs: RunService) -> None:
        with pytest.raises(BotNotRunnable, match="not found"):
            await runs.start("ws_1", StartRunCommand(bot_id="bot_nope", input="hi"))

    async def test_get_is_workspace_scoped(self, runs: RunService, bot_repo: FakeBotRepository) -> None:
        bot = await make_bot(bot_repo, "ws_1")
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi"))
        assert (await runs.get("ws_1", run.run_id)).run_id == run.run_id
        with pytest.raises(RunNotFound):
            await runs.get("ws_other", run.run_id)

    async def test_deadline_is_recorded_from_the_run_budget(self, runs: RunService, bot_repo) -> None:
        bot = await make_bot(bot_repo)
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi", timeout_seconds=42))
        assert run.deadline_at is not None
        assert (run.deadline_at - run.created_at).total_seconds() == pytest.approx(42, abs=1)

    async def test_history_carries_prior_turns_but_not_the_streaming_placeholder(
        self, runs: RunService, bot_repo, conversation_repo: FakeConversationRepository, starter
    ) -> None:
        """The placeholder the UI is watching must not be replayed to the model as context."""
        bot = await make_bot(bot_repo)
        conversation = await conversation_repo.add(
            Conversation(conversation_id="conv_1", workspace_id="ws_1", bot_id=bot.bot_id)
        )
        for content, sender, streaming in (
            ("first question", Sender.USER, False),
            ("first answer", Sender.BOT, False),
            ("second question", Sender.USER, False),
            ("", Sender.BOT, True),
        ):
            await conversation_repo.add_message(
                Message(
                    message_id=new_id("msg"),
                    conversation_id=conversation.conversation_id,
                    sender=sender,
                    content=content,
                    is_streaming=streaming,
                )
            )
        await runs.start(
            "ws_1",
            StartRunCommand(bot_id=bot.bot_id, input="now", conversation_id=conversation.conversation_id),
        )
        history = starter.started[0][0].history
        assert history[-1] == ("user", "second question")
        # The agent's ConversationTurn only accepts "user"/"assistant"; the message contract's "bot"
        # must be translated, or the second turn of every conversation fails validation.
        assert ("assistant", "first answer") in history
        assert ("user", "") not in history

    async def test_cancel_persists_the_terminal_state_before_asking_temporal(
        self, runs: RunService, run_repo: FakeRunRepository, bot_repo, starter: FakeRunStarter
    ) -> None:
        """Ordering matters: Temporal closes a cancelled workflow immediately, so the workflow-side
        cleanup activity would never run if the durable write came second."""
        bot = await make_bot(bot_repo)
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi"))
        state_when_cancelled: list[str] = []
        original_cancel = starter.cancel

        async def observe(run_id: str) -> bool:
            state_when_cancelled.append((await run_repo.get(run_id)).status.value)
            return await original_cancel(run_id)

        starter.cancel = observe  # type: ignore[method-assign]
        cancelled = await runs.cancel("ws_1", run.run_id)

        assert state_when_cancelled == ["cancelled"], "the durable write must precede the request"
        assert cancelled.status.value == "cancelled"
        assert starter.cancelled == [run.run_id]

    async def test_cancel_emits_a_run_cancelled_event(self, runs: RunService, run_repo, bot_repo) -> None:
        bot = await make_bot(bot_repo)
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi"))
        await runs.cancel("ws_1", run.run_id)
        events = await run_repo.events(run.run_id)
        assert [e.type.value for e in events] == ["run.cancelled"]

    async def test_cancel_is_a_no_op_on_a_finished_run(
        self, runs: RunService, run_repo: FakeRunRepository, starter: FakeRunStarter, bot_repo
    ) -> None:
        """The frontend's stop button can fire after the answer already landed; that must not be an
        error, and must not flip a succeeded run to cancelled."""
        bot = await make_bot(bot_repo)
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi"))
        await run_repo.finish(run.run_id, status=RunStatus.SUCCEEDED, finished_at=NOW)
        again = await runs.cancel("ws_1", run.run_id)
        assert again.status.value == "succeeded"
        assert not starter.cancelled

    async def test_events_are_workspace_scoped(self, runs: RunService, bot_repo) -> None:
        bot = await make_bot(bot_repo)
        run = await runs.start("ws_1", StartRunCommand(bot_id=bot.bot_id, input="hi"))
        with pytest.raises(RunNotFound):
            await runs.events("ws_other", run.run_id)

    async def test_history_is_workspace_scoped(
        self, runs: RunService, bot_repo, conversation_repo: FakeConversationRepository
    ) -> None:
        """A conversation id from another workspace must contribute no context, not leak context."""
        bot = await make_bot(bot_repo, "ws_1")
        await conversation_repo.add(
            Conversation(conversation_id="conv_other", workspace_id="ws_other", bot_id=bot.bot_id)
        )
        await conversation_repo.add_message(
            Message(
                message_id=new_id("msg"),
                conversation_id="conv_other",
                sender=Sender.USER,
                content="secret from another tenant",
            )
        )
        await runs.start(
            "ws_1",
            StartRunCommand(bot_id=bot.bot_id, input="hi", conversation_id="conv_other"),
        )
        assert _last_started(runs).history == ()

    async def test_empty_input_is_rejected(self) -> None:
        with pytest.raises(ValidationFailure, match="must not be empty"):
            RunService.assert_input("   ")


def _last_started(runs: RunService):
    return runs._starter.started[-1][0]


# --- conversations -------------------------------------------------------


class TestConversationService:
    async def test_prepare_turn_creates_a_user_message_and_a_streaming_placeholder(
        self, conversations: ConversationService, conversation_repo: FakeConversationRepository
    ) -> None:
        await conversation_repo.add(
            Conversation(conversation_id="conv_1", workspace_id="ws_1", bot_id="bot_1")
        )
        turn = await conversations.prepare_turn("ws_1", "conv_1", content="hello")
        assert turn.user_message.sender is Sender.USER
        assert turn.user_message.content == "hello"
        assert turn.assistant_message.sender is Sender.BOT
        assert turn.assistant_message.is_streaming is True, "the UI keys its typing indicator off this"

    async def test_empty_turn_without_attachments_is_rejected(
        self, conversations: ConversationService, conversation_repo
    ) -> None:
        await conversation_repo.add(
            Conversation(conversation_id="conv_1", workspace_id="ws_1", bot_id="bot_1")
        )
        with pytest.raises(ValidationFailure, match="content or an attachment"):
            await conversations.prepare_turn("ws_1", "conv_1", content="   ")

    async def test_attachment_only_turn_is_allowed(
        self, conversations: ConversationService, conversation_repo
    ) -> None:
        await conversation_repo.add(
            Conversation(conversation_id="conv_1", workspace_id="ws_1", bot_id="bot_1")
        )
        turn = await conversations.prepare_turn(
            "ws_1",
            "conv_1",
            content="",
            attachments=[Attachment(name="a.pdf", size_formatted="1.0 MB", type="pdf")],
        )
        assert turn.user_message.attachments[0].name == "a.pdf"

    async def test_feedback_is_recorded_and_validated(
        self, conversations: ConversationService, conversation_repo
    ) -> None:
        await conversation_repo.add(
            Conversation(conversation_id="conv_1", workspace_id="ws_1", bot_id="bot_1")
        )
        turn = await conversations.prepare_turn("ws_1", "conv_1", content="hi")
        updated = await conversations.set_feedback("ws_1", turn.assistant_message.message_id, "bad")
        assert updated.feedback is not None and updated.feedback.value == "bad"
        with pytest.raises(ValidationFailure, match="good"):
            await conversations.set_feedback("ws_1", turn.assistant_message.message_id, "meh")

    async def test_feedback_is_workspace_scoped(
        self, conversations: ConversationService, conversation_repo
    ) -> None:
        await conversation_repo.add(
            Conversation(conversation_id="conv_1", workspace_id="ws_1", bot_id="bot_1")
        )
        turn = await conversations.prepare_turn("ws_1", "conv_1", content="hi")
        with pytest.raises(MessageNotFound):
            await conversations.set_feedback("ws_other", turn.assistant_message.message_id, "good")

    async def test_cross_workspace_read_is_a_not_found(
        self, conversations: ConversationService, conversation_repo
    ) -> None:
        await conversation_repo.add(
            Conversation(conversation_id="conv_1", workspace_id="ws_other", bot_id="bot_1")
        )
        with pytest.raises(ConversationNotFound):
            await conversations.get("ws_1", "conv_1")

    async def test_unknown_mode_is_a_validation_failure(self, conversations: ConversationService) -> None:
        with pytest.raises(ValidationFailure, match="unknown conversation mode"):
            await conversations.create("ws_1", bot_id="bot_1", mode="telepathy")


# --- tools ---------------------------------------------------------------


def make_tool_version(tool_id: str, **overrides) -> ToolVersion:
    defaults = {
        "tool_id": tool_id,
        "version_id": new_id("toolver"),
        "version": 1,
        "created_at": NOW,
        "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
        "output_schema": {"type": "object"},
        "permissions": (ToolPermission.NETWORK,),
        "handler": "http",
        "handler_config": {"url": "https://example.test/search"},
    }
    return ToolVersion(**{**defaults, **overrides})


class TestToolService:
    async def test_create_persists_the_first_version(self) -> None:
        repo = FakeToolRepository()
        tools = ToolService(repo)
        draft = Tool(tool_id=new_id("tool"), workspace_id="ws_1", name="Search")
        tool = await tools.create("ws_1", draft, version=make_tool_version(draft.tool_id))
        assert tool.version == 1
        assert tool.active_version().handler == "http"

    async def test_update_without_a_contract_change_appends_no_version(self) -> None:
        repo = FakeToolRepository()
        tools = ToolService(repo)
        draft = Tool(tool_id=new_id("tool"), workspace_id="ws_1", name="Search")
        await tools.create("ws_1", draft, version=make_tool_version(draft.tool_id))
        updated = await tools.update("ws_1", draft.tool_id, {"name": "Web Search"})
        assert updated.version == 1
        assert len(updated.versions) == 1

    async def test_update_of_the_contract_appends_an_immutable_version(self) -> None:
        repo = FakeToolRepository()
        tools = ToolService(repo)
        draft = Tool(tool_id=new_id("tool"), workspace_id="ws_1", name="Search")
        created = await tools.create("ws_1", draft, version=make_tool_version(draft.tool_id))
        updated = await tools.update(
            "ws_1",
            created.tool_id,
            {"timeout_seconds": 45.0, "input_schema": {"type": "object", "properties": {}}},
        )
        assert updated.version == 2
        assert [v.version for v in updated.versions] == [2, 1]
        assert updated.versions[1].timeout_seconds == 20.0, "history is not rewritten"
        assert updated.versions[0].timeout_seconds == 45.0

    async def test_permission_change_also_appends_a_version(self) -> None:
        repo = FakeToolRepository()
        tools = ToolService(repo)
        draft = Tool(tool_id=new_id("tool"), workspace_id="ws_1", name="Search")
        created = await tools.create("ws_1", draft, version=make_tool_version(draft.tool_id))
        updated = await tools.update(
            "ws_1",
            created.tool_id,
            {"permissions": [ToolPermission.NETWORK, ToolPermission.DATABASE_READ]},
        )
        assert updated.version == 2
        assert updated.versions[0].permissions == (ToolPermission.NETWORK, ToolPermission.DATABASE_READ)
        assert updated.versions[1].permissions == (ToolPermission.NETWORK,)

    async def test_tool_without_an_input_schema_is_rejected(self) -> None:
        tools = ToolService(FakeToolRepository())
        draft = Tool(tool_id=new_id("tool"), workspace_id="ws_1", name="Search")
        with pytest.raises(ValidationFailure, match="input_schema"):
            await tools.create("ws_1", draft, version=make_tool_version(draft.tool_id, input_schema={}))

    async def test_unknown_tool_is_a_not_found(self) -> None:
        tools = ToolService(FakeToolRepository())
        with pytest.raises(ToolNotFound):
            await tools.get("ws_1", "tool_nope")

    async def test_delete_removes_the_tool(self) -> None:
        repo = FakeToolRepository()
        tools = ToolService(repo)
        draft = Tool(tool_id=new_id("tool"), workspace_id="ws_1", name="Search")
        await tools.create("ws_1", draft, version=make_tool_version(draft.tool_id))
        await tools.delete("ws_1", draft.tool_id)
        with pytest.raises(ToolNotFound):
            await tools.get("ws_1", draft.tool_id)


# --- knowledge -----------------------------------------------------------


class TestKnowledgeService:
    async def test_ingest_writes_bytes_and_creates_uploading_sources(self) -> None:
        repo = FakeKnowledgeRepository()
        blobs = InMemoryBlobStore()
        service = KnowledgeService(repo, blobs)
        sources = await service.ingest(
            "ws_1",
            [("notes.txt", "text/plain", BytesIO(b"hello world"))],
        )
        assert len(sources) == 1
        source = sources[0]
        assert source.status is KnowledgeStatus.UPLOADING
        assert source.progress_percent == 20, "the frontend renders this immediately"
        assert source.files[0].size_bytes == 11
        assert blobs.read(blobs.path_for("ws_1", source.source_id, "notes.txt")) == b"hello world"

    async def test_ingest_starts_durable_indexing(self) -> None:
        """Uploading only writes bytes; indexing is a workflow, started by the stable id (Rule 14/18)."""
        started: list[tuple[str, str]] = []

        class RecordingStarter:
            async def start(self, request, *, workflow_id: str) -> str:
                started.append((request.source_id, workflow_id))
                return workflow_id

        service = KnowledgeService(FakeKnowledgeRepository(), InMemoryBlobStore(), RecordingStarter())
        sources = await service.ingest("ws_1", [("a.txt", "text/plain", BytesIO(b"x"))])
        assert started == [(sources[0].source_id, f"kb:{sources[0].source_id}")]

    async def test_ingest_without_a_starter_still_works(self) -> None:
        """Unit tests and any non-Temporal caller are not forced to provide a starter."""
        service = KnowledgeService(FakeKnowledgeRepository(), InMemoryBlobStore())
        assert len(await service.ingest("ws_1", [("a.txt", "text/plain", BytesIO(b"x"))])) == 1

    async def test_oversized_file_is_refused(self) -> None:
        service = KnowledgeService(FakeKnowledgeRepository(), InMemoryBlobStore())
        from app.application.knowledge_service import MAX_FILE_BYTES

        payload = b"x" * (MAX_FILE_BYTES + 1)
        with pytest.raises(FileTooLarge):
            await service.ingest("ws_1", [("big.bin", "application/octet-stream", BytesIO(payload))])

    async def test_status_advances_through_the_state_machine(self) -> None:
        service = KnowledgeService(FakeKnowledgeRepository(), InMemoryBlobStore())
        source = (await service.ingest("ws_1", [("a.txt", "text/plain", BytesIO(b"x"))]))[0]
        processing = await service.advance("ws_1", source.source_id, "Processing")
        assert processing.progress_percent == 45
        indexing = await service.advance("ws_1", source.source_id, "Indexing", chunks_count=3)
        assert indexing.chunks_count == 3
        ready = await service.advance("ws_1", source.source_id, "Ready")
        assert ready.progress_percent == 100 and ready.status.is_terminal

    async def test_cannot_skip_a_state(self) -> None:
        service = KnowledgeService(FakeKnowledgeRepository(), InMemoryBlobStore())
        source = (await service.ingest("ws_1", [("a.txt", "text/plain", BytesIO(b"x"))]))[0]
        with pytest.raises(Exception, match="illegal knowledge transition"):
            await service.advance("ws_1", source.source_id, "Ready")

    async def test_re_entering_the_same_status_is_idempotent(self) -> None:
        """A retried activity must not fail on its own retry (Rule 18)."""
        service = KnowledgeService(FakeKnowledgeRepository(), InMemoryBlobStore())
        source = (await service.ingest("ws_1", [("a.txt", "text/plain", BytesIO(b"x"))]))[0]
        await service.advance("ws_1", source.source_id, "Processing")
        again = await service.advance("ws_1", source.source_id, "Processing")
        assert again.status is KnowledgeStatus.PROCESSING

    async def test_failure_records_the_reason(self) -> None:
        service = KnowledgeService(FakeKnowledgeRepository(), InMemoryBlobStore())
        source = (await service.ingest("ws_1", [("a.txt", "text/plain", BytesIO(b"x"))]))[0]
        failed = await service.advance("ws_1", source.source_id, "Failed", error="unreadable PDF")
        assert failed.error == "unreadable PDF"

    async def test_delete_removes_the_row_and_the_blob(self) -> None:
        repo = FakeKnowledgeRepository()
        blobs = InMemoryBlobStore()
        service = KnowledgeService(repo, blobs)
        source = (await service.ingest("ws_1", [("a.txt", "text/plain", BytesIO(b"x"))]))[0]
        path = blobs.path_for("ws_1", source.source_id, "a.txt")
        await service.delete("ws_1", source.source_id)
        assert not repo.sources
        assert str(path) not in blobs.blobs

    def test_chunking_is_deterministic_and_bounded(self) -> None:
        text = "\n\n".join(f"paragraph {i}" for i in range(50))
        first = chunk_text(text, size=100)
        assert first == chunk_text(text, size=100), "re-indexing must produce identical chunks"
        assert all(len(c) <= 100 for c in first)
        assert chunk_text("") == []


# --- models --------------------------------------------------------------


class TestModelService:
    async def test_catalogue_merges_every_provider(self) -> None:
        def build(name: str):
            return _StaticCatalog(
                [CatalogModel(provider=Provider(name), model_id=f"{name}-model", label="L", free=True)]
            )

        service = ModelService(build, _default_config(), ("opencode", "deepseek"))
        models = await service.catalogue()
        assert {m.model_id for m in models} == {"opencode-model", "deepseek-model"}

    async def test_one_failing_provider_does_not_break_the_settings_page(self) -> None:
        def build(name: str):
            if name == "broken":
                raise RuntimeError("catalogue unreachable")
            return _StaticCatalog([])

        service = ModelService(build, _default_config(), ("broken", "opencode"))
        assert await service.catalogue() == []

    def test_default_config_comes_from_configuration_not_code(self) -> None:
        service = ModelService(lambda n: _StaticCatalog([]), _default_config(), ())
        assert service.default_model_config().model_id == "space-bunny-free"


class _StaticCatalog:
    def __init__(self, models: list[CatalogModel]) -> None:
        self._models = models

    async def models(self, *, force_refresh: bool = False) -> list[CatalogModel]:
        return self._models


def _default_config():
    from app.infrastructure.models.gateway import default_model_config

    return default_model_config(SETTINGS)
