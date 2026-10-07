"""Knowledge indexing activities.

Four meaningful boundaries (Rule 25): load the source, extract text, chunk and index it, and advance
the status. Every activity assumes it may run more than once (Rule 18), which the knowledge state
machine makes safe: re-entering a status the source already has is a no-op, so chunks are never
double-counted.

Extraction is deliberately simple and deterministic — plain text, CSV, JSON and Markdown decode
directly; PDF uses `pypdf` when it is installed. Determinism matters because re-indexing the same
file must produce the same chunks.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
from pathlib import Path
from typing import Any

from temporalio import activity

from app.activities.container import get
from app.application.knowledge_service import chunk_text
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.knowledge import KnowledgeStatus
from app.infrastructure.logging_config import get_logger
from app.workflows.contracts import IndexKnowledgeRequest

logger = get_logger(__name__)


@activity.defn(name="load_knowledge_source")
async def load_knowledge_source(request: IndexKnowledgeRequest) -> dict[str, Any]:
    """Load the source and the paths of its files."""
    return await _load_source(request)


async def _load_source(request: IndexKnowledgeRequest) -> dict[str, Any]:
    container = get()
    async with container.database.session() as session:
        from app.infrastructure.database.repositories.knowledge_repository import KnowledgeRepository

        source = await KnowledgeRepository(session).get(request.source_id, request.workspace_id)
        if source is None:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"knowledge source {request.source_id!r} not found",
                details={"source_id": request.source_id},
            )
        return {
            "source_id": source.source_id,
            "workspace_id": source.workspace_id,
            "name": source.name,
            "type": str(source.type),
            "status": str(source.status),
            "files": [f.model_dump(mode="json") for f in source.files],
        }


@activity.defn(name="process_knowledge_source")
async def process_knowledge_source(request: IndexKnowledgeRequest) -> dict[str, Any]:
    """Extract text from every file of the source."""
    spec = await _load_source(request)
    documents: list[dict[str, Any]] = []
    for blob in spec["files"]:
        try:
            text = await asyncio.to_thread(_read_text, blob["storage_path"], blob["content_type"])
        except Exception as exc:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"could not read {blob['filename']!r}: {exc}",
                details={"source_id": spec["source_id"], "file": blob["filename"]},
            ) from exc
        documents.append({"filename": blob["filename"], "text": text})
    return {"source_id": spec["source_id"], "documents": documents}


@activity.defn(name="index_knowledge_source")
async def index_knowledge_source(payload: dict[str, Any]) -> dict[str, Any]:
    """Chunk the extracted documents.

    `chunk_text` is deterministic, so re-running this activity produces identical chunks and the
    reported count is stable across retries.
    """
    processed = payload["processed"]
    chunks: list[dict[str, Any]] = []
    for document in processed["documents"]:
        for index, text in enumerate(chunk_text(document["text"])):
            chunks.append({"source": document["filename"], "index": index, "text": text})
    return {
        "source_id": processed["source_id"],
        "chunks_count": len(chunks),
        "chunks": chunks,
    }


@activity.defn(name="advance_knowledge_status")
async def advance_knowledge_status(payload: dict[str, Any]) -> dict[str, Any]:
    """Move the source through the indexing state machine.

    Idempotent by construction: `KnowledgeSource.advance_to` allows re-entering the current status and
    rejects any illegal transition, so a retried activity is safe and a bug cannot move a source
    backwards.
    """
    from app.application.knowledge_service import KnowledgeService, LocalBlobStore

    container = get()
    async with container.database.session() as session:
        from app.infrastructure.database.repositories.knowledge_repository import KnowledgeRepository

        service = KnowledgeService(
            KnowledgeRepository(session), LocalBlobStore(Path(container.settings.data_dir))
        )
        source = await service.advance(
            payload["workspace_id"],
            payload["source_id"],
            payload["status"],
            chunks_count=payload.get("chunks_count"),
            error=(payload.get("error") or {}).get("message"),
        )
    return {
        "source_id": source.source_id,
        "status": str(source.status),
        "chunks_count": source.chunks_count,
    }


def classify_index_error(error: Exception):
    """The failure taxonomy, so an indexing failure is never a bare `Failed` (Rule 19/20)."""
    from app.infrastructure.temporal.errors import classify_activity_error

    return classify_activity_error(error)


# --- helpers --------------------------------------------------------------


def _read_text(path: str, content_type: str) -> str:
    """Decode a file to text.

    Kept synchronous and pure so it is trivially testable; the caller moves it off the event loop.
    """
    data = Path(path).read_bytes()
    suffix = Path(path).suffix.lower()

    if suffix == ".pdf" or content_type == "application/pdf":
        return _read_pdf(data)
    if suffix in {".csv", ".tsv"}:
        return _read_csv(data, delimiter="\t" if suffix == ".tsv" else ",")
    if suffix == ".json":
        return json.dumps(json.loads(data.decode("utf-8", errors="replace")), indent=2)
    return data.decode("utf-8", errors="replace")


def _read_csv(data: bytes, *, delimiter: str = ",") -> str:
    rows = csv.reader(io.StringIO(data.decode("utf-8", errors="replace")), delimiter=delimiter)
    return "\n".join(", ".join(field.strip() for field in row) for row in rows if row)


def _read_pdf(data: bytes) -> str:
    """Extract PDF text.

    `pypdf` is optional: without it the PDF is not readable and the source fails with a clear
    reason rather than silently indexing nothing.
    """
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise RuntimeError(
            "PDF extraction needs the optional 'pypdf' package; install it or upload text instead"
        ) from exc
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


__all__ = [
    "KnowledgeStatus",
    "_read_csv",
    "_read_text",
    "advance_knowledge_status",
    "classify_index_error",
    "index_knowledge_source",
    "load_knowledge_source",
    "process_knowledge_source",
]
