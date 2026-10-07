"""The application's view of Temporal for knowledge indexing.

Same pattern as `TemporalRunStarter`/`TemporalBuildStarter` (Rule 4/38): the use case never learns
what a workflow is. The stable `kb:<source_id>` workflow id makes a retried upload (or a retried
start) attach to the existing execution instead of indexing the same source twice (Rule 18).
"""

from __future__ import annotations

from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError

from app.application.ports import KnowledgeStarter
from app.infrastructure.logging_config import get_logger
from app.workflows.contracts import IndexKnowledgeRequest
from app.workflows.index_knowledge import IndexKnowledgeWorkflow

logger = get_logger(__name__)


class TemporalKnowledgeStarter(KnowledgeStarter):
    def __init__(self, client: Client, *, task_queue: str) -> None:
        self._client = client
        self._task_queue = task_queue

    async def start(self, request: IndexKnowledgeRequest, *, workflow_id: str) -> str:
        try:
            await self._client.start_workflow(
                IndexKnowledgeWorkflow.run,
                request,
                id=workflow_id,
                task_queue=self._task_queue,
            )
        except WorkflowAlreadyStartedError:
            logger.info("knowledge workflow already started", extra={"workflow_id": workflow_id})
        return workflow_id


def knowledge_workflow_id(source_id: str) -> str:
    return f"kb:{source_id}"
