"""Deterministic evaluation results.

An evaluation is a list of named checks, not a score. A score hides *which* invariant broke; a failed
check names it. That is all the MVP needs (Rule 34: focused evaluators, deterministic assertions,
LLM-as-judge only when nothing else works).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Check:
    name: str
    passed: bool
    detail: str = ""


@dataclass(frozen=True, slots=True)
class EvalResult:
    case_id: str
    checks: tuple[Check, ...] = field(default_factory=tuple)

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)

    @property
    def failures(self) -> tuple[Check, ...]:
        return tuple(check for check in self.checks if not check.passed)

    def __str__(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        failed = ", ".join(check.name for check in self.failures) or "none"
        return f"[{status}] {self.case_id} ({len(self.checks)} checks, failed: {failed})"
