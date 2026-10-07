"""The application's view of Temporal for builds: start and cancel durable build executions.

Same pattern as `TemporalRunStarter` (Rule 4/38): `BuildService` never learns what a workflow is,
and the stable `build:<build_id>` workflow id makes a retried `POST /bots/{id}/builds` idempotent
(Rule 18).
"""

from __future__ import annotations

from temporalio.client import Client, WorkflowHandle
from temporalio.exceptions import WorkflowAlreadyStartedError

from app.application.ports import BuildStarter
from app.infrastructure.logging_config import get_logger
from app.workflows.build_bot import BuildBotWorkflow, BuildSpec

logger = get_logger(__name__)


class TemporalBuildStarter(BuildStarter):
    def __init__(self, client: Client, *, task_queue: str) -> None:
        self._client = client
        self._task_queue = task_queue

    async def start(self, spec: BuildSpec, *, workflow_id: str) -> str:
        try:
            await self._client.start_workflow(
                BuildBotWorkflow.run,
                spec,
                id=workflow_id,
                task_queue=self._task_queue,
            )
        except WorkflowAlreadyStartedError:
            logger.info("build workflow already started", extra={"workflow_id": workflow_id})
        return workflow_id

    async def cancel(self, build_id: str) -> bool:
        handle: WorkflowHandle = self._client.get_workflow_handle(f"build:{build_id}")
        try:
            await handle.cancel()
        except Exception:
            logger.info("build cancellation was a no-op", extra={"build_id": build_id}, exc_info=True)
            return False
        return True
