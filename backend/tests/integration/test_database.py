"""State 2 — repository behaviour against a real Postgres."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.domain.accounts import User, Workspace
from app.domain.bots import Bot, BotType, BotVersion, DeterministicRule, bump_minor
from app.domain.conversations import Conversation, Message, Sender
from app.domain.failures import FailureKind, FailureReason, RunFailure
from app.domain.ids import new_id
from app.domain.knowledge import FileBlob, KnowledgeSource, KnowledgeStatus
from app.domain.models import ModelConfig, Provider
from app.domain.runs import Run, RunEvent, RunEventType, RunStatus
from app.domain.tools import (
    ConnectionState,
    Tool,
    ToolCategory,
    ToolPermission,
    ToolVersion,
)
from app.infrastructure.database.repositories.account_repository import (
    AccountRepository,
    EmailAlreadyRegistered,
)
from app.infrastructure.database.repositories.bot_repository import BotRepository
from app.infrastructure.database.repositories.conversation_repository import (
    ConversationRepository,
)
from app.infrastructure.database.repositories.knowledge_repository import KnowledgeRepository
from app.infrastructure.database.repositories.run_repository import RunRepository
from app.infrastructure.database.repositories.tool_repository import ToolRepository
from app.infrastructure.database.tables import BotVersionRow, RunEventRow
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError

from tests.integration.conftest import seed_workspace

pytestmark = pytest.mark.integration


def make_bot(workspace_id: str, bot_id: str, **overrides) -> Bot:
    base = {
        "bot_id": bot_id,
        "workspace_id": workspace_id,
        "name": "General Assistant",
        "provider": Provider.OPENCODE,
        "model_id": "space-bunny-free",
        "instructions": "be helpful",
    }
    base.update(overrides)
    return Bot(**base)


def make_version(bot: Bot, version: str, version_id: str, created_at: datetime) -> BotVersion:
    return BotVersion(
        bot_id=bot.bot_id,
        version_id=version_id,
        version=version,
        created_at=created_at,
        model_spec=bot.model_snapshot(),
        instructions=bot.instructions,
    )


class TestBotRepository:
    async def test_add_then_get_round_trips(self, session) -> None:
        await seed_workspace(session)
        repo = BotRepository(session)
        bot = make_bot("ws_test", "bot_1")
        version = make_version(bot, "1.0.0", "ver_1", datetime.now(UTC))
        await repo.add(bot, version=version, notes="Initial version")

        loaded = await repo.get("bot_1", "ws_test")
        assert loaded is not None
        assert loaded.name == "General Assistant"
        assert loaded.model == "Space Bunny Free"
        assert [v.version for v in loaded.versions] == ["1.0.0"]

    async def test_update_appends_a_version_without_touching_history(self, session) -> None:
        await seed_workspace(session)
        repo = BotRepository(session)
        bot = make_bot("ws_test", "bot_1")
        await repo.add(bot, version=make_version(bot, "1.0.0", "ver_1", datetime.now(UTC)))

        bot.instructions = "be rigorous"
        bot.version = bump_minor(bot.version)
        updated = await repo.update(
            bot,
            version=make_version(bot, bot.version, "ver_2", datetime.now(UTC)),
            notes="Tightened instructions",
        )
        assert [v.version for v in updated.versions] == ["1.1.0", "1.0.0"]

        versions = await repo.versions("bot_1", "ws_test")
        assert [v.notes for v in versions] == ["Tightened instructions", "Initial version"]

        oldest = await repo.version("ver_1")
        assert oldest.instructions == "be helpful", "history must be immutable"

    async def test_bot_versions_reject_updates_and_deletes(self, session) -> None:
        await seed_workspace(session)
        bot = make_bot("ws_test", "bot_1")
        await BotRepository(session).add(bot, version=make_version(bot, "1.0.0", "ver_1", datetime.now(UTC)))
        await session.commit()  # the violation below must not roll the setup rows back
        row = await session.get(BotVersionRow, "ver_1")
        row.notes = "tampered"
        with pytest.raises(DBAPIError, match="immutable"):
            await session.commit()
        await session.rollback()  # the failed statement poisons the transaction
        assert (await session.get(BotVersionRow, "ver_1")).notes == "Initial version"

    async def test_workspace_scoping(self, session) -> None:
        await seed_workspace(session, "ws_other")
        await seed_workspace(session, "ws_test")
        repo = BotRepository(session)
        bot = make_bot("ws_test", "bot_1")
        await repo.add(bot, version=make_version(bot, "1.0.0", "ver_1", datetime.now(UTC)))
        assert await repo.get("bot_1", "ws_other") is None
        assert await repo.list("ws_other") == []

    async def test_simple_bot_rules_survive_the_round_trip(self, session) -> None:
        await seed_workspace(session)
        bot = make_bot(
            "ws_test",
            "bot_simple",
            bot_type=BotType.SIMPLE,
            provider=Provider.DETERMINISTIC,
            model_id="none",
            temperature=0.0,
            deterministic_rules=[DeterministicRule(trigger="ping", response="pong")],
        )
        await BotRepository(session).add(bot, version=make_version(bot, "1.0.0", "ver_s", datetime.now(UTC)))
        loaded = await BotRepository(session).get("bot_simple", "ws_test")
        assert loaded.match_rule("ping please").response == "pong"
        assert loaded.model == "Deterministic (No Model)"


class TestToolRepository:
    async def test_tool_and_version_round_trip(self, session) -> None:
        await seed_workspace(session)
        tool = Tool(
            tool_id="tool_1",
            workspace_id="ws_test",
            name="Web Search",
            purpose="search",
            category=ToolCategory.SEARCH,
            connection_state=ConnectionState.CONNECTED,
        )
        version = ToolVersion(
            tool_id="tool_1",
            version_id="tv_1",
            version=1,
            created_at=datetime.now(UTC),
            input_schema={"type": "object"},
            output_schema={"type": "object"},
            permissions=(ToolPermission.NETWORK,),
        )
        repo = ToolRepository(session)
        await repo.add(tool, version=version)
        loaded = await repo.get("tool_1", "ws_test")
        assert loaded.active_version().version_id == "tv_1"
        assert await repo.get_many(["tool_1", "tool_missing"], "ws_test") != {}
        assert set(await repo.get_many(["tool_1", "tool_missing"], "ws_test")) == {"tool_1"}


class TestRunRepository:
    def make_run(self, run_id: str = "run_1") -> Run:
        return Run(
            run_id=run_id,
            workspace_id="ws_test",
            bot_id="bot_1",
            bot_version_id="ver_1",
            bot_version="1.0.0",
            model=ModelConfig(provider=Provider.OPENCODE, model_id="space-bunny-free"),
            input="hello",
        )

    async def test_add_is_idempotent(self, session) -> None:
        await seed_workspace(session)
        repo = RunRepository(session)
        run = self.make_run()
        await repo.add(run)
        again = await repo.add(self.make_run())
        assert again.run_id == run.run_id
        count = await session.scalar(select(func.count()).select_from(RunEventRow))
        assert count == 0

    async def test_events_get_gap_free_sequence_numbers(self, session) -> None:
        await seed_workspace(session)
        repo = RunRepository(session)
        await repo.add(self.make_run())
        for event_type in (RunEventType.RUN_STARTED, RunEventType.AGENT_STARTED, RunEventType.RUN_COMPLETED):
            stored = await repo.append_event(
                RunEvent(event_id=new_id("evt"), run_id="run_1", seq=1, type=event_type)
            )
            assert stored.seq in (1, 2, 3)

        events = await repo.events("run_1")
        assert [e.seq for e in events] == [1, 2, 3]
        assert [e.type for e in events] == [
            RunEventType.RUN_STARTED,
            RunEventType.AGENT_STARTED,
            RunEventType.RUN_COMPLETED,
        ]

    async def test_events_after_seq_filter(self, session) -> None:
        await seed_workspace(session)
        repo = RunRepository(session)
        await repo.add(self.make_run())
        for _ in range(3):
            await repo.append_event(
                RunEvent(event_id=new_id("evt"), run_id="run_1", seq=1, type=RunEventType.AGENT_STEP_STARTED)
            )
        assert [e.seq for e in await repo.events("run_1", after_seq=2)] == [3]

    async def test_replayed_event_append_is_a_no_op(self, session) -> None:
        await seed_workspace(session)
        repo = RunRepository(session)
        await repo.add(self.make_run())
        first = await repo.append_event(
            RunEvent(event_id="evt_1", run_id="run_1", seq=1, type=RunEventType.RUN_STARTED)
        )
        replay = await repo.append_event(
            RunEvent(event_id="evt_1", run_id="run_1", seq=1, type=RunEventType.RUN_STARTED)
        )
        assert first.seq == replay.seq, "a replay must report the sequence number that was stored"
        assert len(await repo.events("run_1")) == 1

    async def test_deltas_are_never_persisted(self, session) -> None:
        await seed_workspace(session)
        repo = RunRepository(session)
        await repo.add(self.make_run())
        with pytest.raises(ValueError, match="must not be persisted"):
            await repo.append_event(
                RunEvent(event_id=new_id("evt"), run_id="run_1", seq=1, type=RunEventType.AGENT_DELTA)
            )

    async def test_finish_is_idempotent(self, session) -> None:
        await seed_workspace(session)
        repo = RunRepository(session)
        await repo.add(self.make_run())
        failure = RunFailure(
            kind=FailureKind.MODEL,
            reason=FailureReason.MODEL_TIMEOUT,
            message="slow",
            retryable=True,
        )
        now = datetime.now(UTC)
        await repo.finish("run_1", status=RunStatus.FAILED, finished_at=now, failure=failure)
        await repo.finish("run_1", status=RunStatus.SUCCEEDED, finished_at=now, output="late")

        run = await repo.get("run_1")
        assert run.status is RunStatus.FAILED, "a second finish must not overwrite the outcome"
        assert run.failure.reason is FailureReason.MODEL_TIMEOUT


class TestConversationRepository:
    async def test_messages_are_returned_in_order(self, session) -> None:
        await seed_workspace(session)
        repo = ConversationRepository(session)
        conversation = Conversation(
            conversation_id="conv_1",
            workspace_id="ws_test",
            title="Cohort analysis",
            bot_id="bot_1",
        )
        await repo.add(conversation)
        await repo.add_message(
            Message(message_id="msg_1", conversation_id="conv_1", sender=Sender.USER, content="analyse Q3")
        )
        await repo.add_message(
            Message(
                message_id="msg_2",
                conversation_id="conv_1",
                sender=Sender.BOT,
                content="here you go",
                is_streaming=False,
            )
        )

        loaded = await repo.get("conv_1", "ws_test")
        assert [m.message_id for m in loaded.messages] == ["msg_1", "msg_2"]
        assert loaded.to_dict()["category"] == "today"

    async def test_update_message_replaces_content_and_payload(self, session) -> None:
        await seed_workspace(session)
        repo = ConversationRepository(session)
        await repo.add(Conversation(conversation_id="conv_1", workspace_id="ws_test", bot_id="bot_1"))
        message = Message(
            message_id="msg_1", conversation_id="conv_1", sender=Sender.BOT, content="", is_streaming=True
        )
        await repo.add_message(message)
        message.content = "final answer"
        message.is_streaming = False
        await repo.update_message(message)

        loaded = await repo.get("conv_1", "ws_test")
        assert loaded.messages[0].content == "final answer"
        assert loaded.messages[0].is_streaming is False

    async def test_rename_pin_delete(self, session) -> None:
        await seed_workspace(session)
        repo = ConversationRepository(session)
        await repo.add(Conversation(conversation_id="conv_1", workspace_id="ws_test", bot_id="bot_1"))
        assert await repo.rename("conv_1", "ws_test", "Renamed")
        assert not await repo.rename("conv_1", "ws_other", "Nope")
        assert await repo.set_pinned("conv_1", "ws_test", True)
        loaded = await repo.get("conv_1", "ws_test")
        assert loaded.title == "Renamed" and loaded.is_pinned
        assert await repo.delete("conv_1", "ws_test")
        assert await repo.get("conv_1", "ws_test") is None


class TestKnowledgeRepository:
    async def test_upload_then_index_progression(self, session) -> None:
        await seed_workspace(session)
        repo = KnowledgeRepository(session)
        source = KnowledgeSource(
            source_id="kb_1",
            workspace_id="ws_test",
            name="Sales & Revenue Cohorts",
            files=[
                FileBlob(
                    file_id="f_1",
                    filename="cohorts.csv",
                    content_type="text/csv",
                    size_bytes=1024,
                    checksum_sha256="abc",
                    storage_path="data/kb_1/f_1",
                )
            ],
        )
        await repo.add(source)

        ready = (
            source.advance_to(KnowledgeStatus.PROCESSING)
            .advance_to(KnowledgeStatus.INDEXING)
            .advance_to(KnowledgeStatus.READY, chunks_count=1480)
        )
        await repo.save(ready)

        loaded = await repo.get("kb_1", "ws_test")
        assert loaded.status is KnowledgeStatus.READY
        assert loaded.chunks_count == 1480
        assert loaded.file_count == 1

    async def test_delete_returns_storage_paths(self, session) -> None:
        await seed_workspace(session)
        repo = KnowledgeRepository(session)
        await repo.add(
            KnowledgeSource(
                source_id="kb_1",
                workspace_id="ws_test",
                name="n",
                files=[
                    FileBlob(
                        file_id="f_1",
                        filename="a.csv",
                        content_type="text/csv",
                        size_bytes=1,
                        checksum_sha256="x",
                        storage_path="data/kb_1/f_1",
                    )
                ],
            )
        )
        assert await repo.delete("kb_1", "ws_test") == ["data/kb_1/f_1"]
        assert await repo.delete("kb_1", "ws_test") == []


class TestAccountRepository:
    async def test_user_creation_is_unique_per_email(self, session) -> None:
        await seed_workspace(session)
        repo = AccountRepository(session)
        await repo.create_user(
            User(user_id="u_1", email="A@B.c", name="A", workspace_id="ws_test", password_hash="argon2$hash")
        )
        with pytest.raises(EmailAlreadyRegistered):
            await repo.create_user(
                User(
                    user_id="u_2",
                    email="a@b.c",
                    name="Other",
                    workspace_id="ws_test",
                    password_hash="argon2$hash",
                )
            )
        await session.rollback()  # the unique violation poisons the transaction

    async def test_usage_counters_increase(self, session) -> None:
        await seed_workspace(session)
        repo = AccountRepository(session)
        await repo.record_usage("ws_test", runs=3, tokens=2_000_000)
        workspace = await repo.get_workspace("ws_test")
        assert workspace.runs_used == 3
        assert workspace.tokens_used_million == pytest.approx(2.0)

    async def test_workspace_created_through_repository(self, session) -> None:
        repo = AccountRepository(session)
        workspace = Workspace(workspace_id="ws_new", name="New Workspace")
        await repo.create_workspace(workspace)
        assert (await repo.get_workspace("ws_new")).name == "New Workspace"
