"""OpenAI-compatible model client: one adapter for OpenRouter, OpenCode Zen and DeepSeek.

All three speak the same wire protocol, so the differences are configuration (base URL, headers, key)
plus a small amount of normalisation:

* keyless access is allowed (Zen serves free models without a key);
* fenced ```json blocks are stripped before the caller parses them;
* `reasoning_content` is captured separately and never leaks into the answer text;
* timeouts come from the SDK, which wraps them as classified `ModelFailure`s.

Provider-specific HTTP behaviour is translated into the failure taxonomy here, and nowhere else
(Rule 29: provider objects must not escape the gateway).
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx
from openai import APIStatusError, APITimeoutError, AsyncOpenAI, RateLimitError

from app.domain.failures import FailureReason, ModelFailure
from app.infrastructure.config import ProviderConfig, RetryPolicy
from app.infrastructure.logging_config import get_logger
from app.infrastructure.models.base import (
    ChatMessage,
    Completion,
    GenerationRequest,
    StreamChunk,
    ToolCall,
)

logger = get_logger(__name__)

#: Placeholder for the SDK, which insists on a non-empty key. It never reaches the wire when the
#: provider is configured keyless: OpenCode Zen serves free models anonymously and rejects a bogus
#: `Bearer` header with 401, so `AnonymousTransport` removes it.
_PLACEHOLDER_KEY = "no-key-required"


class AnonymousTransport(httpx.AsyncHTTPTransport):
    """Strips the `Authorization` header the SDK derives from the placeholder key."""

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        request.headers.pop("authorization", None)
        return await super().handle_async_request(request)


_FENCE_RE = re.compile(r"^\s*```(?:[A-Za-z0-9_+-]+)?\s*(.*?)\s*```\s*$", re.DOTALL)
_RETRYABLE_STATUS = frozenset({408, 409, 425, 500, 502, 503, 504})


class OpenAICompatibleModelClient:
    """`ModelClient` implementation over the OpenAI SDK."""

    def __init__(
        self,
        provider: ProviderConfig,
        *,
        client: AsyncOpenAI | None = None,
        http_client: Any | None = None,
    ) -> None:
        self._provider = provider
        api_key = provider.resolved_api_key()
        self._client = client or AsyncOpenAI(
            base_url=provider.base_url,
            api_key=api_key or _PLACEHOLDER_KEY,
            default_headers=dict(provider.extra_headers) or None,
            # The SDK owns timeouts and connection pooling (Rule 41); the per-request value is
            # overridden from the run's deadline.
            timeout=60.0,
            http_client=http_client or _default_http_client(keyless=api_key is None),
            max_retries=0,  # retries are explicit in the gateway, driven by the taxonomy
        )

    @property
    def provider(self) -> str:
        return str(self._provider.name)

    # --- completion -------------------------------------------------------

    async def complete(self, request: GenerationRequest) -> Completion:
        payload = self._build_payload(request, stream=False)
        timeout = min(request.model.timeout_seconds, 600.0)
        try:
            response = await self._client.chat.completions.create(**payload, timeout=timeout)
        except Exception as exc:
            raise translate_error(exc, self.provider, request.model.model_id) from exc

        choice = response.choices[0]
        message = choice.message
        return Completion(
            text=_normalise_text(getattr(message, "content", None)),
            tool_calls=_tool_calls(getattr(message, "tool_calls", None)),
            finish_reason=choice.finish_reason or "stop",
            input_tokens=getattr(response.usage, "prompt_tokens", 0) if response.usage else 0,
            output_tokens=getattr(response.usage, "completion_tokens", 0) if response.usage else 0,
            model=response.model,
            reasoning=getattr(message, "reasoning_content", None) or None,
        )

    async def stream(self, request: GenerationRequest) -> AsyncIterator[StreamChunk]:
        """Yield normalised chunks. Provider stream objects never leave this method."""
        payload = self._build_payload(request, stream=True)
        timeout = min(request.model.timeout_seconds, 600.0)
        try:
            stream = await self._client.chat.completions.create(**payload, stream=True, timeout=timeout)
            async for chunk in stream:
                yield _chunk(chunk)
        except Exception as exc:
            raise translate_error(exc, self.provider, request.model.model_id) from exc

    # --- payload rendering ------------------------------------------------

    def _build_payload(self, request: GenerationRequest, *, stream: bool) -> dict[str, Any]:
        model = request.model
        payload: dict[str, Any] = {
            "model": model.model_id,
            "messages": [_render_message(message) for message in request.messages],
            "temperature": request.temperature if request.temperature is not None else model.temperature,
            "top_p": model.top_p,
            "max_tokens": request.max_output_tokens or model.max_output_tokens,
        }
        if request.tools:
            payload["tools"] = [tool.as_openai_tool() for tool in request.tools]
            payload["tool_choice"] = "auto"
        if request.response_schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": request.response_schema.get("title", "response"),
                    "schema": request.response_schema,
                    "strict": False,
                },
            }
        if request.stop:
            payload["stop"] = list(request.stop)
        if stream:
            payload["stream_options"] = {"include_usage": True}
        return payload


def _default_http_client(*, keyless: bool) -> httpx.AsyncClient:
    if keyless:
        return httpx.AsyncClient(transport=AnonymousTransport())
    return httpx.AsyncClient()


# --- normalisation ---------------------------------------------------------


def _render_message(message: ChatMessage) -> dict[str, Any]:
    rendered: dict[str, Any] = {"role": message.role, "content": message.content}
    if message.tool_calls:
        rendered["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
            }
            for call in message.tool_calls
        ]
    if message.tool_call_id:
        rendered["tool_call_id"] = message.tool_call_id
    if message.name:
        rendered["name"] = message.name
    return rendered


def _normalise_text(content: Any) -> str:
    """Trim whitespace and unwrap a fenced JSON block; the caller validates the content anyway."""
    if not content:
        return ""
    text = str(content).strip()
    match = _FENCE_RE.match(text)
    if match:
        return match.group(1).strip()
    return text


def _tool_calls(raw: Any) -> tuple[ToolCall, ...]:
    calls: list[ToolCall] = []
    for call in raw or ():
        arguments = call.function.arguments
        try:
            parsed = json.loads(arguments) if isinstance(arguments, str) else dict(arguments or {})
        except json.JSONDecodeError:
            parsed = {}
        calls.append(ToolCall(id=call.id, name=call.function.name, arguments=parsed))
    return tuple(calls)


def _chunk(raw: Any) -> StreamChunk:
    if not raw.choices:
        return StreamChunk()
    choice = raw.choices[0]
    delta = choice.delta
    call = None
    if getattr(delta, "tool_calls", None):
        first = delta.tool_calls[0]
        if first.function and first.function.name:
            call = ToolCall(
                id=first.id or "",
                name=first.function.name,
                arguments=_safe_json(first.function.arguments),
            )
    return StreamChunk(
        text=getattr(delta, "content", None) or "",
        tool_call_delta=call,
        finish_reason=choice.finish_reason,
    )


def _safe_json(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}


# --- error translation -----------------------------------------------------


def translate_error(exc: Exception, provider: str, model_id: str) -> ModelFailure:
    """Map a provider/SDK error onto the failure taxonomy (Rule 20)."""
    if isinstance(exc, ModelFailure):
        return exc

    details = {"provider": provider, "model": model_id, "error": type(exc).__name__}

    if isinstance(exc, (APITimeoutError, TimeoutError)):
        return ModelFailure(
            FailureReason.MODEL_TIMEOUT,
            f"{provider} did not answer in time",
            details=details,
        )
    if isinstance(exc, RateLimitError):
        return ModelFailure(
            FailureReason.MODEL_RATE_LIMITED,
            f"{provider} rate limit reached",
            details={**details, "status": exc.status_code},
        )
    if isinstance(exc, APIStatusError):
        status = exc.status_code
        if status == 429:
            return ModelFailure(
                FailureReason.MODEL_RATE_LIMITED,
                f"{provider} rate limit reached",
                details={**details, "status": status},
            )
        if status in (401, 403):
            return ModelFailure(
                FailureReason.MODEL_AUTH,
                f"{provider} rejected the credentials",
                details={**details, "status": status},
            )
        if status == 400 or status == 404 or status == 422:
            return ModelFailure(
                FailureReason.MODEL_BAD_REQUEST,
                f"{provider} rejected the request: {str(exc)[:200]}",
                details={**details, "status": status},
            )
        if status in _RETRYABLE_STATUS:
            return ModelFailure(
                FailureReason.MODEL_PROVIDER_ERROR,
                f"{provider} returned {status}",
                details={**details, "status": status},
            )
        return ModelFailure(
            FailureReason.MODEL_BAD_REQUEST,
            f"{provider} returned {status}",
            details={**details, "status": status},
        )

    message = str(exc)
    if "connection" in message.lower() or "network" in message.lower():
        return ModelFailure(FailureReason.MODEL_PROVIDER_ERROR, f"cannot reach {provider}", details=details)
    return ModelFailure(
        FailureReason.MODEL_PROVIDER_ERROR, f"{provider} call failed: {message[:200]}", details=details
    )


def retry_policy_from(config: RetryPolicy | None) -> RetryPolicy:
    """Temporal's retry policy shape, reused for gateway-level retries."""
    return config or RetryPolicy()
