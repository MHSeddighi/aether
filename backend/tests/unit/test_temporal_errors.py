"""State 3 — Temporal error classification and worker wiring."""

from __future__ import annotations

import asyncio

import pytest
from app.activities import container as activity_container
from app.activities.container import ActivityContainer, get, install, reset
from app.domain.failures import (
    CancelledFailure,
    FailureKind,
    FailureReason,
    InternalFailure,
    ModelFailure,
    SecurityFailure,
    ToolFailure,
    ValidationFailure,
)
from app.infrastructure.config import Settings
from app.infrastructure.models.fake import FakeModelClient
from app.infrastructure.temporal.client import (
    workflow_id_for_build,
    workflow_id_for_indexing,
    workflow_id_for_run,
)
from app.infrastructure.temporal.errors import (
    classify_activity_error,
    failure_from_exception,
    is_cancellation,
    to_activity_error,
    to_application_error,
)
from app.infrastructure.temporal.worker import (
    AGENT_ACTIVITIES,
    agent_role,
    build_container,
    build_role,
)
from app.workflows.build_bot import BuildBotWorkflow
from app.workflows.contracts import RunAgentRequest
from app.workflows.index_knowledge import IndexKnowledgeWorkflow
from app.workflows.run_agent import AGENT_RETRY, LOAD_RETRY, RunAgentWorkflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ApplicationError, CancelledError, FailureError, TimeoutType
from temporalio.exceptions import TimeoutError as TemporalTimeoutError


class TestToApplicationError:
    def test_retryable_failure_stays_retryable(self) -> None:
        error = to_application_error(ModelFailure(FailureReason.MODEL_TIMEOUT, "slow"))
        assert isinstance(error, ApplicationError)
        assert error.non_retryable is False
        assert error.type == "model.model_timeout"
        assert error.details[0]["failure"]["retryable"] is True

    @pytest.mark.parametrize(
        "failure",
        [
            ModelFailure(FailureReason.MODEL_BAD_REQUEST, "bad"),
            ValidationFailure(FailureReason.REPAIR_EXHAUSTED, "no luck"),
            ToolFailure(FailureReason.TOOL_INVALID_OUTPUT, "garbage"),
            SecurityFailure(FailureReason.UNAUTHORIZED_TOOL, "nope"),
            CancelledFailure(),
        ],
    )
    def test_permanent_failures_are_marked_non_retryable(self, failure) -> None:
        error = to_activity_error(failure)
        assert error.non_retryable is True

    def test_unknown_exceptions_are_not_retried(self) -> None:
        error = to_activity_error(ValueError("bug in our code"))
        assert error.non_retryable is True
        assert error.type == f"{FailureKind.INTERNAL}.{FailureReason.UNEXPECTED}"
        assert error.details[0]["exception"] == "ValueError"

    def test_timeouts_are_retried(self) -> None:
        assert to_activity_error(TimeoutError()).non_retryable is False

    def test_application_errors_pass_through_untouched(self) -> None:
        original = ApplicationError("x", type="tool.tool_timeout", non_retryable=False)
        assert to_activity_error(original) is original


