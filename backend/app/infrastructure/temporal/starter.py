"""The application's view of Temporal: start and cancel durable run executions.

This adapter is the only place in the API process that touches the Temporal client, and it is written
against the `RunStarter` port so `RunService` never learns what a workflow is (Rule 4/38).

Idempotency comes from Temporal itself: the workflow id is `run:<run_id>`, so starting an execution
that already exists is a no-op rather than a second run (Rule 18).
"""

from __future__ import annotations

from temporalio.client import Client, WorkflowHandle
from temporalio.exceptions import WorkflowAlreadyStartedError

from app.application.ports import RunStarter
from app.infrastructure.logging_config import get_logger
from app.workflows.contracts import RunAgentRequest
from app.workflows.run_agent import RunAgentWorkflow

logger = get_logger(__name__)


class TemporalRunStarter(RunStarter):
    def __init__(self, client: Client, *, task_queue: str) -> None:
        self._client = client
        self._task_queue = task_queue

    async def start(self, request: RunAgentRequest, *, workflow_id: str) -> str:
        try:
            await self._client.start_workflow(
                RunAgentWorkflow.run,
                request,
                id=workflow_id,
                task_queue=self._task_queue,
            )
        except WorkflowAlreadyStartedError:
            # The run row and the workflow id are both derived from the run, so a retried start means
            # "this already exists", not "this failed".
            logger.info("run workflow already started", extra={"workflow_id": workflow_id})
        return workflow_id

    async def cancel(self, run_id: str) -> bool:
        handle: WorkflowHandle = self._client.get_workflow_handle(f"run:{run_id}")
        try:
            await handle.cancel()
        except Exception:
            # Already closed, or never started: the durable run state was already written, so this
            # is a completed cancellation, not a failure.
            logger.info("workflow cancellation was a no-op", extra={"run_id": run_id}, exc_info=True)
            return False
        return True
