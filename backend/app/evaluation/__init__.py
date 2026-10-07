"""Lightweight, deterministic evaluation layer (State 11).

Not a platform: four focused evaluators and the tiny result/scenario types they share. Import what
you need, e.g.:

    from app.evaluation import FailureEvaluator, OutputEvaluator, SecurityEvaluator
"""

from app.evaluation.cases import Expectation, Scenario
from app.evaluation.evaluators import (
    FailureEvaluator,
    OutputEvaluator,
    RegressionEvaluator,
    SecurityEvaluator,
)
from app.evaluation.results import Check, EvalResult
from app.evaluation.runner import execute

__all__ = [
    "Check",
    "EvalResult",
    "Expectation",
    "FailureEvaluator",
    "OutputEvaluator",
    "RegressionEvaluator",
    "Scenario",
    "SecurityEvaluator",
    "execute",
]
