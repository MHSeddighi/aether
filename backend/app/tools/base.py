"""The tool boundary the agent depends on.

The agent never touches infrastructure: it hands a tool call to this one-method port and receives a
validated `ToolOutcome`. `ToolGateway` (State 7) implements it; tests use a recording fake.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from app.domain.deadline import Deadline


@dataclass(frozen=True, slots=True)
class ToolOutcome:
    """Result of one tool invocation. `ok=False` carries a classified reason in `error`."""

    tool_id: str
    name: str
    ok: bool
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    #: Short human-readable detail for the frontend's `toolActivity` (Rule 30).
    detail: str = ""
    duration_ms: int = 0
    idempotent_replay: bool = False

    def as_message_content(self) -> str:
        """What goes back into the conversation; always JSON so the model can read it."""
        import json

        if self.ok:
            return json.dumps(self.output, default=str)[:8000]
        return json.dumps({"error": self.error, "detail": self.detail})


@runtime_checkable
class ToolExecutor(Protocol):
    async def execute(
        self,
        *,
        tool_id: str,
        name: str,
        arguments: dict[str, Any],
        deadline: Deadline,
        idempotency_key: str,
        tool: Any | None = None,
    ) -> ToolOutcome:
        """Run one tool call.

        Implementations must validate input, check permissions, honour `deadline`, be idempotent for
        a repeated `idempotency_key`, validate output, and classify every error (Rule 30).
        """
        ...


class NoToolsConfigured(ToolExecutor):
    """Used when a bot has no tools: any call is an explicit, classified refusal."""

    async def execute(self, *, name: str, **_kwargs: Any) -> ToolOutcome:
        from app.domain.failures import FailureReason, SecurityFailure

        raise SecurityFailure(
            FailureReason.UNAUTHORIZED_TOOL,
            f"tool {name!r} is not available to this bot",
            details={"tool": name},
        )
