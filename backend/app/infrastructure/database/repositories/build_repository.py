"""Build persistence: the build row and its durable checkpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.tables import BuildCheckpointRow, BuildRow


class BuildRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add_build(self, build: dict) -> dict:
        row = BuildRow(
            id=build["build_id"],
            workspace_id=build["workspace_id"],
            bot_id=build["bot_id"],
            bot_version_id=build["bot_version_id"],
            status=build["status"],
            specification=build["specification"],
            model_config=build["model_config"],
            created_at=datetime.now(UTC),
        )
        self._session.add(row)
        await self._session.flush()
        return self.to_dict(row)

    async def get_build(self, build_id: str, workspace_id: str) -> dict | None:
        row = await self._session.get(BuildRow, build_id)
        if row is None or row.workspace_id != workspace_id:
            return None
        return self.to_dict(row)

    async def finish_build(self, build_id: str, *, status: str, failure: dict | None = None) -> None:
        row = await self._session.get(BuildRow, build_id)
        if row is None:
            return
        row.status = status
        row.finished_at = datetime.now(UTC)
        if failure is not None:
            row.failure = failure

    async def get_checkpoints(self, build_id: str) -> list[dict]:
        result = await self._session.execute(
            select(BuildCheckpointRow)
            .where(BuildCheckpointRow.build_id == build_id)
            .order_by(BuildCheckpointRow.created_at)
        )
        return [
            {
                "step": row.step,
                "status": row.status,
                "output": row.output or {},
                "error": row.error,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in result.scalars().all()
        ]

    @staticmethod
    def to_dict(row: BuildRow) -> dict:
        return {
            "build_id": row.id,
            "workspace_id": row.workspace_id,
            "bot_id": row.bot_id,
            "bot_version_id": row.bot_version_id,
            "status": row.status,
            "specification": row.specification,
            "image_tag": row.image_tag,
            "failure": row.failure,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        }
