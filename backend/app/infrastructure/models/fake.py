"""Deterministic fake model client.

Used by unit tests, by the failure evaluator (State 11) and by any run that must not touch a paid
provider. It is a real `ModelClient`, so nothing in the agent knows it is a fake.

Two ways to script it:

    FakeModelClient().queue("plain answer")                      # complete()
    FakeModelClient(stream_deltas=[["par", "tial"]])            # stream() chunk list

`stream_deltas` is a queue with one entry per streamed response; an empty entry means "this step
produced no text yet" (typically the step that asks for a tool call).
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
    provider: str = "fake"
    responses: list[ScriptedResponse] = field(default_factory=list)
    requests: list[GenerationRequest] = field(default_factory=list)
    stream_deltas: list[list[str]] = field(default_factory=list)
    #: When true (the default) the last queued response repeats once the queue runs dry, which is
    #: what most tests want. Set it to false to script an exact sequence — for example a repair loop
    #: whose first attempt must fail and whose second must succeed.
    sticky: bool = True

    def queue(self, response: ScriptedResponse | str) -> FakeModelClient:
        """Append a response. The last one is reused once the queue runs dry."""
        self.responses.append(
            response if isinstance(response, ScriptedResponse) else ScriptedResponse(text=response)
        )
        return self

    def queue_stream(self, pieces: list[str]) -> FakeModelClient:
        self.stream_deltas.append(pieces)
        return self

    async def complete(self, request: GenerationRequest) -> Completion:
        self.requests.append(request)
        response = self._next_response()
        if response is None:
            return Completion(text="", finish_reason="stop", model=request.model.model_id)
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
        # A queued response drives tool calls, finish reason and usage; `stream_deltas` drives only
        # the text, so a step can be scripted as "call a tool, say nothing".
        response = self._next_response() if self.responses else None
        if self.stream_deltas:
            pieces = self.stream_deltas.pop(0)
        elif response is not None:
            pieces = [response.text]
        else:
            return

        for piece in pieces:
            yield StreamChunk(text=piece)
        if response is not None:
            for call in response.tool_calls:
                yield StreamChunk(tool_call_delta=call)
        yield StreamChunk(
            finish_reason=response.finish_reason if response else "stop",
            usage=(
                {"input_tokens": response.input_tokens, "output_tokens": response.output_tokens}
                if response
                else None
            ),
        )

    @property
    def last_request(self) -> GenerationRequest | None:
        return self.requests[-1] if self.requests else None

    def _next_response(self) -> ScriptedResponse | None:
        if not self.responses:
            return None
        if self.sticky and len(self.responses) == 1:
            return self.responses[0]
        return self.responses.pop(0)


@dataclass
class FailingModelClient:
    """A `ModelClient` that always raises a chosen classified failure.

    Used by the failure evaluator (State 11) to prove that a provider timeout / rate limit reaches the
    caller as the right `AgentError` and not as a bare exception.
    """

    error: Exception
    provider: str = "fake"

    async def complete(self, request: GenerationRequest) -> Completion:  # noqa: ARG002
        raise self.error

    async def stream(self, request: GenerationRequest) -> AsyncIterator[StreamChunk]:  # noqa: ARG002
        raise self.error
        yield StreamChunk()  # pragma: no cover - makes this an async generator
