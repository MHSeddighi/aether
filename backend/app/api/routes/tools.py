"""Tool routes.

Creation carries the full execution contract (schemas, handler, timeout, permissions) because a tool
is useless to the Tool Gateway without it. An update that changes the contract appends an immutable
version; a presentation-only update does not.
"""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import ToolServiceDep, WorkspaceId
from app.api.errors import NotFoundError
from app.api.schemas import ToolPatchRequest, ToolWriteRequest
from app.application.tool_service import ToolNotFound
from app.domain.tools import tool_to_dict

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("")
async def list_tools(service: ToolServiceDep, workspace: WorkspaceId) -> list[dict]:
    return [tool_to_dict(tool) for tool in await service.list(workspace)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tool(payload: ToolWriteRequest, service: ToolServiceDep, workspace: WorkspaceId) -> dict:
    draft = payload.to_draft(workspace)
    tool = await service.create(workspace, draft, version=payload.to_version(draft.tool_id, 1))
    return tool_to_dict(tool)


@router.get("/{tool_id}")
async def get_tool(tool_id: str, service: ToolServiceDep, workspace: WorkspaceId) -> dict:
    try:
        tool = await service.get(workspace, tool_id)
    except ToolNotFound as exc:
        raise NotFoundError("tool", tool_id) from exc
    return tool_to_dict(tool)


@router.patch("/{tool_id}")
async def update_tool(
    tool_id: str, payload: ToolPatchRequest, service: ToolServiceDep, workspace: WorkspaceId
) -> dict:
    try:
        tool = await service.update(workspace, tool_id, payload.to_changes())
    except ToolNotFound as exc:
        raise NotFoundError("tool", tool_id) from exc
    return tool_to_dict(tool)


@router.delete("/{tool_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tool(tool_id: str, service: ToolServiceDep, workspace: WorkspaceId) -> None:
    try:
        await service.delete(workspace, tool_id)
    except ToolNotFound as exc:
        raise NotFoundError("tool", tool_id) from exc


@router.get("/{tool_id}/versions")
async def list_tool_versions(tool_id: str, service: ToolServiceDep, workspace: WorkspaceId) -> list[dict]:
    try:
        versions = await service.versions(workspace, tool_id)
    except ToolNotFound as exc:
        raise NotFoundError("tool", tool_id) from exc
    return [
        {
            "versionId": version.version_id,
            "version": version.version,
            "handler": version.handler,
            "timeoutSeconds": version.timeout_seconds,
            "permissions": [str(p) for p in version.permissions],
            "inputSchema": version.input_schema,
            "outputSchema": version.output_schema,
            "createdAt": version.created_at.isoformat(),
        }
        for version in versions
    ]
