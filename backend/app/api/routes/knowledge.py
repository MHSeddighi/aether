"""Knowledge routes.

    POST /knowledge (multipart) → 202, status 'Uploading'
        ↓ bytes written to the data volume, rows inserted
        ↓ IndexKnowledgeWorkflow advances Processing → Indexing → Ready | Failed

The upload response only promises that the bytes were accepted; indexing is durable work owned by a
workflow, not by the request (`docs/api-contract.md` §5).
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile, status

from app.api.deps import KnowledgeServiceDep, WorkspaceId, get_settings
from app.api.errors import ApiError, ErrorCode, NotFoundError
from app.api.schemas import KnowledgeRenameRequest
from app.application.knowledge_service import KnowledgeNotFound
from app.domain.knowledge import knowledge_to_dict
from app.infrastructure.config import Settings

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("")
async def list_knowledge(service: KnowledgeServiceDep, workspace: WorkspaceId) -> list[dict]:
    return [knowledge_to_dict(source) for source in await service.list(workspace)]


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def upload_knowledge(
    files: Annotated[list[UploadFile], File(description="one or more documents")],
    service: KnowledgeServiceDep,
    workspace: WorkspaceId,
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[dict]:
    """Accept the bytes, write them to the data volume and queue indexing."""
    if not files:
        raise ApiError(422, ErrorCode.VALIDATION_ERROR, "at least one file is required")
    accepted = await service.ingest(
        workspace,
        [
            (item.filename or "unnamed", item.content_type or "application/octet-stream", item.file)
            for item in files
        ],
        storage_root=Path(settings.data_dir),
    )
    return [knowledge_to_dict(source) for source in accepted]


@router.get("/{source_id}")
async def get_knowledge(source_id: str, service: KnowledgeServiceDep, workspace: WorkspaceId) -> dict:
    try:
        source = await service.get(workspace, source_id)
    except KnowledgeNotFound as exc:
        raise NotFoundError("knowledge source", source_id) from exc
    return knowledge_to_dict(source)


@router.patch("/{source_id}")
async def rename_knowledge(
    source_id: str,
    payload: KnowledgeRenameRequest,
    service: KnowledgeServiceDep,
    workspace: WorkspaceId,
) -> dict:
    try:
        source = await service.rename(workspace, source_id, payload.name)
    except KnowledgeNotFound as exc:
        raise NotFoundError("knowledge source", source_id) from exc
    return knowledge_to_dict(source)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge(source_id: str, service: KnowledgeServiceDep, workspace: WorkspaceId) -> None:
    await service.delete(workspace, source_id)
