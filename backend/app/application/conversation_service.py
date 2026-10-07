"""Conversation use cases.

The chat lifecycle the frontend observes (`docs/api-contract.md` §3):

    POST /conversations/{id}/messages
      → 202 { run_id, user_message, assistant_message }   (assistant starts isStreaming:true)
      → the run workflow fills the assistant message and the frontend streams over SSE

So this service owns the *messages*, and `RunService` owns the *execution*; the two are composed by
the route, not nested inside each other.
"""

from __future__ import annotations

from app.application.ports import ConversationRepositoryPort
from app.domain.conversations import (
    Attachment,
    Conversation,
    ConversationMode,
    Message,
    MessageFeedback,
    Sender,
)
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.ids import new_id


class ConversationNotFound(Exception):
    def __init__(self, conversation_id: str) -> None:
        super().__init__(f"conversation {conversation_id!r} was not found")
        self.conversation_id = conversation_id


class MessageNotFound(Exception):
    def __init__(self, message_id: str) -> None:
        super().__init__(f"message {message_id!r} was not found")
        self.message_id = message_id


class PendingTurn:
    """The two messages a chat turn creates, returned so the caller can start the run."""

    __slots__ = ("assistant_message", "user_message")

    def __init__(self, user_message: Message, assistant_message: Message) -> None:
        self.user_message = user_message
        self.assistant_message = assistant_message


class ConversationService:
    def __init__(self, conversations: ConversationRepositoryPort) -> None:
        self._conversations = conversations

    async def list(self, workspace_id: str) -> list[Conversation]:
        return await self._conversations.list(workspace_id)

    async def get(self, workspace_id: str, conversation_id: str) -> Conversation:
        conversation = await self._conversations.get(conversation_id, workspace_id)
        if conversation is None:
            raise ConversationNotFound(conversation_id)
        return conversation

    async def create(
        self, workspace_id: str, *, bot_id: str, title: str | None = None, mode: str | None = None
    ) -> Conversation:
        conversation = Conversation(
            conversation_id=new_id("conv"),
            workspace_id=workspace_id,
            bot_id=bot_id,
            title=(title or "New Conversation").strip() or "New Conversation",
            mode=_mode(mode),
        )
        return await self._conversations.add(conversation)

    async def rename(self, workspace_id: str, conversation_id: str, title: str) -> None:
        if not title.strip():
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT, "title must not be blank", details={"field": "title"}
            )
        if not await self._conversations.rename(conversation_id, workspace_id, title.strip()):
            raise ConversationNotFound(conversation_id)

    async def set_pinned(self, workspace_id: str, conversation_id: str, pinned: bool) -> None:
        if not await self._conversations.set_pinned(conversation_id, workspace_id, pinned):
            raise ConversationNotFound(conversation_id)

    async def delete(self, workspace_id: str, conversation_id: str) -> None:
        if not await self._conversations.delete(conversation_id, workspace_id):
            raise ConversationNotFound(conversation_id)

    async def prepare_turn(
        self,
        workspace_id: str,
        conversation_id: str,
        *,
        content: str,
        attachments: list[Attachment] | None = None,
    ) -> PendingTurn:
        """Create the optimistic user message and the streaming assistant placeholder.

        Both are written before the run starts so the frontend can render the turn immediately, which
        is exactly what `WorkspaceContext.tsx` does with localStorage today.
        """
        await self.get(workspace_id, conversation_id)
        text = (content or "").strip()
        if not text and not attachments:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                "a message needs content or an attachment",
                details={"field": "content"},
            )
        user_message = await self._conversations.add_message(
            Message(
                message_id=new_id("msg"),
                conversation_id=conversation_id,
                sender=Sender.USER,
                content=text,
                attachments=attachments or [],
            )
        )
        assistant_message = await self._conversations.add_message(
            Message(
                message_id=new_id("msg"),
                conversation_id=conversation_id,
                sender=Sender.BOT,
                content="",
                # `isStreaming` is what the frontend keys its typing indicator off.
                is_streaming=True,
            )
        )
        return PendingTurn(user_message=user_message, assistant_message=assistant_message)

    async def set_feedback(self, workspace_id: str, message_id: str, feedback: str) -> Message:
        existing = await self._conversations.get_message(message_id, workspace_id)
        if existing is None:
            raise MessageNotFound(message_id)
        try:
            value = MessageFeedback(feedback)
        except ValueError as exc:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                "feedback must be 'good' or 'bad'",
                details={"field": "feedback", "value": feedback},
            ) from exc
        return await self._conversations.update_message(existing.model_copy(update={"feedback": value}))


def _mode(mode: str | None) -> ConversationMode:
    if not mode:
        return ConversationMode.AGENT_BOT
    try:
        return ConversationMode(mode)
    except ValueError as exc:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"unknown conversation mode {mode!r}",
            details={"field": "mode", "allowed": [str(m) for m in ConversationMode]},
        ) from exc
