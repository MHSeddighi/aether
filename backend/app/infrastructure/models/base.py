"""The model gateway port (Interface Segregation, Rule 4/29).

Three small capabilities instead of one wide `AIProvider` interface, so a caller asks for exactly
what it needs and a fake only has to implement what the tests exercise. Provider response objects
never leave this layer: everything crossing the boundary is one of these dataclasses.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from app.domain.models import ModelConfig
from app.domain.tools import ToolPermission


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: str  # system | user | assistant | tool
    content: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str | None = None
    name: str | None = None


@dataclass(frozen=True, slots=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ModelTool:
    """A tool as the model sees it, plus the permissions the gateway will enforce."""

    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)
    permissions: tuple[ToolPermission, ...] = ()

    def as_openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema or {"type": "object", "properties": {}},
            },
        }


@dataclass(frozen=True, slots=True)
class Completion:
    """A normalised, provider-agnostic completion."""

    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    finish_reason: str = "stop"
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    #: Provider reasoning text (Zen/OpenRouter expose `reasoning_content`). Kept for observability
    #: and never mixed into `text`.
    reasoning: str | None = None


@dataclass(frozen=True, slots=True)
class StreamChunk:
    text: str = ""
    tool_call_delta: ToolCall | None = None
    finish_reason: str | None = None
    #: Present only on the final chunk when the caller asked for `stream_options.include_usage`.
    usage: dict[str, int] | None = None


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    """One model call."""

    model: ModelConfig
    messages: tuple[ChatMessage, ...]
    tools: tuple[ModelTool, ...] = ()
    #: JSON schema the model should satisfy; the caller still validates (Rule 21).
    response_schema: dict[str, Any] | None = None
    max_output_tokens: int | None = None
    temperature: float | None = None
    stop: tuple[str, ...] = ()


@runtime_checkable
class ModelCompletion(Protocol):
    async def complete(self, request: GenerationRequest) -> Completion: ...


@runtime_checkable
class ModelStreaming(Protocol):
    def stream(self, request: GenerationRequest):  # -> AsyncIterator[StreamChunk]
        ...


@runtime_checkable
class ModelClient(ModelCompletion, ModelStreaming, Protocol):
    """What the agent depends on. Implemented by the OpenAI-compatible adapter and by fakes."""

    @property
    def provider(self) -> str: ...


def system_message(text: str) -> ChatMessage:
    return ChatMessage(role="system", content=text)


def user_message(text: str) -> ChatMessage:
    return ChatMessage(role="user", content=text)


def assistant_message(text: str, tool_calls: tuple[ToolCall, ...] = ()) -> ChatMessage:
    return ChatMessage(role="assistant", content=text, tool_calls=tool_calls)


def tool_result_message(tool_call_id: str, name: str, content: str) -> ChatMessage:
    return ChatMessage(role="tool", content=content, tool_call_id=tool_call_id, name=name)
