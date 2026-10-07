"""Deadline propagation (Rule 17).

One immutable value object carries the remaining execution budget through
workflow -> activity -> agent -> tool -> HTTP request, so a 30-second workflow budget can never
authorise a 60-second tool call.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.domain.failures import DeadlineExceededFailure

#: Never hand a downstream component less than this, otherwise the call cannot possibly finish.
MIN_REMAINING_SECONDS = 0.05


@dataclass(frozen=True, slots=True)
class Deadline:
    expires_at: datetime

    @classmethod
    def in_seconds(cls, seconds: float) -> Deadline:
        return cls(expires_at=datetime.now(UTC) + timedelta(seconds=seconds))

    @classmethod
    def at(cls, moment: datetime) -> Deadline:
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=UTC)
        return cls(expires_at=moment)

    @property
    def remaining_seconds(self) -> float:
        return (self.expires_at - datetime.now(UTC)).total_seconds()

    @property
    def expired(self) -> bool:
        return self.remaining_seconds <= 0

    def budget(self, requested_seconds: float) -> float:
        """Clamp a requested timeout to what is actually left."""
        return max(min(requested_seconds, self.remaining_seconds), MIN_REMAINING_SECONDS)

    def require(self, minimum_seconds: float, *, what: str = "execution") -> None:
        """Raise a classified failure when the budget cannot cover `minimum_seconds`."""
        if self.remaining_seconds < minimum_seconds:
            raise DeadlineExceededFailure(
                f"{what} needs {minimum_seconds:.2f}s but only "
                f"{max(self.remaining_seconds, 0.0):.2f}s remain",
                details={
                    "required_seconds": round(minimum_seconds, 3),
                    "remaining_seconds": round(max(self.remaining_seconds, 0.0), 3),
                },
            )
