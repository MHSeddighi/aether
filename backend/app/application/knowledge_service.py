"""Knowledge ingestion use cases.

Bytes go to the data volume, never into Postgres (Rule 35): only the checksum and the path are
stored. Ingestion is therefore two steps that must not be conflated:

1. `ingest` — write the bytes, insert the rows, return the sources as `Uploading`. This is what the
   HTTP request does, and it is fast because it touches no model and no index.
2. `IndexKnowledgeWorkflow` — advances `Processing → Indexing → Ready | Failed` durably.

The `KnowledgeSource.advance_to` state machine enforces the legal order, so a retried or reordered
write cannot move a source backwards.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, Protocol

from app.application.ports import KnowledgeStarter
from app.domain.ids import new_id
from app.domain.knowledge import KB_DIR, FileBlob, KnowledgeSource, KnowledgeType
from app.infrastructure.logging_config import get_logger

logger = get_logger(__name__)

MAX_FILE_BYTES = 25 * 1024 * 1024
CHUNK_SIZE = 8000


class KnowledgeNotFound(Exception):
    def __init__(self, source_id: str) -> None:
        super().__init__(f"knowledge source {source_id!r} was not found")
        self.source_id = source_id


class FileTooLarge(Exception):
    def __init__(self, filename: str, size: int) -> None:
        super().__init__(f"{filename!r} is {size} bytes, over the {MAX_FILE_BYTES} limit")
        self.filename = filename


class KnowledgeRepositoryPort(Protocol):
    async def add(self, source: KnowledgeSource) -> KnowledgeSource: ...

    async def get(self, source_id: str, workspace_id: str) -> KnowledgeSource | None: ...

    async def list(self, workspace_id: str) -> list[KnowledgeSource]: ...

    async def save(self, source: KnowledgeSource) -> KnowledgeSource: ...

    async def delete(self, source_id: str, workspace_id: str) -> list[str]: ...


class BlobStorePort(Protocol):
    """The filesystem boundary, so tests can supply an in-memory store."""

    def path_for(self, workspace_id: str, source_id: str, filename: str) -> Path: ...

    def write(self, path: Path, chunks: Iterable[bytes]) -> int: ...

    def read(self, path: Path) -> bytes: ...

    def delete(self, path: Path) -> None: ...


class LocalBlobStore:
    """Files on the data volume. One directory per workspace and source, so deletion is scoped."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def path_for(self, workspace_id: str, source_id: str, filename: str) -> Path:
        safe = Path(filename).name.replace("/", "_")
        return self._root / KB_DIR / workspace_id / source_id / safe

    def write(self, path: Path, chunks: Iterable[bytes]) -> int:
        path.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        with path.open("wb") as handle:
            for chunk in chunks:
                written += len(chunk)
                handle.write(chunk)
        return written

    def read(self, path: Path) -> bytes:
        return path.read_bytes()

    def delete(self, path: Path) -> None:
        path.unlink(missing_ok=True)


class KnowledgeService:
    def __init__(
        self,
        knowledge: KnowledgeRepositoryPort,
        blobs: BlobStorePort,
        starter: KnowledgeStarter | None = None,
    ) -> None:
        self._knowledge = knowledge
        self._blobs = blobs
        # Optional so unit tests can exercise ingestion without Temporal (Rule 38).
        self._starter = starter

    async def list(self, workspace_id: str) -> list[KnowledgeSource]:
        return await self._knowledge.list(workspace_id)

    async def get(self, workspace_id: str, source_id: str) -> KnowledgeSource:
        source = await self._knowledge.get(source_id, workspace_id)
        if source is None:
            raise KnowledgeNotFound(source_id)
        return source

    async def ingest(
        self,
        workspace_id: str,
        files: list[tuple[str, str, BinaryIO]],
        *,
        storage_root: Path | None = None,
    ) -> list[KnowledgeSource]:
        """One `KnowledgeSource` per uploaded file, returned as `Uploading`.

        Bytes are written before the row is inserted, so a crash can leave an orphan file (harmless,
        reclaimable) but never a row pointing at bytes that were never written.
        """
        blobs = LocalBlobStore(storage_root) if storage_root is not None else self._blobs
        sources: list[KnowledgeSource] = []
        for filename, content_type, stream in files:
            source_id = new_id("kb")
            path = blobs.path_for(workspace_id, source_id, filename)
            digest = hashlib.sha256()
            size = 0
            collected: list[bytes] = []
            for chunk in _iter_chunks(stream):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise FileTooLarge(filename, size)
                digest.update(chunk)
                collected.append(chunk)
            blobs.write(path, collected)
            source = await self._knowledge.add(
                KnowledgeSource(
                    source_id=source_id,
                    workspace_id=workspace_id,
                    name=Path(filename).name,
                    type=KnowledgeType.from_filename(filename),
                    files=[
                        FileBlob(
                            file_id=new_id("file"),
                            filename=Path(filename).name,
                            content_type=content_type,
                            size_bytes=size,
                            checksum_sha256=digest.hexdigest(),
                            storage_path=str(path),
                        )
                    ],
                )
            )
            sources.append(source)
        # Indexing is durable work owned by Temporal, not the request. Starting it here keeps the
        # HTTP response immediate while guaranteeing the source is eventually indexed (Rule 14).
        if self._starter is not None:
            from app.infrastructure.temporal.knowledge_starter import knowledge_workflow_id
            from app.workflows.contracts import IndexKnowledgeRequest

            for source in sources:
                await self._starter.start(
                    IndexKnowledgeRequest(source_id=source.source_id, workspace_id=source.workspace_id),
                    workflow_id=knowledge_workflow_id(source.source_id),
                )
        return sources

    async def rename(self, workspace_id: str, source_id: str, name: str) -> KnowledgeSource:
        source = await self.get(workspace_id, source_id)
        if source.status.is_terminal or source.name != name:
            return await self._knowledge.save(source.model_copy(update={"name": name}))
        return source

    async def delete(self, workspace_id: str, source_id: str) -> None:
        """Remove the row and its blobs. The row's returned paths come from the repository, so the
        two are always consistent."""
        paths = await self._knowledge.delete(source_id, workspace_id)
        for path in paths:
            self._blobs.delete(Path(path))

    async def advance(
        self,
        workspace_id: str,
        source_id: str,
        status_name: str,
        *,
        progress_percent: int | None = None,
        chunks_count: int | None = None,
        error: str | None = None,
    ) -> KnowledgeSource:
        """Move a source through the indexing state machine (Rule 19).

        Called from `IndexKnowledgeWorkflow`, so it must be idempotent: re-entering a status the
        source already has is a no-op, which is what `advance_to` does for an identical status.
        """
        from app.domain.knowledge import KnowledgeStatus

        source = await self.get(workspace_id, source_id)
        return await self._knowledge.save(
            source.advance_to(
                KnowledgeStatus(status_name),
                progress_percent=progress_percent,
                chunks_count=chunks_count,
                error=error,
            )
        )


def _iter_chunks(stream: BinaryIO, size: int = 1 << 20) -> Iterable[bytes]:
    while chunk := stream.read(size):
        yield chunk


def chunk_text(text: str, size: int = CHUNK_SIZE) -> list[str]:
    """Split on paragraph boundaries where possible. Pure function, so it is directly testable and
    the same text always yields the same chunks (important for idempotent re-indexing, Rule 18)."""
    if not text:
        return []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) <= size:
            current = candidate
            continue
        if current:
            chunks.append(current)
        current = paragraph[:size]
    if current:
        chunks.append(current)
    return chunks


def now() -> datetime:
    return datetime.now(UTC)
