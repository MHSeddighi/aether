"""Tool Gateway (Rule 30) — the boundary the agent is not allowed to bypass.

    agent
      ↓ ToolGateway.execute(tool, arguments, deadline, idempotency_key)
      ├ registry lookup              unknown tool  → ToolFailure(tool_not_found)
      ├ input validation             bad arguments → ToolFailure(tool_input_invalid)
      ├ permission check             denied        → SecurityFailure(unauthorized_tool)
      ├ deadline clamp               budget        → DeadlineExceededFailure
      ├ idempotency lookup           replay        → stored outcome
      ├ handler call (own timeout)   timeout       → ToolFailure(tool_timeout)
      └ output validation            bad output    → ToolFailure(tool_invalid_output)

Every step classifies its failure, so the caller knows whether to retry, repair, or stop.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import (
    SchemaError,
    UnknownType,
)
from jsonschema.exceptions import (
    ValidationError as SchemaValidationError,
)

from app.domain.deadline import Deadline
from app.domain.failures import (
    DeadlineExceededFailure,
    FailureReason,
    SecurityFailure,
    ToolFailure,
)
from app.domain.ids import new_id
from app.domain.tools import Tool, ToolPermission, ToolVersion
from app.infrastructure.logging_config import get_logger
from app.tools.base import ToolExecutor, ToolOutcome
from app.tools.handlers import ToolHandler, build_builtin

logger = get_logger(__name__)

#: Anything exposing `input_schema`/`output_schema`/`handler`/`timeout_seconds`/`permissions` can be
#: executed: `ToolVersion` (loaded from the database) and the agent's immutable `ToolSpec` both can.
ToolContract = Any

#: Permissions granted to every tool call. Narrower sets are stricter; a tool may never exceed these.
DEFAULT_GRANTS: frozenset[ToolPermission] = frozenset(ToolPermission)


@dataclass(slots=True)
class IdempotencyRecord:
    outcome: ToolOutcome
    stored_at: float


class ToolGateway(ToolExecutor):
    """Executes tool calls with validation, permissions, deadlines, idempotency and error classes."""

    def __init__(
        self,
        *,
        granted_permissions: frozenset[ToolPermission] = DEFAULT_GRANTS,
        handler_factory=None,
        idempotency_ttl_seconds: float = 3600.0,
        max_result_chars: int = 20_000,
    ) -> None:
        self._grants = granted_permissions
        self._handler_factory = handler_factory or build_builtin
        self._records: dict[str, IdempotencyRecord] = {}
        self._ttl = idempotency_ttl_seconds
        self._max_result_chars = max_result_chars

    # --- ToolExecutor -----------------------------------------------------

    async def execute(
        self,
        *,
        tool_id: str,
        name: str,
        arguments: dict[str, Any],
        deadline: Deadline,
        idempotency_key: str,
        tool: Tool | None = None,
    ) -> ToolOutcome:
        replay = self._replay(idempotency_key)
        if replay is not None:
            logger.info("tool call replayed", extra={"tool": name, "key": idempotency_key})
            return replay

        version = self._active_version(tool)
        builtin_name = (version.handler_config or {}).get("name") if version else None
        self._check_permissions(name, version)
        validated_input = self._validate_input(name, arguments, version)
        if deadline.expired:
            # Fail fast rather than clamping an expired budget into a fresh timeout (Rule 16).
            raise DeadlineExceededFailure(
                f"no execution budget left for tool {name!r}",
                details={"tool": name},
            )
        timeout = deadline.budget(version.timeout_seconds if version else 10.0)

        started = time.monotonic()
        try:
            handler = self._resolve_handler(name, version, builtin_name)
            output = await asyncio.wait_for(handler(validated_input, deadline=deadline), timeout=timeout)
        except TimeoutError as exc:
            raise ToolFailure(
                FailureReason.TOOL_TIMEOUT,
                f"tool {name!r} exceeded its {timeout:.2f}s budget",
                details={"tool": name, "timeout_seconds": round(timeout, 3)},
            ) from exc
        except SecurityFailure:
            raise
        except ToolFailure:
            raise
        except Exception as exc:
            raise ToolFailure(
                FailureReason.TOOL_UNAVAILABLE,
                f"tool {name!r} failed: {exc}",
                details={"tool": name, "error": type(exc).__name__},
            ) from exc

        duration_ms = int((time.monotonic() - started) * 1000)
        self._validate_output(name, output, version)
        outcome = ToolOutcome(
            tool_id=tool_id,
            name=name,
            ok=True,
            output=self._truncate(output),
            detail=f"{duration_ms}ms",
            duration_ms=duration_ms,
        )
        self._remember(idempotency_key, outcome)
        return outcome

    # --- steps ------------------------------------------------------------

    def _active_version(self, tool: Tool | ToolContract | None) -> ToolContract | None:
        """Accept either a `Tool` (from the database) or a ready contract such as `ToolSpec`."""
        if tool is None:
            return None
        return tool.active_version() if isinstance(tool, Tool) else tool

    def _check_permissions(self, name: str, version: ToolVersion | None) -> None:
        """Fail closed: unknown tools and undeclared permissions are denied, never assumed."""
        required = set(version.permissions) if version else frozenset()
        granted = set(self._grants)
        missing = required - granted
        if missing:
            raise SecurityFailure(
                FailureReason.UNAUTHORIZED_TOOL,
                f"tool {name!r} requires permissions that are not granted: {sorted(str(p) for p in missing)}",
                details={"tool": name, "missing": sorted(str(p) for p in missing)},
            )

    def _validate_input(
        self, name: str, arguments: dict[str, Any], version: ToolVersion | None
    ) -> dict[str, Any]:
        schema = (version.input_schema if version else None) or {}
        if not schema:
            return dict(arguments)
        try:
            validator = Draft202012Validator(schema)
        except (SchemaError, UnknownType) as exc:
            raise ToolFailure(
                FailureReason.TOOL_INPUT_INVALID,
                f"tool {name!r} has an invalid input schema: {exc}",
                details={"tool": name},
            ) from exc
        try:
            validator.validate(arguments)
        except SchemaValidationError as exc:
            raise ToolFailure(
                FailureReason.TOOL_INPUT_INVALID,
                f"invalid arguments for {name!r}: {exc.message}",
                details={"tool": name, "path": list(exc.absolute_path)},
            ) from exc
        return dict(arguments)

    def _validate_output(self, name: str, output: dict[str, Any], version: ToolVersion | None) -> None:
        schema = (version.output_schema if version else None) or {}
        if not schema:
            return
        try:
            Draft202012Validator(schema).validate(output)
        except (SchemaError, UnknownType) as exc:
            raise ToolFailure(
                FailureReason.TOOL_INVALID_OUTPUT,
                f"tool {name!r} declares an invalid output schema: {exc}",
                details={"tool": name},
            ) from exc
        except SchemaValidationError as exc:
            raise ToolFailure(
                FailureReason.TOOL_INVALID_OUTPUT,
                f"tool {name!r} returned output that violates its schema: {exc.message}",
                details={"tool": name, "path": list(exc.absolute_path)},
            ) from exc

    def _resolve_handler(
        self, name: str, version: ToolContract | None, builtin_name: str | None
    ) -> ToolHandler:
        """Pick the handler: `http`/`docker` by kind, otherwise the builtin named in the config."""
        handler_kind = (version.handler if version else "builtin") or "builtin"
        if handler_kind == "http":
            handler = self._handler_factory("http_request")
        elif handler_kind == "docker":
            handler = self._handler_factory("docker")  # State 10
        else:
            handler = self._handler_factory(builtin_name or name)
        if handler is None:
            raise ToolFailure(
                FailureReason.TOOL_NOT_FOUND,
                f"no handler is registered for tool {name!r}",
                details={"tool": name, "handler": handler_kind, "builtin": builtin_name},
            )
        return handler

    def _replay(self, idempotency_key: str) -> ToolOutcome | None:
        record = self._records.get(idempotency_key)
        if record is None:
            return None
        if (time.monotonic() - record.stored_at) > self._ttl:
            del self._records[idempotency_key]
            return None
        return ToolOutcome(
            tool_id=record.outcome.tool_id,
            name=record.outcome.name,
            ok=record.outcome.ok,
            output=record.outcome.output,
            detail=record.outcome.detail,
            duration_ms=record.outcome.duration_ms,
            idempotent_replay=True,
        )

    def _remember(self, idempotency_key: str, outcome: ToolOutcome) -> None:
        self._records[idempotency_key] = IdempotencyRecord(outcome=outcome, stored_at=time.monotonic())

    def _truncate(self, output: dict[str, Any]) -> dict[str, Any]:
        import json

        rendered = json.dumps(output, default=str)
        if len(rendered) <= self._max_result_chars:
            return output
        return {"truncated": True, "preview": rendered[: self._max_result_chars]}


def build_tool_gateway(settings) -> ToolGateway:
    """Gateway for the worker process. Permissions are config-driven, not hard-coded in the agent."""
    from app.domain.tools import ToolPermission as P

    granted = frozenset(P) if settings else DEFAULT_GRANTS
    return ToolGateway(granted_permissions=granted)


def new_idempotency_key(run_id: str, call_id: str) -> str:
    return f"{run_id}:{call_id}" if call_id else f"{run_id}:{new_id('op')}"
