"""Run routes: the durable-execution control plane.

`POST /runs` returns `202 {run_id, status}` immediately (Rule 14) — the agent runs in a Temporal
activity, never inside the request. `POST /runs/{id}/cancel` persists the cancellation before asking
Temporal to stop, because a cancelled workflow is closed immediately and would abandon its own
cleanup activity.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.api.deps import RunServiceDep, WorkspaceId
from app.api.errors import ConflictError, NotFoundError
from app.api.schemas import RunCreateRequest
from app.application.run_service import BotNotRunnable, RunNotFound, StartRunCommand
from app.domain.runs import run_to_dict

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_run(payload: RunCreateRequest, service: RunServiceDep, workspace: WorkspaceId) -> dict:
    """Start `RunAgentWorkflow` for one captured bot version and return immediately."""
    command = StartRunCommand(
        bot_id=payload.bot_id,
        input=payload.input,
        conversation_id=payload.conversation_id,
        assistant_message_id=payload.assistant_message_id,
    )
    try:
        run = await service.start(workspace, command)
    except BotNotRunnable as exc:
        # A disabled/archived bot is a conflict with the *state of the bot*, not a missing route.
        raise ConflictError(
            str(exc),
            details={"botId": exc.bot_id, "reason": exc.reason},
        ) from exc
    return {"run_id": run.run_id, "status": str(run.status), "workflowId": f"run:{run.run_id}"}


@router.get("")
async def list_runs(
    service: RunServiceDep,
    workspace: WorkspaceId,
    bot_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    return [run_to_dict(run) for run in await service.list(workspace, bot_id=bot_id, limit=limit)]


@router.get("/{run_id}")
async def get_run(run_id: str, service: RunServiceDep, workspace: WorkspaceId) -> dict:
    """Run state including the captured provider/model configuration (Rule 36) and, when the run
    failed, the failure classification with its retry disposition."""
    try:
        run = await service.get(workspace, run_id)
    except RunNotFound as exc:
        raise NotFoundError("run", run_id) from exc
    return run_to_dict(run)


@router.post("/{run_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_run(run_id: str, service: RunServiceDep, workspace: WorkspaceId) -> dict:
    """Cancel a queued or running run. Idempotent: a finished run is returned unchanged."""
    try:
        run = await service.cancel(workspace, run_id)
    except RunNotFound as exc:
        raise NotFoundError("run", run_id) from exc
    return {"run_id": run.run_id, "status": str(run.status)}
