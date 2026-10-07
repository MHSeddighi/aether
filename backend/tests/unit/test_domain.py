"""State 2 — domain models: labels, invariants, immutability, transitions, deadlines."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.domain.accounts import User, Workspace
from app.domain.bots import (
    Bot,
    BotBillingUsage,
    BotMetrics,
    BotMetricsAccumulator,
    BotStatus,
    BotType,
    BotVersion,
    DeterministicRule,
    bot_to_dict,
    bump_minor,
)
from app.domain.conversations import (
    Conversation,
    ConversationMode,
    HistoryCategory,
    Message,
    Sender,
    history_category,
)
from app.domain.deadline import Deadline
from app.domain.failures import (
    AgentError,
    CancelledFailure,
    FailureKind,
    FailureReason,
    ModelFailure,
    RunFailure,
    SecurityFailure,
    ToolFailure,
    ValidationFailure,
)
from app.domain.knowledge import (
    FileBlob,
    KnowledgeSource,
    KnowledgeStatus,
    KnowledgeType,
    format_size,
    knowledge_to_dict,
)
from app.domain.models import (
    DETERMINISTIC_LABEL,
    ModelConfig,
    Provider,
    deterministic_config,
    humanize_model_id,
)
from app.domain.runs import (
    Run,
    RunEvent,
    RunEventSequence,
    RunEventType,
    RunStatus,
    run_to_dict,
)
from app.domain.tools import (
    ConnectionState,
    Tool,
    ToolCategory,
    ToolPermission,
    ToolVersion,
    tool_to_dict,
)
from pydantic import ValidationError


def make_bot(**overrides) -> Bot:
    base = {
        "bot_id": "bot_1",
        "workspace_id": "ws_1",
        "name": "General Assistant",
        "description": "d",
        "provider": Provider.OPENCODE,
        "model_id": "space-bunny-free",
        "instructions": "be helpful",
        "temperature": 0.3,
        **overrides,
    }
    return Bot(**base)


def make_version(bot: Bot, version: str = "1.0.0", version_id: str = "ver_1") -> BotVersion:
    return BotVersion(
        bot_id=bot.bot_id,
        version_id=version_id,
        version=version,
        created_at=datetime.now(UTC),
        model_spec=bot.model_snapshot(),
        instructions=bot.instructions,
    )


class TestModelConfig:
    @pytest.mark.parametrize(
        ("model_id", "expected"),
        [
            ("space-bunny-free", "Space Bunny Free"),
            ("deepseek-chat", "Deepseek Chat"),
            ("deepseek/deepseek-v4.1-flash", "Deepseek V4.1 Flash"),
            ("glm-5.3-flash", "Glm 5.3 Flash"),
            ("gpt_5_nano", "Gpt 5 Nano"),
        ],
    )
    def test_labels_are_derived_deterministically(self, model_id: str, expected: str) -> None:
        assert humanize_model_id(model_id) == expected

    def test_deterministic_config_label(self) -> None:
        assert deterministic_config().label == DETERMINISTIC_LABEL

    def test_config_is_frozen(self) -> None:
        config = deterministic_config()
        with pytest.raises(ValidationError):
            config.temperature = 0.7  # type: ignore[misc]

    def test_deterministic_provider_rejects_non_zero_temperature(self) -> None:
        with pytest.raises(ValidationError, match="temperature=0"):
            ModelConfig(provider=Provider.DETERMINISTIC, model_id="none", temperature=0.5, top_p=1)

    def test_deterministic_provider_requires_none_model_id(self) -> None:
        with pytest.raises(ValidationError, match="requires model_id"):
            ModelConfig(provider=Provider.DETERMINISTIC, model_id="deepseek-chat")

    def test_invalid_model_id_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="unsupported characters"):
            ModelConfig(provider=Provider.OPENCODE, model_id="bad model id!")

    def test_provider_is_llm_flag(self) -> None:
        assert Provider.OPENCODE.is_llm
        assert not Provider.DETERMINISTIC.is_llm


class TestBot:
    def test_agent_bot_derives_model_label(self) -> None:
        bot = make_bot()
        assert bot.model == "Space Bunny Free"
        payload = bot_to_dict(bot)
        assert payload["model"] == "Space Bunny Free"
        assert payload["provider"] == "opencode"
        assert payload["modelId"] == "space-bunny-free"

    def test_simple_bot_uses_deterministic_label(self) -> None:
        bot = make_bot(
            bot_type=BotType.SIMPLE,
            provider=Provider.DETERMINISTIC,
            model_id="none",
            temperature=0.0,
            deterministic_rules=[DeterministicRule(trigger="ping", response="pong")],
        )
        assert bot.model == DETERMINISTIC_LABEL
        assert bot_to_dict(bot)["model"] == DETERMINISTIC_LABEL

    def test_simple_bot_requires_rules(self) -> None:
        with pytest.raises(ValidationError, match="deterministic rule"):
            make_bot(
                bot_type=BotType.SIMPLE, provider=Provider.DETERMINISTIC, model_id="none", temperature=0.0
            )

    def test_simple_bot_forbids_tools_and_knowledge(self) -> None:
        with pytest.raises(ValidationError, match="cannot use tools or knowledge"):
            make_bot(
                bot_type=BotType.SIMPLE,
                provider=Provider.DETERMINISTIC,
                model_id="none",
                temperature=0.0,
                deterministic_rules=[DeterministicRule(trigger="ping", response="pong")],
                tool_ids=["tool-1"],
            )

    def test_simple_bot_requires_zero_temperature(self) -> None:
        with pytest.raises(ValidationError, match="temperature 0"):
            make_bot(
                bot_type=BotType.SIMPLE,
                provider=Provider.DETERMINISTIC,
                model_id="none",
                temperature=0.7,
                deterministic_rules=[DeterministicRule(trigger="ping", response="pong")],
            )

    def test_blank_rule_trigger_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            DeterministicRule(trigger="   ", response="pong")

    def test_rule_matching_is_case_insensitive_and_ordered(self) -> None:
        bot = make_bot(
            bot_type=BotType.SIMPLE,
            provider=Provider.DETERMINISTIC,
            model_id="none",
            temperature=0.0,
            deterministic_rules=[
                DeterministicRule(trigger="status", response="all good"),
                DeterministicRule(trigger="status page", response="page status"),
            ],
        )
        assert bot.match_rule("Give me the STATUS page").response == "all good"
        assert bot.match_rule("nothing here") is None

    def test_serialised_shape_matches_frontend_bot_item(self) -> None:
        bot = make_bot()
        bot.versions = [make_version(bot)]
        bot.billing_usage = BotBillingUsage(monthly_estimated_cost=1.5, rpm_quota=100)
        payload = bot_to_dict(bot)
        assert set(payload) >= {
            "id",
            "name",
            "nameFa",
            "botType",
            "description",
            "avatarIcon",
            "avatarBg",
            "model",
            "instructions",
            "toolIds",
            "knowledgeIds",
            "temperature",
            "topP",
            "maxOutputTokens",
            "status",
            "enabled",
            "version",
            "versions",
            "metrics",
            "lastUsed",
        }
        assert payload["versions"][0]["version"] == "1.0.0"
        assert payload["versions"][0]["model"] == "Space Bunny Free"

    def test_archived_status_is_allowed(self) -> None:
        assert make_bot(status=BotStatus.ARCHIVED).status is BotStatus.ARCHIVED

    @pytest.mark.parametrize(
        ("current", "expected"),
        [("1.2.0", "1.3.0"), ("2.0.9", "2.1.9"), ("1.0", "1.0.1"), ("weird", "weird.1")],
    )
    def test_version_bump(self, current: str, expected: str) -> None:
        assert bump_minor(current) == expected

    def test_bot_version_is_immutable(self) -> None:
        version = make_version(make_bot())
        with pytest.raises(ValidationError):
            version.instructions = "changed"  # type: ignore[misc]


class TestBotMetrics:
    def test_accumulator_folds_runs(self) -> None:
        acc = BotMetricsAccumulator()
        acc.record(latency_ms=100, tokens=50, succeeded=True)
        acc.record(latency_ms=300, tokens=10, succeeded=False)
        metrics = acc.result()
        assert metrics.total_runs == 2
        assert metrics.avg_latency_ms == 200
        assert metrics.tokens_consumed == 60
        assert metrics.success_rate_percent == 50.0

    def test_accumulator_uses_previous_totals(self) -> None:
        acc = BotMetricsAccumulator(
            BotMetrics(total_runs=10, avg_latency_ms=200, tokens_consumed=1000, success_rate_percent=90.0)
        )
        acc.record(latency_ms=100, tokens=0, succeeded=True)
        metrics = acc.result()
        assert metrics.total_runs == 11
        assert metrics.success_rate_percent == 90.91
        assert metrics.tokens_consumed == 1000


class TestTool:
    def test_http_tool_requires_endpoint_and_network_permission(self) -> None:
        with pytest.raises(ValidationError, match=r"handler_config\.url"):
            ToolVersion(
                tool_id="t",
                version_id="v",
                version=1,
                created_at=datetime.now(UTC),
                input_schema={},
                output_schema={},
                handler="http",
            )
        with pytest.raises(ValidationError, match="network permission"):
            ToolVersion(
                tool_id="t",
                version_id="v",
                version=1,
                created_at=datetime.now(UTC),
                input_schema={},
                output_schema={},
                handler="http",
                handler_config={"url": "https://example.com"},
            )

    def test_unknown_handler_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="handler must be one of"):
            ToolVersion(
                tool_id="t",
                version_id="v",
                version=1,
                created_at=datetime.now(UTC),
                input_schema={},
                output_schema={},
                handler="telepathy",
            )

    def test_next_version_number_is_monotonic(self) -> None:
        tool = Tool(
            tool_id="t",
            workspace_id="ws",
            name="Web Search",
            version=3,
            versions=[
                ToolVersion(
                    tool_id="t",
                    version_id="v3",
                    version=3,
                    created_at=datetime.now(UTC),
                    input_schema={},
                    output_schema={},
                )
            ],
        )
        assert tool.next_version_number() == 4

    def test_serialised_shape_matches_frontend_tool_item(self) -> None:
        tool = Tool(
            tool_id="tool-web-search",
            workspace_id="ws",
            name="Web Search",
            purpose="search",
            category=ToolCategory.SEARCH,
            icon="Globe",
            connection_state=ConnectionState.CONNECTED,
            versions=[
                ToolVersion(
                    tool_id="tool-web-search",
                    version_id="v1",
                    version=1,
                    created_at=datetime.now(UTC),
                    input_schema={},
                    output_schema={},
                    permissions=(ToolPermission.NETWORK,),
                )
            ],
        )
        payload = tool_to_dict(tool)
        assert payload["id"] == "tool-web-search"
        assert payload["connectionState"] == "Connected"
        assert payload["permissions"] == ["network"]
        assert payload["timeoutSeconds"] == 20.0


class TestKnowledge:
    def test_status_literals_match_frontend(self) -> None:
        assert {str(s) for s in KnowledgeStatus} == {"Uploading", "Processing", "Indexing", "Ready", "Failed"}

    def test_type_inferred_from_filename(self) -> None:
        assert KnowledgeType.from_filename("report.pdf") is KnowledgeType.PDF
        assert KnowledgeType.from_filename("cohorts.csv") is KnowledgeType.CSV
        assert KnowledgeType.from_filename("notes.md") is KnowledgeType.TEXT
        assert KnowledgeType.from_filename("noextension") is KnowledgeType.TEXT

    def test_progression_is_enforced(self) -> None:
        source = KnowledgeSource(source_id="kb", workspace_id="ws", name="Sales")
        processing = source.advance_to(KnowledgeStatus.PROCESSING)
        indexing = processing.advance_to(KnowledgeStatus.INDEXING)
        ready = indexing.advance_to(KnowledgeStatus.READY, chunks_count=1480)
        assert ready.status is KnowledgeStatus.READY
        assert ready.progress_percent == 100
        assert ready.chunks_count == 1480

    def test_skipping_states_is_rejected(self) -> None:
        source = KnowledgeSource(source_id="kb", workspace_id="ws", name="Sales")
        with pytest.raises(ValidationFailure, match="illegal knowledge transition"):
            source.advance_to(KnowledgeStatus.READY)

    def test_terminal_states_are_final(self) -> None:
        ready = (
            KnowledgeSource(source_id="kb", workspace_id="ws", name="n")
            .advance_to(KnowledgeStatus.PROCESSING)
            .advance_to(KnowledgeStatus.INDEXING)
            .advance_to(KnowledgeStatus.READY)
        )
        assert ready.status.is_terminal
        with pytest.raises(ValidationFailure):
            ready.advance_to(KnowledgeStatus.INDEXING)

    def test_serialised_shape_matches_frontend_knowledge_item(self) -> None:
        source = KnowledgeSource(
            source_id="kb-sales",
            workspace_id="ws",
            name="Sales & Revenue Cohorts",
            type=KnowledgeType.CSV,
            files=[
                FileBlob(
                    file_id="f1",
                    filename="cohorts.csv",
                    content_type="text/csv",
                    size_bytes=1024 * 1024 * 2,
                    checksum_sha256="abc",
                    storage_path="x",
                )
            ],
        ).advance_to(KnowledgeStatus.PROCESSING)
        payload = knowledge_to_dict(source)
        assert payload["id"] == "kb-sales"
        assert payload["fileCount"] == 1
        assert payload["sizeFormatted"] == "2.0 MB"
        assert payload["status"] == "Processing"
        assert payload["progressPercent"] == 45

    def test_size_formatting(self) -> None:
        assert format_size(0) == "0.0 MB"
        assert format_size(18_450_000) == "17.6 MB"


class TestRun:
    def test_status_transitions(self) -> None:
        run = Run(
            run_id="run_1",
            workspace_id="ws",
            bot_id="b",
            bot_version_id="v",
            bot_version="1.0.0",
            model=deterministic_config(),
            input="hi",
        )
        assert run.status is RunStatus.QUEUED
        assert run.can_transition_to(RunStatus.RUNNING)
        assert not run.can_transition_to(RunStatus.SUCCEEDED)
        run.status = RunStatus.RUNNING
        assert run.can_transition_to(RunStatus.SUCCEEDED)

    def test_terminal_states_have_no_exits(self) -> None:
        run = Run(
            run_id="run_1",
            workspace_id="ws",
            bot_id="b",
            bot_version_id="v",
            bot_version="1.0.0",
            model=deterministic_config(),
            input="hi",
            status=RunStatus.CANCELLED,
        )
        assert run.status.is_terminal
        assert not run.can_transition_to(RunStatus.RUNNING)

    def test_only_meaningful_events_are_persisted(self) -> None:
        assert not RunEventType.AGENT_DELTA.is_persisted
        assert RunEventType.TOOL_COMPLETED.is_persisted
        assert RunEventType.RUN_COMPLETED.is_terminal

    def test_event_payload_uses_frontend_casing(self) -> None:
        event = RunEvent(
            event_id="evt_1", run_id="run_1", seq=3, type=RunEventType.AGENT_DELTA, data={"text": "hi"}
        )
        assert event.to_payload() == {
            "id": "evt_1",
            "runId": "run_1",
            "seq": 3,
            "type": "agent.delta",
            "ts": event.ts.isoformat(),
            "data": {"text": "hi"},
        }

    def test_sequence_allocator_is_monotonic(self) -> None:
        seq = RunEventSequence()
        assert [seq.take() for _ in range(3)] == [1, 2, 3]

    def test_serialised_run_captures_model_config(self) -> None:
        run = Run(
            run_id="run_1",
            workspace_id="ws",
            bot_id="b",
            bot_version_id="v",
            bot_version="1.0.0",
            model=ModelConfig(provider=Provider.OPENCODE, model_id="space-bunny-free"),
            input="hi",
            status=RunStatus.SUCCEEDED,
        )
        payload = run_to_dict(run)
        assert payload["model"]["provider"] == "opencode"
        assert payload["model"]["modelId"] == "space-bunny-free"
        assert payload["model"]["retry"]["max_attempts"] == 3
        assert payload["botVersionId"] == "v"

    def test_latency_requires_start(self) -> None:
        run = Run(
            run_id="r",
            workspace_id="ws",
            bot_id="b",
            bot_version_id="v",
            bot_version="1.0.0",
            model=deterministic_config(),
            input="hi",
        )
        assert run.latency_ms is None
        run.started_at = datetime.now(UTC) - timedelta(seconds=2)
        assert 1900 < run.latency_ms < 2100


class TestConversations:
    def test_message_payload_matches_frontend_chat_message(self) -> None:
        message = Message(message_id="m1", conversation_id="c1", sender=Sender.BOT, content="hi")
        assert message.to_dict() == {
            "id": "m1",
            "sender": "bot",
            "content": "hi",
            "timestamp": message.created_at.isoformat(),
            "isStreaming": False,
        }

    def test_conversation_without_messages_omits_the_key(self) -> None:
        conversation = Conversation(
            conversation_id="c", workspace_id="ws", bot_id="b", mode=ConversationMode.SIMPLE_BOT
        )
        payload = conversation.to_dict(include_messages=False)
        assert "messages" not in payload
        assert payload["mode"] == "simple-bot"
        assert payload["category"] == "today"

    def test_history_categories(self) -> None:
        now = datetime.now(UTC)
        assert history_category(now) is HistoryCategory.TODAY
        assert history_category(now - timedelta(days=1)) is HistoryCategory.YESTERDAY
        assert history_category(now - timedelta(days=3)) is HistoryCategory.PREVIOUS_7_DAYS
        assert history_category(now - timedelta(days=30)) is HistoryCategory.OLDER


class TestFailures:
    def test_retry_disposition_per_reason(self) -> None:
        assert ModelFailure(FailureReason.MODEL_TIMEOUT, "t").retryable
        assert ModelFailure(FailureReason.MODEL_RATE_LIMITED, "t").retryable
        assert not ModelFailure(FailureReason.MODEL_BAD_REQUEST, "t").retryable
        assert not ModelFailure(FailureReason.MODEL_AUTH, "t").retryable
        assert ToolFailure(FailureReason.TOOL_TIMEOUT, "t").retryable
        assert not ToolFailure(FailureReason.TOOL_INVALID_OUTPUT, "t").retryable

    def test_repairable_only_for_recoverable_validation(self) -> None:
        assert ValidationFailure(FailureReason.OUTPUT_SCHEMA, "s").repairable
        assert not ValidationFailure(FailureReason.REPAIR_EXHAUSTED, "s").repairable

    def test_security_failures_are_never_retried_or_repaired(self) -> None:
        error = SecurityFailure(FailureReason.UNAUTHORIZED_TOOL, "nope")
        assert not error.retryable
        assert not error.repairable
        assert error.kind is FailureKind.SECURITY

    def test_cancellation_is_terminal(self) -> None:
        error = CancelledFailure()
        assert error.kind is FailureKind.CANCELLED
        assert not error.retryable

    def test_run_failure_projection(self) -> None:
        failure = RunFailure.from_error(
            ModelFailure(FailureReason.MODEL_TIMEOUT, "slow", details={"model": "space-bunny-free"})
        )
        payload = failure.to_dict()
        assert payload["kind"] == "model"
        assert payload["reason"] == "model_timeout"
        assert payload["retryable"] is True
        assert payload["details"]["model"] == "space-bunny-free"

    def test_agent_error_serialises_all_fields(self) -> None:
        payload = ToolFailure(FailureReason.TOOL_TIMEOUT, "too slow").to_dict()
        assert payload == {
            "kind": "tool",
            "reason": "tool_timeout",
            "message": "too slow",
            "retryable": True,
            "details": {},
        }

    def test_every_failure_is_an_agent_error(self) -> None:
        assert isinstance(SecurityFailure(FailureReason.SANDBOX_VIOLATION, "x"), AgentError)


class TestDeadline:
    def test_budget_is_clamped_to_remaining(self) -> None:
        deadline = Deadline.in_seconds(30)
        assert deadline.budget(60) <= 30
        assert deadline.budget(5) == 5

    def test_budget_never_returns_zero(self) -> None:
        assert Deadline.at(datetime.now(UTC) - timedelta(seconds=5)).budget(10) > 0

    def test_expired_detection(self) -> None:
        assert Deadline.at(datetime.now(UTC) - timedelta(seconds=1)).expired
        assert not Deadline.in_seconds(5).expired

    def test_require_raises_classified_failure(self) -> None:
        with pytest.raises(AgentError) as excinfo:
            Deadline.in_seconds(1).require(10, what="tool call")
        assert excinfo.value.reason is FailureReason.DEADLINE_EXCEEDED
        assert excinfo.value.details["required_seconds"] == 10

    def test_naive_datetime_is_treated_as_utc(self) -> None:
        deadline = Deadline.at(datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=5))
        assert deadline.remaining_seconds > 0


class TestAccounts:
    def test_workspace_payload_matches_frontend_account(self) -> None:
        workspace = Workspace(
            workspace_id="ws-1", name="Acme AI Workspace", runs_used=1420, tokens_used_million=14.83
        )
        assert workspace.to_dict() == {
            "id": "ws-1",
            "name": "Acme AI Workspace",
            "plan": "Team Pro",
            "runsUsed": 1420,
            "runsLimit": 5000,
            "tokensUsedMillion": 14.83,
            "tokensLimitMillion": 50.0,
        }

    def test_user_payload_hides_hash(self) -> None:
        user = User(user_id="u", email="a@b.c", name="A", workspace_id="ws", password_hash="argon2$...")
        assert "argon2" not in str(user.to_dict())