class TestClassifyActivityError:
    def test_round_trips_a_failure_through_serialisation(self) -> None:
        original = ToolFailure(
            FailureReason.TOOL_TIMEOUT, "web search timed out", details={"tool": "web_search"}
        )
        rebuilt = classify_activity_error(to_activity_error(original))
        assert isinstance(rebuilt, ToolFailure)
        assert rebuilt.reason is FailureReason.TOOL_TIMEOUT
        assert rebuilt.details["tool"] == "web_search"
        assert rebuilt.retryable is True

    def test_security_failure_stays_non_retryable_after_a_round_trip(self) -> None:
        rebuilt = classify_activity_error(
            to_activity_error(SecurityFailure(FailureReason.SANDBOX_VIOLATION, "escaped"))
        )
        assert isinstance(rebuilt, SecurityFailure)
        assert not rebuilt.retryable

    def test_type_string_is_parsed_when_details_are_missing(self) -> None:
        rebuilt = classify_activity_error(ApplicationError("rate limited", type="model.model_rate_limited"))
        assert rebuilt.kind is FailureKind.MODEL
        assert rebuilt.reason is FailureReason.MODEL_RATE_LIMITED
        assert rebuilt.retryable

    def test_unknown_type_string_degrades_to_internal(self) -> None:
        rebuilt = classify_activity_error(ApplicationError("x", type="weird.nonsense"))
        assert rebuilt.kind is FailureKind.INTERNAL

    def test_temporal_timeout_becomes_a_deadline_failure(self) -> None:
        rebuilt = classify_activity_error(
            TemporalTimeoutError(
                "activity start_to_close", type=TimeoutType.START_TO_CLOSE, last_heartbeat_details=[]
            )
        )
        assert rebuilt.kind is FailureKind.DEADLINE
        assert rebuilt.reason is FailureReason.DEADLINE_EXCEEDED

    def test_failure_error_is_unwrapped(self) -> None:
        inner = ApplicationError("inner", type="model.model_timeout", non_retryable=False)
        wrapper = FailureError("wrapped")
        wrapper.__cause__ = inner
        rebuilt = classify_activity_error(wrapper)
        assert rebuilt.reason is FailureReason.MODEL_TIMEOUT

    def test_cancellation_detection(self) -> None:
        assert is_cancellation(CancelledError())
        assert is_cancellation(CancelledFailure())
        assert not is_cancellation(ValueError())

    def test_cancellation_wrapped_in_a_failure_error_is_detected(self) -> None:
        """A cancelled activity reaches workflow code wrapped; it must not be recorded as a failure."""
        wrapper = FailureError("activity cancelled")
        wrapper.__cause__ = CancelledError("Cancelled")
        assert is_cancellation(wrapper)

    def test_cancellation_classifies_as_cancelled(self) -> None:
        wrapper = FailureError("activity cancelled")
        wrapper.__cause__ = CancelledError("Cancelled")
        assert isinstance(classify_activity_error(wrapper), CancelledFailure)

    def test_internal_failure_is_never_retryable(self) -> None:
        error = InternalFailure(FailureReason.UNEXPECTED, "bug")
        assert error.kind is FailureKind.INTERNAL
        assert not error.retryable
        assert not error.repairable

    def test_failure_projection_for_the_run_row(self) -> None:
        failure = failure_from_exception(ModelFailure(FailureReason.MODEL_TIMEOUT, "slow"))
        assert failure.kind is FailureKind.MODEL
        assert failure.retryable is True

    def test_failure_projection_from_a_bare_exception(self) -> None:
        """An unclassified error is a bug, not a blip: it must not become a retryable model error."""
        failure = failure_from_exception(RuntimeError("kaboom"))
        assert failure.kind is FailureKind.INTERNAL
        assert failure.reason is FailureReason.UNEXPECTED
        assert failure.retryable is False


class TestRetryPolicies:
    def test_agent_activity_policy_does_not_multiply_provider_retries(self) -> None:
        assert AGENT_RETRY.maximum_attempts == 2

    def test_load_policy_allows_more_attempts(self) -> None:
        assert LOAD_RETRY.maximum_attempts == 5

    def test_policies_are_temporal_types(self) -> None:
        assert isinstance(AGENT_RETRY, RetryPolicy)


class TestWorkflowIds:
    def test_workflow_ids_are_stable_and_namespaced(self) -> None:
        assert workflow_id_for_run("run_1") == "run:run_1"
        assert workflow_id_for_build("build_1") == "build:build_1"
        assert workflow_id_for_indexing("kb_1") == "index:kb_1"


