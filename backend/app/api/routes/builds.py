"""Build routes.

    POST /bots/{bot_id}/builds   → 202 {build_id}         starts BuildBotWorkflow
    GET  /builds/{build_id}      → build state + its durable checkpoints
    POST /builds/{build_id}/cancel → cancel a running build

The build happens in a Temporal workflow with durable checkpoints (Rule 13/31); this layer only
records the request and starts the execution, so the response is immediate (Rule 14).
"""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import BuildServiceDep, WorkspaceId
from app.api.errors import ConflictError, NotFoundError
from app.api.schemas import BuildRequest
from app.application.build_service import BuildNotFound, BuildNotStartable

router = APIRouter(tags=["builds"])


@router.post("/bots/{bot_id}/builds", status_code=status.HTTP_202_ACCEPTED)
async def create_build(
    bot_id: str, payload: BuildRequest, service: BuildServiceDep, workspace: WorkspaceId
) -> dict:
    """Start a build for the bot's latest immutable version."""
    try:
        build_id = await service.start(workspace, bot_id=bot_id, specification=payload.specification)
    except BuildNotStartable as exc:
        raise ConflictError(str(exc), details={"botId": exc.bot_id, "reason": exc.reason}) from exc
    return {"build_id": build_id, "status": "pending"}


@router.get("/builds/{build_id}")
async def get_build(build_id: str, service: BuildServiceDep, workspace: WorkspaceId) -> dict:
    """Build state plus the checkpoints it has passed, oldest first."""
    try:
        return await service.get(workspace, build_id)
    except BuildNotFound as exc:
        raise NotFoundError("build", build_id) from exc


@router.post("/builds/{build_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_build(build_id: str, service: BuildServiceDep, workspace: WorkspaceId) -> dict:
    """Cancel a pending or running build."""
    try:
        return await service.cancel(workspace, build_id)
    except BuildNotFound as exc:
        raise NotFoundError("build", build_id) from exc
