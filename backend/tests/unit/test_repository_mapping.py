"""State 2 — repository mapping functions, exercised without a database.

Row objects are plain SQLAlchemy models, so the mapping layer (domain <-> row) can be tested
detached. Query behaviour is covered by `tests/integration/test_database.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.domain.bots import Bot, BotMetrics, BotType, DeterministicRule
from app.domain.conversations import (
    Attachment,
    AttachmentProposal,
    Message,
    MessageFeedback,
    Sender,
    ToolActivity,
    ToolActivityStatus,
)
from app.domain.models import Provider
from app.domain.runs import RunEventType, RunStatus
from app.infrastructure.database.repositories.bot_repository import (
    snapshot_of,
    version_from_snapshot,
)
from app.infrastructure.database.repositories.bot_repository import (
    to_domain as bot_to_domain,
)
from app.infrastructure.database.repositories.conversation_repository import (
    message_payload,
    message_to_domain,
)
from app.infrastructure.database.repositories.knowledge_repository import (
    to_domain as knowledge_to_domain,
)
from app.infrastructure.database.repositories.run_repository import (
    event_to_domain,
)
from app.infrastructure.database.repositories.run_repository import (
    to_domain as run_to_domain,
)
from app.infrastructure.database.repositories.tool_repository import (
    to_domain as tool_to_domain,
)
from app.infrastructure.database.repositories.tool_repository import (
    version_to_domain,
)
from app.infrastructure.database.tables import (
    BotRow,
    BotVersionRow,
    FileRow,
    KnowledgeSourceRow,
    MessageRow,
    RunEventRow,
    RunRow,
    ToolRow,
    ToolVersionRow,
)

NOW = datetime.now(UTC)


def test_bot_snapshot_captures_everything_needed_to_replay_a_run() -> None:
    bot = Bot(
        bot_id="bot_1",
        workspace_id="ws_1",
        name="Research",
        bot_type=BotType.AGENT,
        provider=Provider.OPENCODE,
        model_id="space-bunny-free",
        instructions="be rigorous",
        tool_ids=["tool-web-search"],
        knowledge_ids=["kb-1"],
        temperature=0.2,
    )
    snapshot = snapshot_of(bot)
    assert snapshot["model_spec"]["provider"] == "opencode"
    assert snapshot["model_spec"]["model_id"] == "space-bunny-free"
    assert snapshot["instructions"] == "be rigorous"
    assert snapshot["tool_ids"] == ["tool-web-search"]
    assert snapshot["knowledge_ids"] == ["kb-1"]


def test_bot_version_round_trips_through_a_snapshot() -> None:
    bot = Bot(
        bot_id="bot_1",
        workspace_id="ws_1",
        name="Simple",
        bot_type=BotType.SIMPLE,
        provider=Provider.DETERMINISTIC,
        model_id="none",
        temperature=0.0,
        instructions="rules only",
        deterministic_rules=[DeterministicRule(trigger="ping", response="pong")],
    )
    row = BotVersionRow(
        version_id="ver_1",
        bot_id="bot_1",
        workspace_id="ws_1",
        version="1.0.0",
        notes="initial",
        snapshot=snapshot_of(bot),
        created_at=NOW,
    )
    version = version_from_snapshot(row)
    assert version.version_id == "ver_1"
    assert version.model_spec.provider is Provider.DETERMINISTIC
    assert version.model_spec.label == "Deterministic (No Model)"
    assert version.deterministic_rules[0].trigger == "ping"


def test_bot_row_maps_back_to_the_domain_model() -> None:
    row = BotRow(
        id="bot_1",
        workspace_id="ws_1",
        name="General Assistant",
        description="d",
        avatar_icon="Bot",
        avatar_bg="bg-x",
        bot_type="agent",
        provider="opencode",
        model_id="space-bunny-free",
        instructions="i",
        tool_ids=["tool-a"],
        knowledge_ids=[],
        deterministic_rules=[],
        temperature=0.3,
        top_p=0.95,
        max_output_tokens=2048,
        status="active",
        enabled=True,
        version="1.2.0",
        metrics=BotMetrics(
            total_runs=10, avg_latency_ms=100, tokens_consumed=5, success_rate_percent=99.4
        ).model_dump(),
        billing_usage=None,
        created_at=NOW,
        updated_at=NOW,
        last_used_at=None,
    )
    bot = bot_to_domain(row, [])
    assert bot.model == "Space Bunny Free"
    assert bot.metrics.success_rate_percent == 99.4
    assert bot.name_fa is None


def test_tool_version_maps_permissions() -> None:
    row = ToolVersionRow(
        version_id="tv_1",
        tool_id="tool_1",
        workspace_id="ws_1",
        version=1,
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        handler="http",
        handler_config={"url": "https://example.com"},
        timeout_seconds=15.0,
        permissions=["network"],
        created_at=NOW,
    )
    version = version_to_domain(row)
    assert version.handler == "http"
    assert [str(p) for p in version.permissions] == ["network"]
    assert version.timeout_seconds == 15.0

    tool = tool_to_domain(
        ToolRow(
            id="tool_1",
            workspace_id="ws_1",
            name="Web Search",
            purpose="p",
            icon="Globe",
            connection_state="Connected",
            category="search",
            enabled=True,
            config={},
            version=1,
            created_at=NOW,
            updated_at=NOW,
        ),
        [row],
    )
    assert tool.active_version().timeout_seconds == 15.0


def test_knowledge_row_maps_files() -> None:
    source = knowledge_to_domain(
        KnowledgeSourceRow(
            id="kb_1",
            workspace_id="ws_1",
            name="Sales",
            type="csv",
            status="Ready",
            progress_percent=100,
            chunks_count=1480,
            created_at=NOW,
            updated_at=NOW,
        ),
        [
            FileRow(
                id="f_1",
                source_id="kb_1",
                workspace_id="ws_1",
                filename="cohorts.csv",
                content_type="text/csv",
                size_bytes=2048,
                checksum_sha256="abc",
                storage_path="data/kb_1/f_1",
                created_at=NOW,
            )
        ],
    )
    assert source.file_count == 1
    assert source.chunks_count == 1480
    assert source.files[0].storage_path == "data/kb_1/f_1"


def test_message_payload_only_stores_validated_projections() -> None:
    message = Message(
        message_id="m_1",
        conversation_id="c_1",
        sender=Sender.BOT,
        content="answer",
        tool_activity=[
            ToolActivity(
                name="SQL Database Connector",
                status=ToolActivityStatus.COMPLETED,
                detail="8,420 rows",
                tool_id="tool-sql-db",
            )
        ],
        attachments=[Attachment(name="cohorts.csv", size_formatted="18.4 MB", type="text/csv")],
        bot_proposal=AttachmentProposal(
            proposed={"name": "Sales Bot", "temperature": 0.15},
            code_snippet="print('hi')",
        ),
        feedback=MessageFeedback.GOOD,
    )
    payload = message_payload(message)
    assert set(payload) == {"bot_proposal", "tool_activity", "attachments", "feedback"}
    assert payload["tool_activity"][0]["detail"] == "8,420 rows"
    assert payload["bot_proposal"]["proposed"]["name"] == "Sales Bot"

    row = MessageRow(
        id="m_1",
        conversation_id="c_1",
        run_id=None,
        sender="bot",
        content="answer",
        is_streaming=False,
        payload=payload,
        created_at=NOW,
    )
    restored = message_to_domain(row)
    assert restored.tool_activity[0].name == "SQL Database Connector"
    assert restored.bot_proposal.proposed["name"] == "Sales Bot"
    assert restored.attachments[0].size_formatted == "18.4 MB"
    assert restored.feedback is MessageFeedback.GOOD


def test_empty_message_payload_has_no_optional_blocks() -> None:
    payload = message_payload(Message(message_id="m", conversation_id="c", sender=Sender.USER))
    assert payload == {}


def test_run_row_maps_failure_and_model_config() -> None:
    from app.domain.failures import FailureKind, FailureReason, RunFailure

    row = RunRow(
        id="run_1",
        workspace_id="ws_1",
        bot_id="bot_1",
        bot_version_id="ver_1",
        bot_version="1.0.0",
        model_config={
            "provider": "opencode",
            "model_id": "space-bunny-free",
            "temperature": 0.3,
            "top_p": 0.95,
            "max_output_tokens": 2048,
            "timeout_seconds": 60.0,
            "retry": {
                "max_attempts": 3,
                "initial_interval_seconds": 1.0,
                "backoff_coefficient": 2.0,
                "max_interval_seconds": 30.0,
            },
        },
        status="failed",
        input="hi",
        tool_activities=[],
        knowledge_sources=[],
        tokens_in=10,
        tokens_out=20,
        steps=1,
        repairs=0,
        created_at=NOW,
        failure=RunFailure(
            kind=FailureKind.MODEL,
            reason=FailureReason.MODEL_TIMEOUT,
            message="slow",
            retryable=True,
        ).model_dump(mode="json"),
    )
    run = run_to_domain(row)
    assert run.status is RunStatus.FAILED
    assert run.failure.reason is FailureReason.MODEL_TIMEOUT
    assert run.model.label == "Space Bunny Free"


def test_run_event_row_maps_type_and_seq() -> None:
    event = event_to_domain(
        RunEventRow(
            id="e_1",
            run_id="run_1",
            seq=7,
            type="tool.completed",
            data={"tool": "web_search"},
            created_at=NOW,
        )
    )
    assert event.seq == 7
    assert event.type is RunEventType.TOOL_COMPLETED
    assert event.data["tool"] == "web_search"
