"""Translation between the failure taxonomy and Temporal errors (Rule 20/26).

The single rule: a failure that the taxonomy marks non-retryable must reach Temporal as
`ApplicationError(non_retryable=True)` so the server stops retrying it, and a
`CancelledError` must propagate untouched so workflow cancellation is not swallowed.
"""

from __future__ import annotations

import asyncio

from temporalio.exceptions import (
    ApplicationError,
    CancelledError,
    FailureError,
    TerminatedError,
    is_cancelled_exception,
)
from temporalio.exceptions import TimeoutError as TemporalTimeoutError

from app.domain.failures import (
    AgentError,
    CancelledFailure,
    DeadlineExceededFailure,
    FailureKind,
    FailureReason,
    InternalFailure,
    ModelFailure,
    RunFailure,
    SecurityFailure,
    ToolFailure,
    ValidationFailure,
)

#: Reasons worth another attempt at the activity level (provider blips, transient tool errors).
RETRYABLE_MODEL_REASONS = frozenset(
    {FailureReason.MODEL_TIMEOUT, FailureReason.MODEL_RATE_LIMITED, FailureReason.MODEL_PROVIDER_ERROR}
)
RETRYABLE_TOOL_REASONS = frozenset({FailureReason.TOOL_TIMEOUT, FailureReason.TOOL_UNAVAILABLE})


def _failure_type(failure: AgentError) -> str:
    """Stable discriminator carried in `ApplicationError.type` for observability and tests."""
    return f"{failure.kind}.{failure.reason}"


def to_application_error(failure: AgentError, *, message: str | None = None) -> ApplicationError:
    """Wrap a classified failure so Temporal applies the right retry behaviour."""
    return ApplicationError(
        message or failure.message,
        {"failure": failure.to_dict()},
        type=_failure_type(failure),
        non_retryable=not failure.retryable,
    )


def to_activity_error(error: Exception) -> ApplicationError:
    """Normalise anything raised inside an activity.

    * `AgentError` keeps its classification;
    * `asyncio.TimeoutError` / Temporal timeouts become retryable model-or-tool timeouts decided by
      the activity, so callers pass an explicit kind via `timeout_kind`;
    * unknown exceptions are wrapped as non-retryable `internal.unexpected`, because an unclassified
      error is more likely a bug than a transient condition and blind retries hide bugs.
    """
    if isinstance(error, ApplicationError):
        return error
    if isinstance(error, AgentError):
        return to_application_error(error)
    if isinstance(error, TimeoutError):
        return ApplicationError(
            str(error) or "operation timed out",
            type="timeout.unexpected",
            non_retryable=False,
        )
    return ApplicationError(
        str(error) or type(error).__name__,
        {"exception": type(error).__name__},
        type=f"{FailureKind.INTERNAL}.{FailureReason.UNEXPECTED}",
        non_retryable=True,
    )


def classify_activity_error(error: Exception) -> AgentError:
    """Rebuild the domain failure from a Temporal error, so the workflow can branch on it."""
    if is_cancellation(error):
        return CancelledFailure(str(error) or "cancelled")
    if isinstance(error, AgentError):
        return error
    if isinstance(error, ApplicationError):
        payload = next(
            (d.get("failure") for d in error.details if isinstance(d, dict) and "failure" in d), None
        )
        if payload:
            kind = FailureKind(payload.get("kind", FailureKind.INTERNAL))
            reason = FailureReason(payload.get("reason", FailureReason.UNEXPECTED))
            message = payload.get("message", error.message or "")
            details = payload.get("details", {}) or {}
            return _rebuild(kind, reason, message, details)
        if error.type and "." in error.type:
            kind_name, _, reason_name = error.type.partition(".")
            try:
                kind = FailureKind(kind_name)
                reason = FailureReason(reason_name)
            except ValueError:
                kind, reason = FailureKind.INTERNAL, FailureReason.UNEXPECTED
            return _rebuild(kind, reason, error.message or "", {})
        return InternalFailure(FailureReason.UNEXPECTED, error.message or "activity failed")
    if isinstance(error, TemporalTimeoutError):
        return DeadlineExceededFailure(error.message or "activity timed out")
    if isinstance(error, TerminatedError):
        return CancelledFailure(error.message or "workflow terminated")
    if isinstance(error, TimeoutError):
        return DeadlineExceededFailure(str(error) or "operation timed out")
    if isinstance(error, FailureError):
        inner = error.cause
        if isinstance(inner, Exception) and inner is not error:
            return classify_activity_error(inner)
        return InternalFailure(FailureReason.UNEXPECTED, error.message or "failure")
    return InternalFailure(FailureReason.UNEXPECTED, str(error) or type(error).__name__)


def _rebuild(kind: FailureKind, reason: FailureReason, message: str, details: dict) -> AgentError:
    """Rebuild the original failure class from a serialised `ApplicationError` payload."""
    if kind is FailureKind.CANCELLED:
        return CancelledFailure(message)
    if kind is FailureKind.DEADLINE:
        return DeadlineExceededFailure(message, details=details)
    if kind is FailureKind.SECURITY:
        return SecurityFailure(reason, message, details=details)
    factories = {
        FailureKind.MODEL: ModelFailure,
        FailureKind.VALIDATION: ValidationFailure,
        FailureKind.TOOL: ToolFailure,
    }
    factory = factories.get(kind, InternalFailure)
    return factory(reason, message, details=details)


def is_cancellation(error: BaseException) -> bool:
    """True when `error` is, or wraps, a cancellation.

    A cancelled activity usually reaches workflow code wrapped in a `FailureError`, so the whole
    `__cause__`/`__context__` chain is inspected; otherwise a user cancellation would be recorded as
    an internal failure and the run would be marked `failed` instead of `cancelled`.
    """
    seen: set[int] = set()
    current: BaseException | None = error
    while isinstance(current, BaseException) and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (CancelledError, CancelledFailure, asyncio.CancelledError)):
            return True
        if isinstance(current, Exception) and is_cancelled_exception(current):
            return True
        current = current.__cause__ or current.__context__
    return False


def failure_from_exception(error: BaseException) -> RunFailure:
    """The projection persisted on the run row (Rule 19)."""
    if isinstance(error, AgentError):
        return RunFailure.from_error(error)
    return RunFailure.from_error(
        classify_activity_error(error if isinstance(error, Exception) else Exception(str(error)))
    )
