"""Conversation and message routes.

`POST /conversations/{id}/messages` composes the two use cases the frontend lifecycle implies: the
conversation service writes the optimistic user message and the streaming assistant placeholder, then
the run service starts durable execution. The assistant message id is handed to the workflow so
`PersistRunResult` can fill in the very message the frontend is watching.
"""

from __future__ import annotations

from fastapi import APIRouter, status

from app.agents.proposal import intent_for
from app.api.deps import ConversationServiceDep, RunServiceDep, WorkspaceId
from app.api.errors import ConflictError, NotFoundError
from app.api.schemas import (
    ConversationCreateRequest,
    ConversationPatchRequest,
    FeedbackRequest,
    SendMessageRequest,
)
from app.application.conversation_service import ConversationNotFound, MessageNotFound
from app.application.run_service import BotNotRunnable, StartRunCommand
from app.domain.conversations import Attachment

router = APIRouter(tags=["conversations"])


@router.get("/conversations")
async def list_conversations(service: ConversationServiceDep, workspace: WorkspaceId) -> list[dict]:
    """Metadata only: no messages, so the sidebar never downloads full histories."""
    return [c.to_dict(include_messages=False) for c in await service.list(workspace)]


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreateRequest, service: ConversationServiceDep, workspace: WorkspaceId
) -> dict:
    conversation = await service.create(
        workspace, bot_id=payload.bot_id, title=payload.title, mode=payload.mode
    )
    return conversation.to_dict(include_messages=True)


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str, service: ConversationServiceDep, workspace: WorkspaceId
) -> dict:
    try:
        conversation = await service.get(workspace, conversation_id)
    except ConversationNotFound as exc:
        raise NotFoundError("conversation", conversation_id) from exc
    return conversation.to_dict(include_messages=True)


@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    payload: ConversationPatchRequest,
    service: ConversationServiceDep,
    workspace: WorkspaceId,
) -> dict:
    """Rename and/or pin. Both are optional, so a rename does not clear the pin and vice versa."""
    if payload.title is not None:
        await service.rename(workspace, conversation_id, payload.title)
    if payload.is_pinned is not None:
        await service.set_pinned(workspace, conversation_id, payload.is_pinned)
    return (await service.get(workspace, conversation_id)).to_dict(include_messages=False)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str, service: ConversationServiceDep, workspace: WorkspaceId
) -> None:
    await service.delete(workspace, conversation_id)


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_202_ACCEPTED)
async def send_message(
    conversation_id: str,
    payload: SendMessageRequest,
    conversations: ConversationServiceDep,
    runs: RunServiceDep,
    workspace: WorkspaceId,
) -> dict:
    """One chat turn: user message + streaming assistant placeholder + a started run."""
    conversation = await conversations.get(workspace, conversation_id)
    attachments = [Attachment(**a.model_dump()) for a in payload.attachments]
    turn = await conversations.prepare_turn(
        workspace, conversation_id, content=payload.content, attachments=attachments
    )
    try:
        run = await runs.start(
            workspace,
            StartRunCommand(
                bot_id=conversation.bot_id,
                input=payload.content or " ".join(a.name for a in attachments),
                conversation_id=conversation_id,
                assistant_message_id=turn.assistant_message.message_id,
                attachments=tuple(a.model_dump() for a in attachments),
                # The frontend already declared the mode; asking a model to guess it would be both
                # slower and less reliable.
                intent=intent_for(str(conversation.mode)),
            ),
        )
    except BotNotRunnable as exc:
        raise ConflictError(str(exc), details={"botId": exc.bot_id, "reason": exc.reason}) from exc
    return {
        "run_id": run.run_id,
        "user_message": turn.user_message.to_dict(),
        "assistant_message": turn.assistant_message.to_dict(),
    }


@router.post("/messages/{message_id}/feedback")
async def set_feedback(
    message_id: str,
    payload: FeedbackRequest,
    service: ConversationServiceDep,
    workspace: WorkspaceId,
) -> dict:
    try:
        message = await service.set_feedback(workspace, message_id, payload.feedback)
    except MessageNotFound as exc:
        raise NotFoundError("message", message_id) from exc
    return message.to_dict()
