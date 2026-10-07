"""Scenarios: a deterministic, self-contained way to drive the agent.

A `Scenario` is the evaluation equivalent of a test fixture: the request, the exact model responses,
and (optionally) the tool executor. Nothing here reaches a real provider, so an evaluation is
reproducible and free to run (Rule 34).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.agents.request import AgentRequest
from app.infrastructure.models.fake import ScriptedResponse
from app.tools.base import ToolExecutor


@dataclass(frozen=True, slots=True)
class Scenario:
    case_id: str
    request: AgentRequest
    #: Exact model outputs, replayed in order (the fake is non-sticky, so the sequence is the script).
    responses: tuple[ScriptedResponse, ...] = ()
    tool_executor: ToolExecutor | None = None
    max_repairs: int | None = None
    timeout_seconds: float = 10.0


@dataclass(frozen=True, slots=True)
class Expectation:
    """What a successful scenario must produce. Every field is optional; unset means "not checked"."""

    response_contains: str | None = None
    response_not_contains: tuple[str, ...] = ()
    requires_proposal: bool = False
    proposal_name: str | None = None
    min_tool_calls: int = 0
    max_steps: int | None = None
