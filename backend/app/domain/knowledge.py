"""Knowledge aggregate.

The frontend shows an item as soon as the file is attached, with `status:'Uploading'` and a progress
percentage, then watches `Processing -> Indexing -> Ready|Failed`. Those literals are reproduced
exactly here because `web/src/types/agent.ts#KnowledgeStatus` is part of the contract.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domain.failures import FailureReason, ValidationFailure

KB_DIR = "knowledge"


class KnowledgeStatus(StrEnum):
    UPLOADING = "Uploading"
    PROCESSING = "Processing"
    INDEXING = "Indexing"
    READY = "Ready"
    FAILED = "Failed"

    @property
    def is_terminal(self) -> bool:
        return self in {KnowledgeStatus.READY, KnowledgeStatus.FAILED}


# Allowed transitions; anything else is a programming error and is rejected loudly.
_TRANSITIONS: dict[KnowledgeStatus, frozenset[KnowledgeStatus]] = {
    KnowledgeStatus.UPLOADING: frozenset({KnowledgeStatus.PROCESSING, KnowledgeStatus.FAILED}),
    KnowledgeStatus.PROCESSING: frozenset({KnowledgeStatus.INDEXING, KnowledgeStatus.FAILED}),
    KnowledgeStatus.INDEXING: frozenset({KnowledgeStatus.READY, KnowledgeStatus.FAILED}),
    KnowledgeStatus.READY: frozenset(),
    KnowledgeStatus.FAILED: frozenset(),
}


class KnowledgeType(StrEnum):
    PDF = "pdf"
    CSV = "csv"
    JSON = "json"
    DOC = "doc"
    TEXT = "text"

    @classmethod
    def from_filename(cls, filename: str) -> KnowledgeType:
        suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        return {
            "pdf": cls.PDF,
            "csv": cls.CSV,
            "json": cls.JSON,
            "doc": cls.DOC,
            "docx": cls.DOC,
            "txt": cls.TEXT,
            "md": cls.TEXT,
        }.get(suffix, cls.TEXT)


class FileBlob(BaseModel):
    """Stored file metadata. Bytes live on a data volume, not in Postgres."""

    model_config = ConfigDict(frozen=True)

    file_id: str
    filename: str
    content_type: str
    size_bytes: int = Field(ge=0)
    checksum_sha256: str
    storage_path: str


class KnowledgeSource(BaseModel):
    source_id: str
    workspace_id: str
    name: str
    name_fa: str | None = None
    type: KnowledgeType = KnowledgeType.TEXT
    files: list[FileBlob] = Field(default_factory=list)
    status: KnowledgeStatus = KnowledgeStatus.UPLOADING
    #: Starts at the `UPLOADING` progress the frontend paints immediately
    #: (`KnowledgeWorkspace.tsx:122`); later values come from `_default_progress`.
    progress_percent: int = Field(default=20, ge=0, le=100)
    chunks_count: int = 0
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def file_count(self) -> int:
        return len(self.files)

    @property
    def size_bytes(self) -> int:
        return sum(f.size_bytes for f in self.files)

    def advance_to(
        self,
        status: KnowledgeStatus,
        *,
        progress_percent: int | None = None,
        chunks_count: int | None = None,
        error: str | None = None,
    ) -> KnowledgeSource:
        """Return a copy in the next status, enforcing the state machine (Rule 19)."""
        if status is not self.status and status not in _TRANSITIONS[self.status]:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"illegal knowledge transition {self.status} -> {status}",
                details={"source_id": self.source_id, "from": str(self.status), "to": str(status)},
            )
        return self.model_copy(
            update={
                "status": status,
                "progress_percent": (
                    progress_percent if progress_percent is not None else _default_progress(status)
                ),
                "chunks_count": (chunks_count if chunks_count is not None else self.chunks_count),
                "error": error,
                "updated_at": datetime.now(UTC),
            }
        )


def _default_progress(status: KnowledgeStatus) -> int:
    return {
        KnowledgeStatus.UPLOADING: 20,
        KnowledgeStatus.PROCESSING: 45,
        KnowledgeStatus.INDEXING: 80,
        KnowledgeStatus.READY: 100,
        KnowledgeStatus.FAILED: 100,
    }[status]


def format_size(size_bytes: int) -> str:
    """Matches the frontend's `${mb} MB` style so the UI does not need a formatter."""
    return f"{size_bytes / (1024 * 1024):.1f} MB"


def knowledge_to_dict(source: KnowledgeSource) -> dict[str, Any]:
    """Serialise to `web/src/types/agent.ts#KnowledgeItem`."""
    return {
        "id": source.source_id,
        "name": source.name,
        "nameFa": source.name_fa or source.name,
        "type": str(source.type),
        "fileCount": source.file_count,
        "sizeFormatted": format_size(source.size_bytes),
        "status": str(source.status),
        "progressPercent": source.progress_percent,
        "chunksCount": source.chunks_count,
        "updatedAt": _relative(source.updated_at),
        "error": source.error,
    }


def _relative(moment: datetime) -> str:
    delta = datetime.now(UTC) - moment
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "Just now"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    return f"{seconds // 86400}d ago"