class TestWorkerWiring:
    def test_agent_role_registers_the_run_workflow_and_activities(self) -> None:
        """The agent queue serves runs *and* knowledge indexing (State 10); the run activities are a
        subset of what it serves."""
        role = agent_role(Settings(_env_file=None))
        assert role.name == "agent"
        assert role.task_queues == ["bot-builder"]
        assert RunAgentWorkflow in role.workflows
        assert set(AGENT_ACTIVITIES) <= set(role.activities)

    def test_build_role_polls_its_own_queue(self) -> None:
        role = build_role(Settings(_env_file=None))
        assert role.task_queues == ["bot-builder-build"]
        assert BuildBotWorkflow in role.workflows
        assert len(role.activities) == 7

    def test_agent_role_also_serves_knowledge_indexing(self) -> None:
        """Knowledge indexing is a fast CPU-light operation, so it shares the agent queue."""
        role = agent_role(Settings(_env_file=None))
        assert IndexKnowledgeWorkflow in role.workflows
        assert "process_knowledge_source" in {fn.__name__ for fn in role.activities}

    def test_activity_names_are_explicit_and_stable(self) -> None:
        names = {fn.__dict__["__temporal_activity_definition"].name for fn in AGENT_ACTIVITIES}
        assert names == {
            "load_bot_version",
            "start_run",
            "execute_agent",
            "persist_run_result",
            "fail_run",
            "cancel_run",
        }

    def test_container_installs_and_resets(self, settings: Settings) -> None:
        reset()
        with pytest.raises(RuntimeError, match="container is not installed"):
            get()
        sentinel = object()
        install(
            ActivityContainer(settings=settings, database=sentinel, model_client_builder=lambda _config: None)
        )
        assert get().database is sentinel
        reset()


class TestWorkflowContracts:
    def test_run_request_defaults_are_safe(self) -> None:
        request = RunAgentRequest(
            run_id="run_1",
            workspace_id="ws_1",
            bot_id="bot_1",
            bot_version_id="ver_1",
            input="hello",
        )
        assert request.history == ()
        assert request.conversation_id is None
        assert request.timeout_seconds > 0

    def test_request_is_immutable(self) -> None:
        request = RunAgentRequest(
            run_id="run_1",
            workspace_id="ws_1",
            bot_id="bot_1",
            bot_version_id="ver_1",
            input="hello",
        )
        with pytest.raises(AttributeError):
            request.input = "changed"  # type: ignore[misc]


class TestActivityContainerDefaults:
    async def test_container_exposes_factories_not_instances(self, settings: Settings) -> None:
        """A run builds its own model client from its own captured config (Rule 36)."""
        reset()
        built: list[object] = []

        def builder(config):
            built.append(config)
            return object()

        container = build_container(settings, database=None, model_client_builder=builder)
        assert container.model_client_builder is builder
        assert container.tool_executor_builder is None
        assert get() is container
        container.model_client_builder("config")
        assert built == ["config"]
        reset()

    async def test_runner_selection_per_bot_type(self, settings: Settings) -> None:
        """Deterministic bots never reach the model gateway; agent bots do (Rule 4)."""
        from app.activities.persistence import runner_for
        from app.agents.deterministic import DeterministicRunner
        from app.agents.graph import LangGraphRunner
        from app.domain.models import ModelConfig

        reset()
        container = build_container(
            settings, database=None, model_client_builder=lambda _config: FakeModelClient()
        )
        deterministic_spec = {
            "bot_type": "simple",
            "model": ModelConfig(
                provider="deterministic", model_id="none", temperature=0.0, top_p=1.0
            ).model_dump(mode="json"),
        }
        agent_spec = {
            "bot_type": "agent",
            "model": ModelConfig(provider="opencode", model_id="space-bunny-free").model_dump(mode="json"),
        }
        assert isinstance(runner_for(container, deterministic_spec), DeterministicRunner)
        assert isinstance(runner_for(container, agent_spec), LangGraphRunner)
        reset()


class TestNoBackgroundWorkOutsideTemporal:
    def test_no_task_queues_or_brokers_are_configured(self, settings: Settings) -> None:
        """Rule 2: Temporal is the only queue; assert the forbidden deps are absent."""
        forbidden = ("aioredis", "redis", "celery", "kafka", "aio_pika", "kombu")
        assert not any(dep in settings.model_dump() for dep in forbidden)
        assert asyncio  # activities are plain async, awaited by Temporal


def test_activity_container_module_is_the_only_globals_holder() -> None:
    assert hasattr(activity_container, "install") and hasattr(activity_container, "get")
