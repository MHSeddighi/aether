"""Deterministic fake model client.

Used by unit tests, by the failure evaluator (State 11) and by any run that must not touch a paid
provider. It is a real `ModelClient`, so nothing in the agent knows it is a fake.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from app.infrastructure.models.base import (
    Completion,
    GenerationRequest,
    StreamChunk,
    ToolCall,
)


@dataclass
class ScriptedResponse:
    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    finish_reason: str = "stop"
    input_tokens: int = 11
    output_tokens: int = 7


@dataclass
class FakeModelClient:
    """Replays scripted responses and records every request it received."""

    provider: str = "fake"
    responses: list[ScriptedResponse] = field(default_factory=list)
    requests: list[GenerationRequest] = field(default_factory=list)
    stream_deltas: list[str] | None = None

    def queue(self, response: ScriptedResponse | str) -> FakeModelClient:
        self.responses.append(
            response if isinstance(response, ScriptedResponse) else ScriptedResponse(text=response)
        )
        return self

    async def complete(self, request: GenerationRequest) -> Completion:
        self.requests.append(request)
        if not self.responses:
            return Completion(text="", finish_reason="stop", model=request.model.model_id)
        response = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        return Completion(
            text=response.text,
            tool_calls=response.tool_calls,
            finish_reason=response.finish_reason,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            model=request.model.model_id,
        )

    async def stream(self, request: GenerationRequest) -> AsyncIterator[StreamChunk]:
        self.requests.append(request)
        if not self.responses:
            return
        response = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        for piece in self.stream_deltas or [response.text]:
            yield StreamChunk(text=piece)
        yield StreamChunk(finish_reason=response.finish_reason)

    @property
    def last_request(self) -> GenerationRequest | None:
        return self.requests[-1] if self.requests else None
