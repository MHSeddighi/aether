"""Knowledge source and file persistence."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.knowledge import (
    FileBlob,
    KnowledgeSource,
    KnowledgeStatus,
    KnowledgeType,
)
from app.infrastructure.database.tables import FileRow, KnowledgeSourceRow


def to_domain(row: KnowledgeSourceRow, files: list[FileRow] | None = None) -> KnowledgeSource:
    return KnowledgeSource(
        source_id=row.id,
        workspace_id=row.workspace_id,
        name=row.name,
        name_fa=row.name_fa,
        type=KnowledgeType(row.type),
        files=[
            FileBlob(
                file_id=f.id,
                filename=f.filename,
                content_type=f.content_type,
                size_bytes=f.size_bytes,
                checksum_sha256=f.checksum_sha256,
                storage_path=f.storage_path,
            )
            for f in (files or [])
        ],
        status=KnowledgeStatus(row.status),
        progress_percent=row.progress_percent,
        chunks_count=row.chunks_count,
        error=row.error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class KnowledgeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, source: KnowledgeSource) -> KnowledgeSource:
        self._session.add(
            KnowledgeSourceRow(
                id=source.source_id,
                workspace_id=source.workspace_id,
                name=source.name,
                name_fa=source.name_fa,
                type=str(source.type),
                status=str(source.status),
                progress_percent=source.progress_percent,
                chunks_count=source.chunks_count,
                error=source.error,
                created_at=source.created_at,
                updated_at=source.updated_at,
            )
        )
        for blob in source.files:
            self._session.add(
                FileRow(
                    id=blob.file_id,
                    source_id=source.source_id,
                    workspace_id=source.workspace_id,
                    filename=blob.filename,
                    content_type=blob.content_type,
                    size_bytes=blob.size_bytes,
                    checksum_sha256=blob.checksum_sha256,
                    storage_path=blob.storage_path,
                    created_at=source.created_at,
                )
            )
        await self._session.flush()
        return source

    async def get(self, source_id: str, workspace_id: str) -> KnowledgeSource | None:
        result = await self._session.execute(
            select(KnowledgeSourceRow)
            .options(selectinload(KnowledgeSourceRow.files))
            .where(KnowledgeSourceRow.id == source_id, KnowledgeSourceRow.workspace_id == workspace_id)
        )
        row = result.scalar_one_or_none()
        return to_domain(row, row.files) if row else None

    async def list(self, workspace_id: str) -> list[KnowledgeSource]:
        result = await self._session.execute(
            select(KnowledgeSourceRow)
            .options(selectinload(KnowledgeSourceRow.files))
            .where(KnowledgeSourceRow.workspace_id == workspace_id)
            .order_by(KnowledgeSourceRow.updated_at.desc())
        )
        return [to_domain(row, row.files) for row in result.scalars().all()]

    async def save(self, source: KnowledgeSource) -> KnowledgeSource:
        """Persist a status/progress update produced by the indexing workflow."""
        row = await self._session.get(KnowledgeSourceRow, source.source_id)
        if row is None:
            raise LookupError(f"knowledge source {source.source_id!r} not found")
        row.name = source.name
        row.name_fa = source.name_fa
        row.status = str(source.status)
        row.progress_percent = source.progress_percent
        row.chunks_count = source.chunks_count
        row.error = source.error
        row.updated_at = source.updated_at
        await self._session.flush()
        return source

    async def delete(self, source_id: str, workspace_id: str) -> list[str]:
        """Delete the source and return the storage paths of its files so blobs can be removed."""
        result = await self._session.execute(
            select(KnowledgeSourceRow)
            .options(selectinload(KnowledgeSourceRow.files))
            .where(KnowledgeSourceRow.id == source_id, KnowledgeSourceRow.workspace_id == workspace_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return []
        paths = [f.storage_path for f in row.files]
        await self._session.delete(row)
        return paths
