"""IndexKnowledgeWorkflow: durable knowledge indexing with checkpoints.

    Uploading → Processing → Indexing → Ready
                                ↘ Failed

Every status transition is a durable checkpoint (Rule 31). The workflow is idempotent: re-entering
a status the source already has is a no-op (`KnowledgeSource.advance_to`), so a retried activity can
never double-count chunks or move a source backwards.
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from app.activities import knowledge as knowledge_activities
    from app.workflows.contracts import IndexKnowledgeRequest

LOAD_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=10),
    maximum_attempts=5,
)
PROCESS_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
    maximum_attempts=3,
)
INDEX_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=60),
    maximum_attempts=3,
)


@workflow.defn(name="IndexKnowledgeWorkflow")
class IndexKnowledgeWorkflow:
    """Index one knowledge source from Uploading to Ready (or Failed)."""

    @workflow.run
    async def run(self, request: IndexKnowledgeRequest) -> dict:
        try:
            await self._load(request)
            await self._advance(request, "Processing")
            processed = await self._process(request)
            await self._advance(request, "Indexing")
            indexed = await self._index(request, processed)
            await self._advance(request, "Ready", chunks_count=indexed.get("chunks_count", 0))
        except Exception as exc:
            failure = knowledge_activities.classify_index_error(exc)
            await self._fail(request, failure)
            raise

        return {
            "source_id": request.source_id,
            "status": "Ready",
            "chunks_count": indexed.get("chunks_count", 0),
        }

    async def _load(self, request) -> dict:
        return await workflow.execute_activity(
            knowledge_activities.load_knowledge_source,
            request,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=LOAD_RETRY,
        )

    async def _process(self, request) -> dict:
        return await workflow.execute_activity(
            knowledge_activities.process_knowledge_source,
            request,
            start_to_close_timeout=timedelta(minutes=5),
            schedule_to_close_timeout=timedelta(minutes=15),
            retry_policy=PROCESS_RETRY,
        )

    async def _index(self, request, processed: dict) -> dict:
        return await workflow.execute_activity(
            knowledge_activities.index_knowledge_source,
            {"request": request, "processed": processed},
            start_to_close_timeout=timedelta(minutes=10),
            schedule_to_close_timeout=timedelta(minutes=30),
            retry_policy=INDEX_RETRY,
        )

    async def _advance(
        self,
        request,
        status: str,
        chunks_count: int | None = None,
        error: dict | None = None,
    ) -> None:
        await workflow.execute_activity(
            knowledge_activities.advance_knowledge_status,
            {
                "source_id": request.source_id,
                "workspace_id": request.workspace_id,
                "status": status,
                "chunks_count": chunks_count,
                "error": error,
            },
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=LOAD_RETRY,
        )

    async def _fail(self, request, failure) -> None:
        try:
            # `failure` is a domain `AgentError`; it must reach the activity as plain data or the
            # payload cannot be serialised and the source would stay stuck in `Indexing`.
            await self._advance(request, "Failed", error=failure.to_dict())
        except Exception:
            workflow.logger.error(
                "could not persist knowledge failure", extra={"source_id": request.source_id}
            )
