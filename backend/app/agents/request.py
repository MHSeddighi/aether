"""What an agent execution needs, and what it may emit while running."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.agents.contracts import AgentResult
from app.domain.bots import BotType
from app.domain.conversations import HISTORY_WINDOW
from app.domain.models import ModelConfig
from app.domain.tools import ToolPermission

#: The activity truncates whatever history it is given to this window; the API selects it using the
#: same constant, so the two halves can never disagree about how much context a run carries.
MAX_HISTORY_MESSAGES = HISTORY_WINDOW


class ConversationTurn(BaseModel):
    model_config = ConfigDict(frozen=True)

    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ToolSpec(BaseModel):
    """The subset of a tool version the agent is allowed to see and the gateway will enforce."""

    model_config = ConfigDict(frozen=True)

    tool_id: str
    name: str
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: float = 20.0
    permissions: tuple[ToolPermission, ...] = ()
    #: How the Tool Gateway runs this tool: `builtin` | `http` | `docker` (State 10).
    handler: str = "builtin"
    #: Selects the concrete builtin (`python_math`, `knowledge_search`, ...) or the http target.
    handler_config: dict[str, Any] = Field(default_factory=dict)

    def as_openai_tool(self) -> dict[str, Any]:
        """Provider-neutral function definition; the adapter renders it in the provider's dialect."""
        return {
            "type": "function",
            "function": {
                "name": self.tool_id.replace("-", "_"),
                "description": self.description or self.name,
                "parameters": self.input_schema or {"type": "object", "properties": {}},
            },
        }


@dataclass(frozen=True, slots=True)
class AgentRequest:
    """Immutable execution input, assembled by `LoadBotVersion` and captured on the run."""

    run_id: str
    bot_id: str
    bot_version_id: str
    bot_version: str
    bot_type: BotType
    instructions: str
    message: str
    model: ModelConfig
    history: tuple[ConversationTurn, ...] = ()
    tools: tuple[ToolSpec, ...] = ()
    knowledge: tuple[str, ...] = ()
    deterministic_rules: tuple[dict[str, str], ...] = ()
    attachments: tuple[dict[str, Any], ...] = ()
    max_steps: int = 8
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(frozen=True, slots=True)
class AgentEvent:
    """Emitted during execution. `persisted=False` for token deltas (Rule 27)."""

    type: str
    data: dict[str, Any] = field(default_factory=dict)
    persisted: bool = True


class AgentEventSink:
    """Callback bundle handed to a runner: durable events vs ephemeral deltas."""

    def __init__(self, emit) -> None:
        self._emit = emit

    async def event(self, event_type: str, **data: Any) -> None:
        await self._emit(AgentEvent(type=event_type, data=data, persisted=True))

    async def delta(self, text: str) -> None:
        await self._emit(AgentEvent(type="agent.delta", data={"text": text}, persisted=False))


__all__ = [
    "AgentEvent",
    "AgentEventSink",
    "AgentRequest",
    "AgentResult",
    "ConversationTurn",
    "ToolSpec",
]
