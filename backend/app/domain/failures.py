"""Failure taxonomy (Rule 19/20).

Every failure in the system is one of a small number of kinds, and every kind carries a *reason* and
a retry disposition. Nothing in the codebase raises a bare `FAILED`; persistence, Temporal retry
policies and the API all derive from these attributes.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FailureKind(StrEnum):
    MODEL = "model"
    VALIDATION = "validation"
    TOOL = "tool"
    SECURITY = "security"
    CANCELLED = "cancelled"
    DEADLINE = "deadline"
    INTERNAL = "internal"


class FailureReason(StrEnum):
    # model
    MODEL_TIMEOUT = "model_timeout"
    MODEL_RATE_LIMITED = "model_rate_limited"
    MODEL_PROVIDER_ERROR = "model_provider_error"
    MODEL_AUTH = "model_auth"
    MODEL_BAD_REQUEST = "model_bad_request"
    # validation
    OUTPUT_SCHEMA = "output_schema"
    OUTPUT_CONSTRAINT = "output_constraint"
    REPAIR_EXHAUSTED = "repair_exhausted"
    # tool
    TOOL_TIMEOUT = "tool_timeout"
    TOOL_UNAVAILABLE = "tool_unavailable"
    TOOL_INVALID_OUTPUT = "tool_invalid_output"
    TOOL_NOT_FOUND = "tool_not_found"
    TOOL_INPUT_INVALID = "tool_input_invalid"
    # security
    UNAUTHORIZED_TOOL = "unauthorized_tool"
    UNSAFE_ARGUMENTS = "unsafe_arguments"
    SANDBOX_VIOLATION = "sandbox_violation"
    # control flow
    CANCELLED = "cancelled"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    # catch-all
    UNEXPECTED = "unexpected"


# Reasons that are worth another attempt (same input, probably a different outcome).
_RETRYABLE: frozenset[FailureReason] = frozenset(
    {
        FailureReason.MODEL_TIMEOUT,
        FailureReason.MODEL_RATE_LIMITED,
        FailureReason.MODEL_PROVIDER_ERROR,
        FailureReason.TOOL_TIMEOUT,
        FailureReason.TOOL_UNAVAILABLE,
        FailureReason.DEADLINE_EXCEEDED,
    }
)

#: An unclassified error is a defect, not a blip: retrying it only hides the defect.
_NOT_RETRYABLE: frozenset[FailureReason] = frozenset({FailureReason.UNEXPECTED})

# Reasons a bounded repair pass can fix by asking the model again.
_REPAIRABLE: frozenset[FailureReason] = frozenset(
    {
        FailureReason.OUTPUT_SCHEMA,
        FailureReason.OUTPUT_CONSTRAINT,
        FailureReason.TOOL_INPUT_INVALID,
    }
)


class AgentError(Exception):
    """Base class for classified failures.

    Attributes are the single source of truth for retry decisions:
    ``retryable`` drives Temporal activity retry policy, ``repairable`` drives the bounded
    self-repair loop (Rule 23).
    """

    kind: FailureKind = FailureKind.INTERNAL

    def __init__(
        self,
        reason: FailureReason,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        retryable: bool | None = None,
        repairable: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.details: dict[str, Any] = details or {}
        self._retryable_override = retryable
        self._repairable_override = repairable

    @property
    def retryable(self) -> bool:
        if self._retryable_override is not None:
            return self._retryable_override
        if self.reason in _NOT_RETRYABLE:
            return False
        return self.reason in _RETRYABLE

    @property
    def repairable(self) -> bool:
        if self._repairable_override is not None:
            return self._repairable_override
        return self.reason in _REPAIRABLE

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": str(self.kind),
            "reason": str(self.reason),
            "message": self.message,
            "retryable": self.retryable,
            "details": self.details,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"{type(self).__name__}(reason={self.reason}, message={self.message!r})"


class ModelFailure(AgentError):
    kind = FailureKind.MODEL


class ValidationFailure(AgentError):
    kind = FailureKind.VALIDATION


class ToolFailure(AgentError):
    kind = FailureKind.TOOL


class InternalFailure(AgentError):
    """A bug or an unclassified condition. Never retried: blind retries only hide defects."""

    kind = FailureKind.INTERNAL


class SecurityFailure(AgentError):
    kind = FailureKind.SECURITY

    def __init__(
        self,
        reason: FailureReason,
        message: str,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        # Security failures are never retryable and never repairable, whatever the reason table
        # says.
        super().__init__(reason, message, details=details, retryable=False, repairable=False)


class CancelledFailure(AgentError):
    kind = FailureKind.CANCELLED

    def __init__(self, message: str = "execution cancelled") -> None:
        super().__init__(FailureReason.CANCELLED, message, retryable=False, repairable=False)


class DeadlineExceededFailure(AgentError):
    kind = FailureKind.DEADLINE

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(FailureReason.DEADLINE_EXCEEDED, message, details=details)


class RunFailure(BaseModel):
    """Persisted projection of a failure, embedded in `Run` and returned by the API (Rule 19)."""

    model_config = ConfigDict(frozen=True)

    kind: FailureKind
    reason: FailureReason
    message: str
    retryable: bool
    details: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_error(cls, error: AgentError) -> RunFailure:
        return cls(
            kind=error.kind,
            reason=error.reason,
            message=error.message,
            retryable=error.retryable,
            details=error.details,
        )

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
