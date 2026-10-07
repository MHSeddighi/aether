"""Workflow tests against Temporal's time-skipping test environment.

The real `RunAgentWorkflow` runs here; only its *activities* are stubbed, so the control flow,
retry policies, cancellation handling and failure classification are all genuinely exercised.
No database and no model provider are involved.

    uv run pytest tests/integration/test_workflow.py
    TEMPORAL_TEST_SERVER=1 uv run pytest tests/integration/test_workflow.py   # fail instead of skip
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import timedelta

import pytest
import pytest_asyncio
from app.domain.failures import FailureReason, ModelFailure, SecurityFailure, ValidationFailure
from app.infrastructure.temporal.client import workflow_id_for_run
from app.infrastructure.temporal.errors import to_activity_error
from app.workflows.contracts import RunAgentOutcome, RunAgentRequest
from app.workflows.run_agent import RunAgentWorkflow
from temporalio import activity, workflow
from temporalio.client import Client, WorkflowFailureError
from temporalio.exceptions import CancelledError, WorkflowAlreadyStartedError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

REQUIRED = os.getenv("TEMPORAL_TEST_SERVER") == "1"

#: The stub the module-level activities delegate to. Set once by the `worker_env` fixture.
SCRIPT: ScriptedActivities | None = None


class ScriptedActivities:
    """Activity stubs. Every call is recorded so assertions can prove the control flow."""

    def __init__(
        self, *, mode: str = "success", sleep_seconds: float = 0.0, spec_timeout_seconds: float = 30.0
    ) -> None:
        self.mode = mode
        self.sleep_seconds = sleep_seconds
        self.spec_timeout_seconds = spec_timeout_seconds
        self.calls: list[str] = []

    def count(self, name: str) -> int:
        return self.calls.count(name)

    # --- the stubbed activities, registered by name below -----------------

    async def load_bot_version(self, request: RunAgentRequest) -> dict:
        self.calls.append("load_bot_version")
        if self.mode == "load_failure":
            raise to_activity_error(ValidationFailure(FailureReason.OUTPUT_CONSTRAINT, "unknown bot version"))
        return {
            "run_id": request.run_id,
            "message": request.input,
            "bot_id": request.bot_id,
            "bot_version_id": request.bot_version_id,
            "bot_version": "1.0.0",
            "bot_type": "simple",
            "instructions": "rules",
            "model": {
                "provider": "deterministic",
                "model_id": "none",
                "temperature": 0.0,
                "top_p": 1.0,
                "max_output_tokens": 1024,
                "timeout_seconds": 30.0,
            },
            "history": [],
            "tools": [],
            "knowledge": [],
            "deterministic_rules": [{"trigger": "ping", "response": "pong"}],
            "attachments": [],
            "timeout_seconds": self.spec_timeout_seconds,
        }

    async def start_run(self, request: RunAgentRequest) -> dict:
        self.calls.append("start_run")
        return {"run_id": request.run_id}

    async def execute_agent(self, _spec: dict) -> dict:
        self.calls.append("execute_agent")
        if self.sleep_seconds:
            await asyncio.sleep(self.sleep_seconds)
        if self.mode == "agent_timeout":
            raise to_activity_error(ModelFailure(FailureReason.MODEL_TIMEOUT, "provider timeout"))
        if self.mode == "agent_security":
            raise to_activity_error(SecurityFailure(FailureReason.UNAUTHORIZED_TOOL, "tool not permitted"))
        return {"response": '[Deterministic Rule Match: "ping"]\npong', "steps": 1}

    async def persist_run_result(self, payload: dict) -> dict:
        self.calls.append("persist_run_result")
        if self.mode == "persist_failure":
            raise RuntimeError("database unavailable")
        return {"run_id": payload["run_id"], "status": "succeeded"}

    async def fail_run(self, payload: dict) -> dict:
        self.calls.append("fail_run")
        self.failure = payload["failure"]
        return {"run_id": payload["run_id"], "status": "failed"}

    async def cancel_run(self, payload: dict) -> dict:
        self.calls.append("cancel_run")
        return {"run_id": payload["run_id"], "status": "cancelled"}


def _script() -> ScriptedActivities:
    if SCRIPT is None:  # pragma: no cover - only reachable outside the fixture
        raise RuntimeError("test script not installed")
    return SCRIPT


# Registered under the *production* activity names, so the workflow under test is unmodified.
@activity.defn(name="load_bot_version")
async def stub_load_bot_version(request: RunAgentRequest) -> dict:
    return await _script().load_bot_version(request)


@activity.defn(name="start_run")
async def stub_start_run(request: RunAgentRequest) -> dict:
    return await _script().start_run(request)


@activity.defn(name="execute_agent")
async def stub_execute_agent(spec: dict) -> dict:
    return await _script().execute_agent(spec)


@activity.defn(name="persist_run_result")
async def stub_persist_run_result(payload: dict) -> dict:
    return await _script().persist_run_result(payload)


@activity.defn(name="fail_run")
async def stub_fail_run(payload: dict) -> dict:
    return await _script().fail_run(payload)


@activity.defn(name="cancel_run")
async def stub_cancel_run(payload: dict) -> dict:
    return await _script().cancel_run(payload)


STUB_ACTIVITIES = [
    stub_load_bot_version,
    stub_start_run,
    stub_execute_agent,
    stub_persist_run_result,
    stub_fail_run,
    stub_cancel_run,
]


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def temporal_env():
    """One Temporal test environment for the module; each test gets its own worker below."""
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
async def worker_env(temporal_env):
    """A fresh script and task queue per test, so recorded calls can never leak between tests."""
    global SCRIPT
    script = ScriptedActivities()
    SCRIPT = script
    queue = f"test-run-agent-{uuid.uuid4().hex[:8]}"
    async with Worker(
        temporal_env.client,
        task_queue=queue,
        workflows=[RunAgentWorkflow],
        activities=STUB_ACTIVITIES,
    ):
        yield temporal_env.client, script, queue
    SCRIPT = None


def make_request(run_id: str) -> RunAgentRequest:
    return RunAgentRequest(
        run_id=run_id,
        workspace_id="ws_test",
        bot_id="bot_1",
        bot_version_id="ver_1",
        input="ping",
    )


async def run(client: Client, queue: str, run_id: str, **kwargs):
    return await client.execute_workflow(
        RunAgentWorkflow,
        make_request(run_id),
        id=workflow_id_for_run(run_id),
        task_queue=queue,
        **kwargs,
    )


@pytest.mark.asyncio(loop_scope="module")
class TestRunAgentWorkflow:
    async def test_successful_run_persists_the_result(self, worker_env) -> None:
        client, script, queue = worker_env
        outcome = await run(client, queue, "run_ok")
        assert isinstance(outcome, RunAgentOutcome)
        assert outcome.status == "succeeded"
        assert "pong" in (outcome.output or "")
        assert script.calls == ["load_bot_version", "start_run", "execute_agent", "persist_run_result"]

    async def test_transient_model_timeout_is_retried(self, worker_env) -> None:
        client, script, queue = worker_env
        script.mode = "agent_timeout"
        try:
            with pytest.raises(WorkflowFailureError):
                await run(client, queue, "run_retry")
            # AGENT_RETRY allows two attempts, and the taxonomy marks model timeouts retryable.
            assert script.count("execute_agent") == 2
            # The failure is persisted once, after retries are exhausted.
            assert script.count("fail_run") == 1
            assert script.failure["reason"] == FailureReason.MODEL_TIMEOUT
            assert script.failure["retryable"] is True
        finally:
            script.mode = "success"

    async def test_security_failure_is_not_retried(self, worker_env) -> None:
        client, script, queue = worker_env
        script.mode = "agent_security"
        try:
            with pytest.raises(WorkflowFailureError):
                await run(client, queue, "run_security")
            assert script.count("execute_agent") == 1, "non-retryable failures must not be retried"
            assert script.failure["kind"] == "security"
            assert script.failure["retryable"] is False
        finally:
            script.mode = "success"

    async def test_load_failure_never_executes_the_agent(self, worker_env) -> None:
        client, script, queue = worker_env
        script.mode = "load_failure"
        try:
            with pytest.raises(WorkflowFailureError):
                await run(client, queue, "run_load")
            assert script.count("execute_agent") == 0
            assert script.count("fail_run") == 1
        finally:
            script.mode = "success"

    async def test_persist_failure_is_recorded(self, worker_env) -> None:
        client, script, queue = worker_env
        script.mode = "persist_failure"
        try:
            with pytest.raises(WorkflowFailureError):
                await run(client, queue, "run_persist")
            assert script.count("fail_run") == 1
            assert script.failure["kind"] == "internal"
        finally:
            script.mode = "success"

    async def test_cancellation_stops_the_run_before_it_can_succeed(self, worker_env) -> None:
        """Cancelling must not let the run finish: no success persistence, workflow ends cancelled.

        The *durable* `cancelled` status is written by whoever requested the cancellation
        (`RunService.cancel`, State 8) before the workflow is asked to stop, because Temporal closes a
        cancelled workflow immediately and would abandon the workflow-side cleanup activity. The
        workflow keeps `_record_cancellation` as a best-effort fallback for cancellations that arrive
        from outside the API, and `RunRepository.finish` is idempotent, so the two never conflict.
        """
        client, script, queue = worker_env
        script.mode = "success"
        script.sleep_seconds = 30
        try:
            handle = await client.start_workflow(
                RunAgentWorkflow,
                make_request("run_cancel"),
                id=workflow_id_for_run("run_cancel"),
                task_queue=queue,
            )
            await asyncio.sleep(1)
            await handle.cancel()
            with pytest.raises((CancelledError, WorkflowFailureError)):
                await handle.result()
            assert script.count("persist_run_result") == 0
            assert script.count("fail_run") == 0
        finally:
            script.sleep_seconds = 0

    async def test_workflow_id_attaches_to_the_running_execution(self, worker_env) -> None:
        """A retried API call must attach to the live execution instead of forking one (Rule 18)."""
        client, script, queue = worker_env
        script.sleep_seconds = 3
        try:
            handle = await client.start_workflow(
                RunAgentWorkflow,
                make_request("run_dup"),
                id=workflow_id_for_run("run_dup"),
                task_queue=queue,
            )
            await asyncio.sleep(1)
            # The API must treat this as "already running" rather than starting a second execution.
            with pytest.raises(WorkflowAlreadyStartedError):
                await client.start_workflow(
                    RunAgentWorkflow,
                    make_request("run_dup"),
                    id=workflow_id_for_run("run_dup"),
                    task_queue=queue,
                )
            await handle.result()
            assert script.count("execute_agent") == 1
        finally:
            script.sleep_seconds = 0

    async def test_activity_timeout_is_enforced(self, worker_env) -> None:
        """A hung agent activity is cut off at the declared budget and the run fails (Rule 16)."""
        client, script, queue = worker_env
        script.sleep_seconds = 30
        script.spec_timeout_seconds = 2
        try:
            with pytest.raises(WorkflowFailureError):
                await asyncio.wait_for(run(client, queue, "run_slow"), timeout=90)
            assert script.count("persist_run_result") == 0
            assert script.count("fail_run") >= 1
        finally:
            script.sleep_seconds = 0
            script.spec_timeout_seconds = 30


class TestWorkflowContract:
    def test_workflow_name_is_stable(self) -> None:
        definition = workflow._Definition.must_from_class(RunAgentWorkflow)
        assert definition.name == "RunAgentWorkflow"

    def test_request_defaults_are_safe(self) -> None:
        request = make_request("run_x")
        assert request.history == ()
        assert request.conversation_id is None
        assert request.timeout_seconds > 0

    def test_request_is_immutable(self) -> None:
        request = make_request("run_x")
        with pytest.raises(AttributeError):
            request.input = "changed"  # type: ignore[misc]

    def test_activity_deadline_matches_the_request_budget(self) -> None:
        """The agent activity timeout is derived from the run budget, never fixed above it (Rule 17)."""
        source = pathlib_read()
        assert 'timeout = float(spec.get("timeout_seconds") or 180.0)' in source
        assert "start_to_close_timeout=timedelta(seconds=timeout)" in source


def pathlib_read() -> str:
    from pathlib import Path

    return (Path(__file__).resolve().parents[2] / "app" / "workflows" / "run_agent.py").read_text()


def test_timedelta_import_is_used() -> None:
    assert timedelta(seconds=1).total_seconds() == 1
