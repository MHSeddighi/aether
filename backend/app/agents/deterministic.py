"""Deterministic runner for `bot_type='simple'` bots.

These bots must never touch a model (the frontend advertises 0 ms latency and zero token cost), so
they are executed by plain rule matching inside the same activity boundary as LLM bots. The run still
goes through Temporal, so the lifecycle, events and cancellation are identical.
"""

from __future__ import annotations

from app.agents.contracts import AgentResult
from app.agents.request import AgentEvent, AgentRequest
from app.domain.bots import BotType
from app.domain.deadline import Deadline
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.models import Provider

STEP_STARTED = "agent.step.started"
COMPLETED = "agent.completed"

DEFAULT_RESPONSE = (
    "[Deterministic Execution (No LLM)]\n"
    "Processed input without a model call. Zero latency rule execution complete."
)


class DeterministicRunner:
    """Rule matcher. Supports tools = False so the activity never provisions a tool gateway."""

    supports_tools = False

    async def run(self, request: AgentRequest, *, deadline: Deadline, emit) -> AgentResult:
        deadline.require(0.1, what="deterministic execution")
        if request.bot_type is not BotType.SIMPLE:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                "DeterministicRunner only serves bots of type 'simple'",
                details={"bot_id": request.bot_id, "bot_type": str(request.bot_type)},
            )
        if request.model.provider is not Provider.DETERMINISTIC:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                "simple bots must carry the deterministic model configuration",
                details={"provider": str(request.model.provider)},
            )

        await emit(AgentEvent(type=STEP_STARTED, data={"step": "rules", "tools": []}))
        rule = _match(request.message, request.deterministic_rules)
        if rule is not None:
            response = f'[Deterministic Rule Match: "{rule["trigger"]}"]\n{rule["response"]}'
        else:
            response = f'{DEFAULT_RESPONSE}\nProcessed input: "{request.message.strip()[:200]}"'

        await emit(AgentEvent(type=COMPLETED, data={"steps": 1}))
        return AgentResult(response=response, steps=1)


def _match(message: str, rules: tuple[dict[str, str], ...]) -> dict[str, str] | None:
    lowered = message.lower()
    for rule in rules:
        trigger = str(rule.get("trigger", "")).strip().lower()
        if trigger and trigger in lowered:
            return rule
    return None
