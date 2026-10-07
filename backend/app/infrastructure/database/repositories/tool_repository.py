"""Tool persistence with immutable tool versions."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.tools import (
    ConnectionState,
    Tool,
    ToolCategory,
    ToolPermission,
    ToolVersion,
)
from app.infrastructure.database.tables import ToolRow, ToolVersionRow


def version_to_domain(row: ToolVersionRow) -> ToolVersion:
    return ToolVersion(
        tool_id=row.tool_id,
        version_id=row.version_id,
        version=row.version,
        created_at=row.created_at,
        input_schema=row.input_schema,
        output_schema=row.output_schema,
        handler=row.handler,
        handler_config=row.handler_config,
        timeout_seconds=row.timeout_seconds,
        permissions=tuple(ToolPermission(p) for p in row.permissions),
    )


def version_snapshot(version: ToolVersion) -> dict:
    return {
        "input_schema": version.input_schema,
        "output_schema": version.output_schema,
        "handler": version.handler,
        "handler_config": version.handler_config,
        "timeout_seconds": version.timeout_seconds,
        "permissions": [str(p) for p in version.permissions],
    }


def to_domain(row: ToolRow, versions: list[ToolVersionRow] | None = None) -> Tool:
    return Tool(
        tool_id=row.id,
        workspace_id=row.workspace_id,
        name=row.name,
        name_fa=row.name_fa,
        purpose=row.purpose,
        purpose_fa=row.purpose_fa,
        icon=row.icon,
        connection_state=ConnectionState(row.connection_state),
        category=ToolCategory(row.category),
        enabled=row.enabled,
        config=row.config or {},
        version=row.version,
        versions=[version_to_domain(v) for v in (versions or [])],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class ToolRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, tool: Tool, *, version: ToolVersion) -> Tool:
        self._session.add(
            ToolRow(
                id=tool.tool_id,
                workspace_id=tool.workspace_id,
                name=tool.name,
                name_fa=tool.name_fa,
                purpose=tool.purpose,
                purpose_fa=tool.purpose_fa,
                icon=tool.icon,
                connection_state=str(tool.connection_state),
                category=str(tool.category),
                enabled=tool.enabled,
                config=tool.config,
                version=tool.version,
                created_at=tool.created_at,
            )
        )
        self._session.add(self._version_row(tool, version))
        await self._session.flush()
        tool.versions = [version]
        return tool

    async def get(self, tool_id: str, workspace_id: str) -> Tool | None:
        result = await self._session.execute(
            select(ToolRow)
            .options(selectinload(ToolRow.versions))
            .where(ToolRow.id == tool_id, ToolRow.workspace_id == workspace_id)
        )
        row = result.scalar_one_or_none()
        return to_domain(row, row.versions) if row else None

    async def get_many(self, tool_ids: list[str], workspace_id: str) -> dict[str, Tool]:
        if not tool_ids:
            return {}
        result = await self._session.execute(
            select(ToolRow)
            .options(selectinload(ToolRow.versions))
            .where(ToolRow.workspace_id == workspace_id, ToolRow.id.in_(tool_ids))
        )
        rows = result.scalars().all()
        return {row.id: to_domain(row, row.versions) for row in rows}

    async def list(self, workspace_id: str, *, only_enabled: bool = False) -> list[Tool]:
        query = (
            select(ToolRow)
            .options(selectinload(ToolRow.versions))
            .where(ToolRow.workspace_id == workspace_id)
        )
        if only_enabled:
            query = query.where(ToolRow.enabled.is_(True))
        result = await self._session.execute(query.order_by(ToolRow.name))
        return [to_domain(row, row.versions) for row in result.scalars().all()]

    async def update(
        self, tool: Tool, *, version: ToolVersion | None, previous_versions: list[ToolVersion]
    ) -> Tool:
        row = await self._session.get(ToolRow, tool.tool_id)
        if row is None:
            raise LookupError(f"tool {tool.tool_id!r} not found")
        row.name = tool.name
        row.name_fa = tool.name_fa
        row.purpose = tool.purpose
        row.purpose_fa = tool.purpose_fa
        row.icon = tool.icon
        row.connection_state = str(tool.connection_state)
        row.category = str(tool.category)
        row.enabled = tool.enabled
        row.config = tool.config
        if version is not None:
            row.version = version.version
            self._session.add(self._version_row(tool, version))
            tool.versions = [version, *previous_versions]
        await self._session.flush()
        return tool

    async def delete(self, tool_id: str, workspace_id: str) -> bool:
        row = await self._session.get(ToolRow, tool_id)
        if row is None or row.workspace_id != workspace_id:
            return False
        await self._session.delete(row)
        return True

    def _version_row(self, tool: Tool, version: ToolVersion) -> ToolVersionRow:
        return ToolVersionRow(
            version_id=version.version_id,
            tool_id=tool.tool_id,
            workspace_id=tool.workspace_id,
            version=version.version,
            input_schema=version.input_schema,
            output_schema=version.output_schema,
            handler=version.handler,
            handler_config=version.handler_config,
            timeout_seconds=version.timeout_seconds,
            permissions=[str(p) for p in version.permissions],
            created_at=version.created_at,
        )
