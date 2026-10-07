"""Schemas at the AI boundary (Rule 21).

Nothing here is ever populated from raw model JSON without passing through these models, and every
model is validated again on the way *out* of an activity.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.conversations import (
    Attachment,
    KnowledgeRetrieval,
    ToolActivity,
    ToolActivityStatus,
)
from app.domain.tools import ToolPermission


class BotProposal(BaseModel):
    """`botProposal` in the frontend: a *proposal* the user confirms, never applied state."""

    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    bot_type: str = Field(default="agent", pattern="^(agent|simple)$")
    instructions: str = ""
    provider: str = Field(default="opencode", pattern="^(openrouter|opencode|deepseek)$")
    model_id: str = "space-bunny-free"
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    tool_ids: list[str] = Field(default_factory=list)
    knowledge_ids: list[str] = Field(default_factory=list)
    deterministic_rules: list[dict[str, str]] = Field(default_factory=list)
    code_snippet: str | None = None

    @property
    def as_payload(self) -> dict[str, Any]:
        """Validated projection stored on the message (Rule 21: never raw model JSON)."""
        return self.model_dump(mode="json", exclude={"code_snippet"})


class ToolProposal(BaseModel):
    """`toolProposal` in the frontend."""

    name: str = Field(min_length=1, max_length=200)
    purpose: str = ""
    category: str = Field(default="api", pattern="^(search|compute|data|api|mcp)$")
    icon: str = "Link"
    handler: str = Field(default="http", pattern="^(builtin|http|docker)$")
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    permissions: list[ToolPermission] = Field(default_factory=list)
    code_snippet: str | None = None


class AgentUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class AgentResult(BaseModel):
    """The validated outcome of one agent execution."""

    model_config = ConfigDict(extra="forbid")

    response: str = ""
    tool_activity: list[ToolActivity] = Field(default_factory=list)
    knowledge_retrieval: KnowledgeRetrieval | None = None
    bot_proposal: BotProposal | None = None
    tool_proposal: ToolProposal | None = None
    attachments: list[Attachment] = Field(default_factory=list)
    usage: AgentUsage = Field(default_factory=AgentUsage)
    steps: int = 0
    repairs: int = 0
    finished_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def _needs_content(self) -> AgentResult:
        if not self.response.strip() and not self.bot_proposal and not self.tool_proposal:
            raise ValueError("agent result must contain a response or a proposal")
        return self

    @property
    def succeeded(self) -> bool:
        return bool(self.response.strip() or self.bot_proposal or self.tool_proposal)


def failed_tool_activity(name: str, detail: str) -> ToolActivity:
    return ToolActivity(name=name, status=ToolActivityStatus.FAILED, detail=detail)
