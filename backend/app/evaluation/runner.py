"""Run one scenario through the real agent graph with a fake model.

This is the only shared mechanic behind the evaluators: build the production `LangGraphRunner`, feed
it the scenario's scripted responses, and return whatever it produced (or raised). The evaluators
above it only decide what "good" means.
"""

from __future__ import annotations

from app.agents.contracts import AgentResult
from app.agents.graph import LangGraphRunner
from app.agents.request import AgentEvent
from app.domain.deadline import Deadline
from app.evaluation.cases import Scenario
from app.infrastructure.models.fake import FakeModelClient


async def _ignore(_event: AgentEvent) -> None:
    return None


async def execute(scenario: Scenario) -> AgentResult:
    """Run the scenario and return its validated result. Raises the agent's classified failure."""
    client = FakeModelClient(sticky=False)
    for response in scenario.responses:
        client.queue(response)
    runner = LangGraphRunner(
        client,
        tool_executor=scenario.tool_executor,
        stream=False,
        max_repairs=scenario.max_repairs,
    )
    return await runner.run(
        scenario.request,
        deadline=Deadline.in_seconds(scenario.timeout_seconds),
        emit=_ignore,
    )
