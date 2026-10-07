"""Bounded self-repair (Rule 23).

    generate → validate → invalid → repair → validate → … → accepted
                                        └──── attempts exhausted ────▶ ValidationFailure

The bound is the whole point. An LLM that is asked to fix its own invalid output will happily keep
producing invalid output; without a ceiling this becomes an infinite `LLM → validation → LLM` loop
that burns the run's deadline and hides the real defect. So the budget is explicit, every attempt is
observable, and exhausting it is a *classified* failure (`REPAIR_EXHAUSTED`) rather than a bare error.

`attempt` receives the previous failure so it can tell the model exactly what to fix, which is what
makes the second attempt usually succeed.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.domain.failures import (
    AgentError,
    FailureReason,
    ValidationFailure,
)

#: Rule 23's "2–3 attempts". Two repairs on top of the first attempt is the useful maximum: enough
#: for a schema mistake, not enough to paper over a model that fundamentally cannot comply.
DEFAULT_MAX_REPAIRS = 2

REPAIR_EVENT = "repair.attempted"


@dataclass(frozen=True, slots=True)
class RepairOutcome:
    """What the bounded loop produced."""

    value: object
    attempts: int
    repairs: int
    #: Failures from every rejected attempt, newest last. Kept for the `details` of the final
    #: failure so a defect can be diagnosed without re-running.
    failures: tuple[AgentError, ...]


async def repair(
    attempt: Callable[[AgentError | None], Awaitable[object]],
    *,
    max_repairs: int = DEFAULT_MAX_REPAIRS,
    emit=None,
) -> RepairOutcome:
    """Call `attempt` until it returns, re-invoking it with the last failure, at most `max_repairs`
    times.

    `attempt` signals invalid output by raising a `ValidationFailure`. Anything else propagates: a
    model timeout or a security failure is not something a retry can fix, so it must not be retried
    here.
    """
    failures: list[AgentError] = []
    last: AgentError | None = None

    for index in range(max_repairs + 1):
        try:
            value = await attempt(last)
        except ValidationFailure as failure:
            failures.append(failure)
            last = failure
            if emit is not None:
                await emit(
                    {
                        "attempt": index + 1,
                        "maxAttempts": max_repairs + 1,
                        "reason": str(failure.reason),
                        "message": failure.message,
                    }
                )
            continue
        return RepairOutcome(
            value=value,
            attempts=index + 1,
            repairs=index,
            failures=tuple(failures),
        )

    raise _exhausted(last, failures, max_repairs)


def _exhausted(last: AgentError | None, failures: list[AgentError], max_repairs: int) -> ValidationFailure:
    """Report *why* the output was rejected.

    With a repair budget of zero nothing was repaired, so the original reason is the honest answer.
    Otherwise the repair itself failed, which is a different — and more actionable — diagnosis than
    "the JSON was wrong".
    """
    if max_repairs == 0 and last is not None:
        return ValidationFailure(last.reason, last.message, details=last.details)
    return ValidationFailure(
        FailureReason.REPAIR_EXHAUSTED,
        last.message if last else "structured output was invalid",
        details={
            "attempts": max_repairs + 1,
            "failures": [f.to_dict() for f in failures],
        },
    )
