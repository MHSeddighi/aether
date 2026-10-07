"""State 10 — durable knowledge indexing.

The real `IndexKnowledgeWorkflow` runs against Temporal's time-skipping test environment with only its
activities stubbed (registered under the production names). The property under test (Rule 31/18): every
status transition is a durable checkpoint, the order is enforced, and a failure leaves the source
`Failed` with the classification rather than stuck in `Indexing`.

    uv run pytest tests/integration/test_index_knowledge.py
"""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from app.workflows.contracts import IndexKnowledgeRequest
from app.workflows.index_knowledge import IndexKnowledgeWorkflow
from temporalio import activity, workflow
from temporalio.client import WorkflowFailureError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

pytestmark = pytest.mark.integration

REQUIRED = os.getenv("TEMPORAL_TEST_SERVER") == "1"

SCRIPT: ScriptedIndex | None = None


class ScriptedIndex:
    def __init__(self, *, fail_at: str | None = None) -> None:
        self.fail_at = fail_at
        self.statuses: list[str] = []
        self.calls: list[str] = []

    async def load_knowledge_source(self, request: IndexKnowledgeRequest) -> dict:
        self.calls.append("load")
        return {"source_id": request.source_id, "workspace_id": request.workspace_id, "files": []}

    async def process_knowledge_source(self, request: IndexKnowledgeRequest) -> dict:
        self.calls.append("process")
        if self.fail_at == "process":
            raise RuntimeError("extraction exploded")
        return {"source_id": request.source_id, "documents": [{"filename": "a.txt", "text": "hello"}]}

    async def index_knowledge_source(self, payload: dict) -> dict:
        self.calls.append("index")
        if self.fail_at == "index":
            raise RuntimeError("index exploded")
        return {"source_id": payload["processed"]["source_id"], "chunks_count": 3, "chunks": []}

    async def advance_knowledge_status(self, payload: dict) -> dict:
        self.calls.append("advance")
        self.statuses.append(payload["status"])
        return {"source_id": payload["source_id"], "status": payload["status"], "chunks_count": 0}


def _script() -> ScriptedIndex:
    if SCRIPT is None:  # pragma: no cover - only reachable outside the fixture
        raise RuntimeError("test script not installed")
    return SCRIPT


@activity.defn(name="load_knowledge_source")
async def stub_load(request: IndexKnowledgeRequest) -> dict:
    return await _script().load_knowledge_source(request)


@activity.defn(name="process_knowledge_source")
async def stub_process(request: IndexKnowledgeRequest) -> dict:
    return await _script().process_knowledge_source(request)


@activity.defn(name="index_knowledge_source")
async def stub_index(payload: dict) -> dict:
    return await _script().index_knowledge_source(payload)


@activity.defn(name="advance_knowledge_status")
async def stub_advance(payload: dict) -> dict:
    return await _script().advance_knowledge_status(payload)


STUB_ACTIVITIES = [stub_load, stub_process, stub_index, stub_advance]


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def temporal_env():
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
    global SCRIPT
    script = ScriptedIndex()
    SCRIPT = script
    queue = f"test-index-{uuid.uuid4().hex[:8]}"
    async with Worker(
        temporal_env.client,
        task_queue=queue,
        workflows=[IndexKnowledgeWorkflow],
        activities=STUB_ACTIVITIES,
    ):
        yield temporal_env.client, script, queue
    SCRIPT = None


def make_request(source_id: str) -> IndexKnowledgeRequest:
    return IndexKnowledgeRequest(source_id=source_id, workspace_id="ws_test")


@pytest.mark.asyncio(loop_scope="module")
class TestIndexKnowledgeWorkflow:
    async def test_successful_indexing_walks_the_status_machine(self, worker_env) -> None:
        client, script, queue = worker_env
        result = await client.execute_workflow(
            IndexKnowledgeWorkflow,
            make_request("kb_ok"),
            id="kb:kb_ok",
            task_queue=queue,
        )
        assert result["status"] == "Ready"
        assert result["chunks_count"] == 3
        assert script.statuses == ["Processing", "Indexing", "Ready"]

    async def test_a_processing_failure_marks_the_source_failed(self, worker_env) -> None:
        client, script, queue = worker_env
        script.fail_at = "process"
        try:
            with pytest.raises(WorkflowFailureError):
                await client.execute_workflow(
                    IndexKnowledgeWorkflow,
                    make_request("kb_bad"),
                    id="kb:kb_bad",
                    task_queue=queue,
                )
            assert script.statuses[0] == "Processing"
            assert script.statuses[-1] == "Failed"
        finally:
            script.fail_at = None

    async def test_an_index_failure_marks_the_source_failed(self, worker_env) -> None:
        client, script, queue = worker_env
        script.fail_at = "index"
        try:
            with pytest.raises(WorkflowFailureError):
                await client.execute_workflow(
                    IndexKnowledgeWorkflow,
                    make_request("kb_bad_index"),
                    id="kb:kb_bad_index",
                    task_queue=queue,
                )
            assert script.statuses == ["Processing", "Indexing", "Failed"]
        finally:
            script.fail_at = None


class TestIndexWorkflowContract:
    def test_workflow_name_is_stable(self) -> None:
        definition = workflow._Definition.must_from_class(IndexKnowledgeWorkflow)
        assert definition.name == "IndexKnowledgeWorkflow"

    def test_workflow_id_is_stable(self) -> None:
        from app.infrastructure.temporal.knowledge_starter import knowledge_workflow_id

        assert knowledge_workflow_id("kb_1") == "kb:kb_1"
