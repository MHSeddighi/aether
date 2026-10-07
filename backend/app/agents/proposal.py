"""Structured proposals: the bot-building and tool-building paths.

The frontend's chat has four modes (`web/src/types/agent.ts#ChatConversation#mode`). Three of them are
ordinary conversation; the other two ask the agent to *propose* a bot or a tool
(`BotProposal`/`ToolProposal`), which the user then confirms.

A proposal is generated, validated and repaired here:

    model → JSON → Pydantic schema → business constraints → repair (bounded) → `AgentResult`

Two validations, deliberately separate:

* **Schema** — `BotProposal`/`ToolProposal` reject wrong types, unknown shapes and missing fields.
  This is what `pydantic` is for.
* **Constraints** — a schema-valid proposal can still be nonsense: a bot that claims `temperature: 9`
  inside a valid float, a bot referencing a tool that does not exist, a tool whose handler is `http`
  with no URL. Those are the rules the schema cannot express, and they are where most bad AI output
  actually goes.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from app.agents.contracts import BotProposal, ToolProposal
from app.agents.repair import DEFAULT_MAX_REPAIRS, RepairOutcome, repair
from app.domain.conversations import ConversationMode
from app.domain.deadline import Deadline
from app.domain.failures import AgentError, FailureReason, ValidationFailure
from app.domain.models import ModelConfig, Provider
from app.infrastructure.logging_config import get_logger
from app.infrastructure.models.base import (
    ChatMessage,
    GenerationRequest,
    ModelCompletion,
    system_message,
    user_message,
)

logger = get_logger(__name__)

MAX_PROVIDER_TEMPERATURE = 2.0

BOT_SCHEMA_HINT = """
You are designing an assistant bot for a chat workspace. Reply with a single JSON object and nothing
else. Required keys: name (string), description (string), instructions (string), provider (one of
"openrouter", "opencode", "deepseek"), model_id (string), temperature (number 0..2), tool_ids (array
of strings), knowledge_ids (array of strings). Keep the instructions short, concrete and testable.
""".strip()

TOOL_SCHEMA_HINT = """
You are designing a tool for an AI agent. Reply with a single JSON object and nothing else. Required
keys: name (string), purpose (string), category (one of "search", "compute", "data", "api", "mcp"),
handler (one of "builtin", "http", "docker"), input_schema (JSON Schema object), output_schema (JSON
Schema object), permissions (array of strings).
""".strip()


def intent_for(mode: str | None) -> str:
    """Map the conversation mode onto what the agent should produce.

    Deterministic on purpose: the frontend already told us the mode, so paying a model call to guess
    it would be both slower and less reliable.
    """
    if mode in (ConversationMode.BOT_BUILDING, "bot-building"):
        return "build_bot"
    if mode in (ConversationMode.TOOL_BUILDING, "tool-building"):
        return "build_tool"
    return "chat"


class ProposalGenerator:
    """Asks the model for a structured proposal and validates it, with a bounded repair loop."""

    def __init__(self, client: ModelCompletion, *, max_repairs: int = DEFAULT_MAX_REPAIRS) -> None:
        self._client = client
        self._max_repairs = max_repairs

    async def bot_proposal(
        self,
        *,
        message: str,
        instructions: str,
        model: ModelConfig,
        deadline: Deadline,
        known_tool_ids: tuple[str, ...] = (),
        known_knowledge_ids: tuple[str, ...] = (),
        emit=None,
    ) -> RepairOutcome:
        return await self._generate(
            kind="bot",
            schema=BotProposal.model_json_schema(),
            messages=[
                system_message(BOT_SCHEMA_HINT),
                user_message(self._user_prompt(message, instructions)),
            ],
            model=model,
            deadline=deadline,
            validate=lambda payload: _validate_bot(
                payload, known_tool_ids=known_tool_ids, known_knowledge_ids=known_knowledge_ids
            ),
            emit=emit,
        )

    async def tool_proposal(
        self,
        *,
        message: str,
        instructions: str,
        model: ModelConfig,
        deadline: Deadline,
        emit=None,
    ) -> RepairOutcome:
        return await self._generate(
            kind="tool",
            schema=ToolProposal.model_json_schema(),
            messages=[
                system_message(TOOL_SCHEMA_HINT),
                user_message(self._user_prompt(message, instructions)),
            ],
            model=model,
            deadline=deadline,
            validate=_validate_tool,
            emit=emit,
        )

    # --- internals --------------------------------------------------------

    async def _generate(
        self,
        *,
        kind: str,
        schema: dict[str, Any],
        messages: list[ChatMessage],
        model: ModelConfig,
        deadline: Deadline,
        validate,
        emit,
    ) -> RepairOutcome:
        # A proposal is validated and then shown to a human, so it is generated deterministically:
        # the same request must always produce the same proposal.
        proposal_model = model.model_copy(update={"temperature": 0.0})

        async def attempt(last: AgentError | None):
            deadline.require(0.2, what=f"{kind} proposal")
            conversation = list(messages)
            if last is not None:
                # Show the model exactly what was wrong. This is what makes attempt two usually work.
                conversation.append(
                    user_message(
                        "That JSON was rejected: "
                        f"{last.message}\n"
                        "Return the corrected JSON object only, with no commentary."
                    )
                )
            completion = await self._client.complete(
                GenerationRequest(
                    model=proposal_model,
                    messages=tuple(conversation),
                    response_schema=schema,
                )
            )
            payload = _parse_json(completion.text)
            return validate(payload)

        return await repair(attempt, max_repairs=self._max_repairs, emit=emit)

    @staticmethod
    def _user_prompt(message: str, instructions: str) -> str:
        parts = [f"User request:\n{message.strip() or '(none)'}"]
        if instructions.strip():
            parts.append(f"Current bot instructions:\n{instructions.strip()}")
        return "\n\n".join(parts)


def _as_schema(model: type, payload: dict[str, Any]):
    """Turn a schema violation into a *classified* failure.

    Without this, a pydantic `ValidationError` would escape the bounded repair loop (which only
    retries `ValidationFailure`) and the run would fail with an unclassified error instead of giving
    the model a second chance — Rule 21/23 depend on the two being the same thing.
    """
    try:
        return model.model_validate(payload)
    except PydanticValidationError as exc:
        raise ValidationFailure(
            FailureReason.OUTPUT_SCHEMA,
            _schema_message(exc),
            details={"errors": exc.errors(include_url=False)[:5]},
        ) from exc


def _schema_message(exc: PydanticValidationError) -> str:
    """One line naming the offending fields. The repair prompt shows this to the model, so it has to
    be short and specific rather than a pydantic dump."""
    fields = sorted({".".join(str(p) for p in error["loc"]) or "payload" for error in exc.errors()})
    return f"the object failed validation for: {', '.join(fields)}"


def _parse_json(text: str) -> dict[str, Any]:
    """Model output is never trusted to be JSON, and never allowed to be fenced prose."""
    candidate = (text or "").strip()
    if candidate.startswith("```"):
        # Strip a markdown fence: models emit one even when told not to.
        lines = candidate.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        candidate = "\n".join(lines).strip()
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ValidationFailure(
            FailureReason.OUTPUT_SCHEMA,
            f"proposal is not valid JSON: {exc.msg}",
            details={"excerpt": candidate[:400]},
        ) from exc
    if not isinstance(payload, dict):
        raise ValidationFailure(
            FailureReason.OUTPUT_SCHEMA,
            "proposal must be a JSON object",
            details={"type": type(payload).__name__},
        )
    return payload


def _validate_bot(
    payload: dict[str, Any],
    *,
    known_tool_ids: tuple[str, ...] = (),
    known_knowledge_ids: tuple[str, ...] = (),
) -> BotProposal:
    """Schema, then the constraints a schema cannot express."""
    proposal = _as_schema(BotProposal, payload)

    if proposal.temperature > MAX_PROVIDER_TEMPERATURE:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"temperature must be at most {MAX_PROVIDER_TEMPERATURE}, got {proposal.temperature}",
            details={"field": "temperature", "value": proposal.temperature},
        )
    if proposal.bot_type == "simple" and proposal.deterministic_rules:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "a simple bot uses deterministic rules instead of a model; set bot_type 'agent'",
            details={"field": "bot_type"},
        )
    if proposal.bot_type == "simple" and proposal.provider != Provider.DETERMINISTIC.value:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "a simple bot must use the deterministic provider",
            details={"field": "provider", "value": proposal.provider},
        )
    unknown_tools = sorted(set(proposal.tool_ids) - set(known_tool_ids))
    if unknown_tools:
        # Better to propose nothing than to reference a tool the gateway will refuse at run time.
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"proposal references tools that do not exist: {unknown_tools}",
            details={"field": "tool_ids", "unknown": unknown_tools},
        )
    unknown_knowledge = sorted(set(proposal.knowledge_ids) - set(known_knowledge_ids))
    if unknown_knowledge:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"proposal references knowledge sources that do not exist: {unknown_knowledge}",
            details={"field": "knowledge_ids", "unknown": unknown_knowledge},
        )
    return proposal


def _validate_tool(payload: dict[str, Any]) -> ToolProposal:
    proposal = _as_schema(ToolProposal, payload)
    if proposal.handler == "http" and not (proposal.url or "").strip():
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "an http tool needs an endpoint url, or a different handler",
            details={"field": "url", "handler": proposal.handler},
        )
    if not proposal.input_schema:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "a tool must declare an input_schema so the gateway can validate arguments",
            details={"field": "input_schema"},
        )
    return proposal
