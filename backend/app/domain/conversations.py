"""Conversation and message aggregates, mirroring
`web/src/types/agent.ts#ChatConversation` / `#ChatMessage`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Sender(StrEnum):
    USER = "user"
    BOT = "bot"


class ConversationMode(StrEnum):
    AGENT_BOT = "agent-bot"
    SIMPLE_BOT = "simple-bot"
    BOT_BUILDING = "bot-building"
    TOOL_BUILDING = "tool-building"


class HistoryCategory(StrEnum):
    TODAY = "today"
    YESTERDAY = "yesterday"
    PREVIOUS_7_DAYS = "previous7Days"
    OLDER = "older"


#: How many prior turns are handed to the agent. One constant, shared by the API (which selects the
#: history) and the activity (which truncates it), so the two can never disagree.
HISTORY_WINDOW = 20


class ToolActivityStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class MessageFeedback(StrEnum):
    GOOD = "good"
    BAD = "bad"


class Attachment(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    size_formatted: str
    type: str
    file_id: str | None = None


class ToolActivity(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    status: ToolActivityStatus
    detail: str = ""
    tool_id: str | None = None


class KnowledgeRetrieval(BaseModel):
    model_config = ConfigDict(frozen=True)

    count: int = 0
    sources: list[str] = Field(default_factory=list)


class AttachmentProposal(BaseModel):
    """`botProposal`/`toolProposal` in the frontend: a proposal, never applied state (Rule 21)."""

    proposed: dict[str, Any] = Field(default_factory=dict)
    is_confirmed: bool = False
    code_snippet: str | None = None


class Message(BaseModel):
    message_id: str
    conversation_id: str
    run_id: str | None = None
    sender: Sender
    content: str = ""
    is_streaming: bool = False
    bot_proposal: AttachmentProposal | None = None
    tool_proposal: AttachmentProposal | None = None
    tool_activity: list[ToolActivity] = Field(default_factory=list)
    knowledge_retrieval: KnowledgeRetrieval | None = None
    attachments: list[Attachment] = Field(default_factory=list)
    feedback: MessageFeedback | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.message_id,
            "sender": str(self.sender),
            "content": self.content,
            "timestamp": self.created_at.isoformat(),
            "isStreaming": self.is_streaming,
        }
        if self.bot_proposal:
            payload["botProposal"] = {
                "proposedBot": self.bot_proposal.proposed,
                "isConfirmed": self.bot_proposal.is_confirmed,
                **({"codeSnippet": self.bot_proposal.code_snippet} if self.bot_proposal.code_snippet else {}),
            }
        if self.tool_proposal:
            payload["toolProposal"] = {
                "proposedTool": self.tool_proposal.proposed,
                "isConfirmed": self.tool_proposal.is_confirmed,
                **(
                    {"codeSnippet": self.tool_proposal.code_snippet}
                    if self.tool_proposal.code_snippet
                    else {}
                ),
            }
        if self.tool_activity:
            payload["toolActivity"] = [
                {"name": a.name, "status": str(a.status), "detail": a.detail} for a in self.tool_activity
            ]
        if self.knowledge_retrieval:
            payload["knowledgeRetrieval"] = {
                "count": self.knowledge_retrieval.count,
                "sources": list(self.knowledge_retrieval.sources),
            }
        if self.attachments:
            payload["attachments"] = [
                {"name": a.name, "sizeFormatted": a.size_formatted, "type": a.type} for a in self.attachments
            ]
        if self.feedback:
            payload["feedback"] = str(self.feedback)
        return payload


class Conversation(BaseModel):
    conversation_id: str
    workspace_id: str
    title: str = "New Conversation"
    bot_id: str
    mode: ConversationMode = ConversationMode.AGENT_BOT
    is_pinned: bool = False
    messages: list[Message] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self, *, include_messages: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.conversation_id,
            "title": self.title,
            "botId": self.bot_id,
            "category": str(history_category(self.updated_at)),
            "updatedAt": _relative(self.updated_at),
            "isPinned": self.is_pinned,
            "mode": str(self.mode),
        }
        if include_messages:
            payload["messages"] = [m.to_dict() for m in self.messages]
        return payload


def history_category(moment: datetime) -> HistoryCategory:
    age_days = (datetime.now(UTC) - moment).days
    if age_days <= 0:
        return HistoryCategory.TODAY
    if age_days == 1:
        return HistoryCategory.YESTERDAY
    if age_days < 7:
        return HistoryCategory.PREVIOUS_7_DAYS
    return HistoryCategory.OLDER


def _relative(moment: datetime) -> str:
    delta = datetime.now(UTC) - moment
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "Just now"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    return f"{seconds // 86400}d ago"
