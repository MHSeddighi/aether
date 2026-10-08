"""Conversation and message persistence.

Only validated domain projections are stored in `messages.payload` (Rule 21): proposals, tool
activity, knowledge retrieval, attachments and feedback — never raw model JSON.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.conversations import (
    Attachment,
    AttachmentProposal,
    Conversation,
    ConversationMode,
    KnowledgeRetrieval,
    Message,
    MessageFeedback,
    Sender,
    ToolActivity,
)
from app.infrastructure.database.tables import ConversationRow, MessageRow


def message_payload(message: Message) -> dict:
    payload: dict = {}
    if message.bot_proposal:
        payload["bot_proposal"] = message.bot_proposal.model_dump(mode="json")
    if message.tool_proposal:
        payload["tool_proposal"] = message.tool_proposal.model_dump(mode="json")
    if message.tool_activity:
        payload["tool_activity"] = [a.model_dump(mode="json") for a in message.tool_activity]
    if message.knowledge_retrieval:
        payload["knowledge_retrieval"] = message.knowledge_retrieval.model_dump(mode="json")
    if message.attachments:
        payload["attachments"] = [a.model_dump(mode="json") for a in message.attachments]
    if message.feedback:
        payload["feedback"] = str(message.feedback)
    return payload


def message_to_domain(row: MessageRow) -> Message:
    payload = row.payload or {}
    return Message(
        message_id=row.id,
        conversation_id=row.conversation_id,
        run_id=row.run_id,
        sender=Sender(row.sender),
        content=row.content,
        is_streaming=row.is_streaming,
        bot_proposal=AttachmentProposal.model_validate(payload["bot_proposal"])
        if payload.get("bot_proposal")
        else None,
        tool_proposal=AttachmentProposal.model_validate(payload["tool_proposal"])
        if payload.get("tool_proposal")
        else None,
        tool_activity=[ToolActivity.model_validate(a) for a in payload.get("tool_activity", [])],
        knowledge_retrieval=KnowledgeRetrieval.model_validate(payload["knowledge_retrieval"])
        if payload.get("knowledge_retrieval")
        else None,
        attachments=[Attachment.model_validate(a) for a in payload.get("attachments", [])],
        feedback=MessageFeedback(payload["feedback"]) if payload.get("feedback") else None,
        created_at=row.created_at,
    )


def to_domain(row: ConversationRow, messages: list[MessageRow] | None = None) -> Conversation:
    return Conversation(
        conversation_id=row.id,
        workspace_id=row.workspace_id,
        title=row.title,
        bot_id=row.bot_id,
        mode=ConversationMode(row.mode),
        is_pinned=row.is_pinned,
        messages=[message_to_domain(m) for m in (messages or [])],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class ConversationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, conversation: Conversation) -> Conversation:
        self._session.add(
            ConversationRow(
                id=conversation.conversation_id,
                workspace_id=conversation.workspace_id,
                bot_id=conversation.bot_id,
                title=conversation.title,
                mode=str(conversation.mode),
                is_pinned=conversation.is_pinned,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
            )
        )
        await self._session.flush()
        return conversation

    async def get(self, conversation_id: str, workspace_id: str) -> Conversation | None:
        result = await self._session.execute(
            select(ConversationRow)
            .options(selectinload(ConversationRow.messages))
            .where(ConversationRow.id == conversation_id, ConversationRow.workspace_id == workspace_id)
        )
        row = result.scalar_one_or_none()
        return to_domain(row, row.messages) if row else None

    async def list(self, workspace_id: str, *, limit: int = 100) -> list[Conversation]:
        result = await self._session.execute(
            select(ConversationRow)
            .options(selectinload(ConversationRow.messages))
            .where(ConversationRow.workspace_id == workspace_id)
            .order_by(ConversationRow.is_pinned.desc(), ConversationRow.updated_at.desc())
            .limit(limit)
        )
        return [to_domain(row, row.messages) for row in result.scalars().all()]

    async def add_message(self, message: Message) -> Message:
        self._session.add(
            MessageRow(
                id=message.message_id,
                conversation_id=message.conversation_id,
                run_id=message.run_id,
                sender=str(message.sender),
                content=message.content,
                is_streaming=message.is_streaming,
                payload=message_payload(message),
                created_at=message.created_at,
            )
        )
        conversation = await self._session.get(ConversationRow, message.conversation_id)
        if conversation is not None:
            conversation.updated_at = message.created_at
        await self._session.flush()
        return message

    async def update_message(self, message: Message) -> Message:
        row = await self._session.get(MessageRow, message.message_id)
        if row is None:
            raise LookupError(f"message {message.message_id!r} not found")
        row.content = message.content
        row.is_streaming = message.is_streaming
        row.run_id = message.run_id
        row.payload = message_payload(message)
        await self._session.flush()
        return message

    async def rename(self, conversation_id: str, workspace_id: str, title: str) -> bool:
        row = await self._session.get(ConversationRow, conversation_id)
        if row is None or row.workspace_id != workspace_id:
            return False
        row.title = title
        return True

    async def set_bot(self, conversation_id: str, workspace_id: str, bot_id: str) -> bool:
        """Re-point a conversation at another bot.

        A builder chat is created before the bot it will produce exists, so the artifact it builds
        gets bound afterwards. Only the *next* run is affected: already-recorded messages keep the
        run that produced them, which is what the history above the artifact card must show.
        """
        row = await self._session.get(ConversationRow, conversation_id)
        if row is None or row.workspace_id != workspace_id:
            return False
        row.bot_id = bot_id
        return True

    async def set_pinned(self, conversation_id: str, workspace_id: str, pinned: bool) -> bool:
        row = await self._session.get(ConversationRow, conversation_id)
        if row is None or row.workspace_id != workspace_id:
            return False
        row.is_pinned = pinned
        return True

    async def delete(self, conversation_id: str, workspace_id: str) -> bool:
        row = await self._session.get(ConversationRow, conversation_id)
        if row is None or row.workspace_id != workspace_id:
            return False
        await self._session.delete(row)
        return True

    async def get_message(self, message_id: str, workspace_id: str) -> Message | None:
        """Load one message, scoped through its conversation so ids cannot be guessed across tenants."""
        result = await self._session.execute(
            select(MessageRow)
            .join(ConversationRow, ConversationRow.id == MessageRow.conversation_id)
            .where(MessageRow.id == message_id, ConversationRow.workspace_id == workspace_id)
        )
        row = result.scalar_one_or_none()
        return message_to_domain(row) if row else None
