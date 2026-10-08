"""Bot routes.

Responses are exactly `web/src/types/agent.ts#BotItem`, produced by `bot_to_dict`; request bodies are
validated by `BotCreateRequest` / `BotPatchRequest`. The derived `model` label is never trusted from
the client.
"""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import BotServiceDep, SettingsDep, WorkspaceId
from app.api.errors import NotFoundError
from app.api.schemas import BotCreateRequest, BotPatchRequest
from app.application.bot_service import BotNotFound
from app.domain.bots import bot_to_dict

router = APIRouter(prefix="/bots", tags=["bots"])


@router.get("")
async def list_bots(service: BotServiceDep, workspace: WorkspaceId) -> list[dict]:
    return [bot_to_dict(bot) for bot in await service.list(workspace)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_bot(
    payload: BotCreateRequest, service: BotServiceDep, workspace: WorkspaceId, settings: SettingsDep
) -> dict:
    """Create a bot at version 1.0.0 with its first immutable version."""
    draft = payload.to_draft(workspace, settings)
    created = await service.create(workspace, draft)
    return bot_to_dict(created)


@router.get("/builder")
async def get_builder_bot(service: BotServiceDep, workspace: WorkspaceId, settings: SettingsDep) -> dict:
    """The builder host, provisioned on first call.

    A builder conversation is created before the bot it produces exists, but every run needs a bot
    to execute against. This is that placeholder. It is deliberately a fixed path rather than a
    `/bots/{bot_id}` route so a client can never mistake it for an artifact.
    """
    return bot_to_dict(await service.builder_bot(workspace, settings))


@router.get("/{bot_id}")
async def get_bot(bot_id: str, service: BotServiceDep, workspace: WorkspaceId) -> dict:
    try:
        bot = await service.get(workspace, bot_id)
    except BotNotFound as exc:
        raise NotFoundError("bot", bot_id) from exc
    return bot_to_dict(bot)


@router.patch("/{bot_id}")
async def update_bot(
    bot_id: str, payload: BotPatchRequest, service: BotServiceDep, workspace: WorkspaceId
) -> dict:
    """Mutate the aggregate and append a new immutable version in one transaction (Rule 36)."""
    try:
        bot = await service.update(workspace, bot_id, payload.to_changes())
    except BotNotFound as exc:
        raise NotFoundError("bot", bot_id) from exc
    return bot_to_dict(bot)


@router.delete("/{bot_id}")
async def archive_bot(bot_id: str, service: BotServiceDep, workspace: WorkspaceId) -> dict:
    """Soft delete: the row survives so historical runs stay reproducible (Rule 36)."""
    try:
        bot = await service.archive(workspace, bot_id)
    except BotNotFound as exc:
        raise NotFoundError("bot", bot_id) from exc
    return bot_to_dict(bot)


@router.get("/{bot_id}/versions")
async def list_bot_versions(bot_id: str, service: BotServiceDep, workspace: WorkspaceId) -> list[dict]:
    try:
        versions = await service.versions(workspace, bot_id)
    except BotNotFound as exc:
        raise NotFoundError("bot", bot_id) from exc
    return [
        {
            "version": version.version,
            "versionId": version.version_id,
            "notes": version.notes,
            "model": version.model_spec.label,
            "provider": str(version.model_spec.provider),
            "modelId": version.model_spec.model_id,
            "temperature": version.model_spec.temperature,
            "createdAt": version.created_at.isoformat(),
        }
        for version in versions
    ]
