"""The agent runner port (Dependency Inversion).

LangGraph, the deterministic rule matcher and any future executor all satisfy this one method, so
the workflow and activities never learn *how* a bot thinks (Rule 4).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol

from app.agents.contracts import AgentResult
from app.agents.request import AgentEvent, AgentRequest
from app.domain.deadline import Deadline

Emit = Callable[[AgentEvent], Awaitable[None]]


class AgentRunner(Protocol):
    async def run(self, request: AgentRequest, *, deadline: Deadline, emit: Emit) -> AgentResult:
        """Execute one turn and return a validated result.

        Implementations must honour `deadline`, emit progress through `emit`, and raise a classified
        `AgentError` (never a bare exception) so the failure taxonomy stays meaningful.
        """
        ...


def supports_tools(runner: AgentRunner) -> bool:
    """A runner that cannot call tools tells the activity to skip tool wiring entirely."""
    return getattr(runner, "supports_tools", True)
