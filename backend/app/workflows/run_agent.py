"""RunAgentWorkflow.

    START
      ↓ load bot version           (activity: LoadBotVersion)      ← checkpoint 1
      ↓ mark run started           (activity: StartRun)
      ↓ execute agent              (activity: ExecuteAgent)        ← the only model/tool work
      ↓ persist validated result   (activity: PersistRunResult)    ← checkpoint 2
      ↓ COMPLETE

Everything except the workflow's own branching happens in activities, so no external call is ever
made from workflow code (Rule 24). Failures are classified in one place (`fail_run`) and the
workflow re-raises so Temporal visibility records the true cause; cancellation persists a
`cancelled` run and re-raises `CancelledError` so the server records the cancellation.
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.workflow import ActivityCancellationType

from app.infrastructure.temporal.errors import (
    classify_activity_error,
    failure_from_exception,
    is_cancellation,
)
from app.workflows.contracts import RunAgentOutcome, RunAgentRequest

# Activities are imported lazily: importing them at module scope would drag SQLAlchemy and the whole
# infrastructure layer into the workflow sandbox.
with workflow.unsafe.imports_passed_through():
    from app.activities import persistence

LOAD_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=10),
    maximum_attempts=5,
)
# The agent already retries provider blips inside the model client; Temporal only covers worker-level
# failures, so a small policy here avoids multiplying attempts.
AGENT_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
    maximum_attempts=2,
)
PERSIST_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=10),
    maximum_attempts=5,
)
TERMINAL_RETRY = RetryPolicy(maximum_attempts=5, initial_interval=timedelta(seconds=1))


@workflow.defn(name="RunAgentWorkflow")
class RunAgentWorkflow:
    def __init__(self) -> None:
        self._request: RunAgentRequest | None = None

    @workflow.run
    async def run(self, request: RunAgentRequest) -> RunAgentOutcome:
        self._request = request
        try:
            spec = await self._load(request)
            await self._start(request)
            result = await self._execute(spec)
            await self._persist(request.run_id, result)
        except Exception as exc:
            # A cancelled activity surfaces either as CancelledError or wrapped in an ActivityError,
            # depending on how the cancellation raced the activity's completion. Both mean the user
            # stopped the run, not that the run failed.
            if is_cancellation(exc):
                await self._record_cancellation(request.run_id)
                raise
            failure = failure_from_exception(exc)
            await self._record_failure(request.run_id, failure.to_dict())
            raise

        return RunAgentOutcome(
            run_id=request.run_id,
            status="succeeded",
            output=result.get("response"),
            steps=result.get("steps", 0),
        )

    # --- steps ------------------------------------------------------------

    async def _load(self, request: RunAgentRequest) -> dict:
        return await workflow.execute_activity(
            persistence.load_bot_version,
            request,
            start_to_close_timeout=timedelta(seconds=30),
            schedule_to_close_timeout=timedelta(seconds=120),
            retry_policy=LOAD_RETRY,
        )

    async def _start(self, request: RunAgentRequest) -> None:
        await workflow.execute_activity(
            persistence.start_run,
            request,
            start_to_close_timeout=timedelta(seconds=20),
            retry_policy=PERSIST_RETRY,
        )

    async def _execute(self, spec: dict) -> dict:
        timeout = float(spec.get("timeout_seconds") or 180.0)
        return await workflow.execute_activity(
            persistence.execute_agent,
            spec,
            # The activity's own deadline matches the workflow budget so a hung model call cannot
            # outlive the run (Rule 17).
            start_to_close_timeout=timedelta(seconds=timeout),
            schedule_to_close_timeout=timedelta(seconds=timeout * 2),
            heartbeat_timeout=timedelta(seconds=30),
            retry_policy=AGENT_RETRY,
        )

    async def _persist(self, run_id: str, result: dict) -> None:
        await workflow.execute_activity(
            persistence.persist_run_result,
            {"run_id": run_id, "result": result},
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=PERSIST_RETRY,
        )

    async def _record_failure(self, run_id: str, failure: dict) -> None:
        try:
            await workflow.execute_activity(
                persistence.fail_run,
                {"run_id": run_id, "failure": failure},
                start_to_close_timeout=timedelta(seconds=20),
                retry_policy=TERMINAL_RETRY,
            )
        except Exception:
            workflow.logger.error("could not persist run failure", extra={"run_id": run_id})

    async def _record_cancellation(self, run_id: str) -> None:
        """Persist the cancellation *after* the workflow was cancelled.

        `ABANDON` keeps this activity detached from the already-cancelled scope, otherwise the
        cancellation would cancel our own cleanup and the run would stay `running` forever.
        """
        try:
            await workflow.execute_activity(
                persistence.cancel_run,
                {"run_id": run_id, "reason": "cancelled by user"},
                start_to_close_timeout=timedelta(seconds=20),
                retry_policy=TERMINAL_RETRY,
                cancellation_type=ActivityCancellationType.ABANDON,
            )
        except Exception:
            workflow.logger.warning("could not persist run cancellation", extra={"run_id": run_id})

    # --- helpers ----------------------------------------------------------

    @staticmethod
    def classify(error: Exception):
        """Exposed for tests: the taxonomy mapping used by the error path."""
        return classify_activity_error(error)
