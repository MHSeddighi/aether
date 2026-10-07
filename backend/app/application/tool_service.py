"""Tool use cases.

Tool versions are immutable for the same reason bot versions are: schemas and permissions must not
change under a live agent. A write that changes the execution contract appends a version; a write
that only changes presentation (name, icon, enabled) does not.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.application.ports import ToolRepositoryPort
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.ids import new_id
from app.domain.tools import (
    Tool,
    ToolPermission,
    ToolVersion,
    require_known_permissions,
)

#: Fields that change what the gateway will do, and therefore require a new version.
CONTRACT_FIELDS = frozenset(
    {"input_schema", "output_schema", "handler", "handler_config", "timeout_seconds", "permissions"}
)


class ToolNotFound(Exception):
    def __init__(self, tool_id: str) -> None:
        super().__init__(f"tool {tool_id!r} was not found")
        self.tool_id = tool_id


class ToolService:
    def __init__(self, tools: ToolRepositoryPort) -> None:
        self._tools = tools

    async def list(self, workspace_id: str) -> list[Tool]:
        return await self._tools.list(workspace_id)

    async def get(self, workspace_id: str, tool_id: str) -> Tool:
        tool = await self._tools.get(tool_id, workspace_id)
        if tool is None:
            raise ToolNotFound(tool_id)
        return tool

    async def create(self, workspace_id: str, draft: Tool, *, version: ToolVersion) -> Tool:
        _validate_contract(version)
        tool = draft.model_copy(
            update={
                "tool_id": draft.tool_id or new_id("tool"),
                "workspace_id": workspace_id,
                "version": version.version,
            }
        )
        return await self._tools.add(tool, version=version.model_copy(update={"tool_id": tool.tool_id}))

    async def update(
        self, workspace_id: str, tool_id: str, changes: dict, *, version: ToolVersion | None = None
    ) -> Tool:
        """Apply `changes`; append an immutable version only when the execution contract moved.

        `changes` may mix two vocabularies: presentation fields of the aggregate (`name`, `icon`,
        `enabled`) and execution fields of a version (`input_schema`, `timeout_seconds`, …). They are
        split here, because they belong to different objects.
        """
        tool = await self.get(workspace_id, tool_id)
        previous = list(tool.versions)
        contract_changes = {k: v for k, v in changes.items() if k in CONTRACT_FIELDS}
        aggregate_changes = {k: v for k, v in changes.items() if k not in CONTRACT_FIELDS}
        updated = _apply(tool, aggregate_changes)

        active = tool.active_version()
        contract_changed = version is not None or _contract_differs(active, contract_changes)
        next_version = None
        if contract_changed:
            candidate = version or _version_from(updated, active, contract_changes)
            _validate_contract(candidate)
            next_version = candidate.model_copy(
                update={"tool_id": updated.tool_id, "version": updated.next_version_number()}
            )
        return await self._tools.update(updated, version=next_version, previous_versions=previous)

    async def delete(self, workspace_id: str, tool_id: str) -> None:
        if not await self._tools.delete(tool_id, workspace_id):
            raise ToolNotFound(tool_id)

    async def versions(self, workspace_id: str, tool_id: str) -> list[ToolVersion]:
        await self.get(workspace_id, tool_id)
        return (await self._tools.get(tool_id, workspace_id)).versions  # type: ignore[union-attr]


def _apply(tool: Tool, changes: dict) -> Tool:
    unknown = set(changes) - set(Tool.model_fields)
    if unknown:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"unknown tool fields: {sorted(unknown)}",
            details={"fields": sorted(unknown)},
        )
    return tool.model_copy(update={**changes, "updated_at": datetime.now(UTC)})


def _contract_differs(active: ToolVersion | None, changes: dict) -> bool:
    """Only a version that actually exists can differ, and only in what the caller sent."""
    if active is None or not CONTRACT_FIELDS & set(changes):
        return False
    for field in CONTRACT_FIELDS & set(changes):
        current = getattr(active, field)
        incoming = changes[field]
        if field == "permissions":
            if set(map(str, current)) != set(map(str, incoming)):
                return True
        elif current != incoming:
            return True
    return False


def _version_from(tool: Tool, active: ToolVersion | None, changes: dict) -> ToolVersion:
    """Carry the active version forward, overriding only the contract fields the caller changed."""
    base = active.model_dump() if active else {}
    base.update(changes)
    return ToolVersion(
        tool_id=tool.tool_id,
        version_id=new_id("toolver"),
        version=tool.next_version_number(),
        created_at=datetime.now(UTC),
        input_schema=base.get("input_schema") or {},
        output_schema=base.get("output_schema") or {},
        handler=base.get("handler", "builtin"),
        handler_config=base.get("handler_config") or {},
        timeout_seconds=base.get("timeout_seconds", 20.0),
        permissions=tuple(ToolPermission(p) for p in base.get("permissions") or ()),
    )


def _validate_contract(version: ToolVersion) -> None:
    require_known_permissions(version.permissions)
    if not version.input_schema:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "a tool must declare an input_schema so the gateway can validate arguments",
            details={"tool_id": version.tool_id},
        )
