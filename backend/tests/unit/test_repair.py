"""State 6 — bounded self-repair and the structured-proposal path.

The properties under test are the ones Rule 23 asks for and that an LLM cannot be trusted to provide
on its own:

* a valid proposal is accepted on the first attempt;
* an invalid one triggers a repair that is told *what* was wrong;
* the loop is bounded — exhausting the budget is a classified failure, never an infinite
  `LLM → validation → LLM` cycle;
* business constraints (not expressible in a schema) are enforced too;
* non-validation failures are never repaired, because a retry cannot fix them.
"""

from __future__ import annotations

import json

import pytest
from app.agents.contracts import AgentResult, BotProposal, ToolProposal
from app.agents.graph import LangGraphRunner
from app.agents.proposal import ProposalGenerator, intent_for
from app.agents.repair import DEFAULT_MAX_REPAIRS, repair
from app.agents.request import AgentEvent, AgentRequest
from app.domain.bots import BotType
from app.domain.deadline import Deadline
from app.domain.failures import (
    DeadlineExceededFailure,
    FailureReason,
    ModelFailure,
    SecurityFailure,
    ValidationFailure,
)
from app.domain.models import ModelConfig, Provider
from app.infrastructure.models.fake import FakeModelClient, ScriptedResponse

MODEL = ModelConfig(provider=Provider.OPENCODE, model_id="space-bunny-free")

GOOD_BOT = {
    "name": "Pricing Bot",
    "description": "Answers pricing questions",
    "instructions": "Answer pricing questions using the attached knowledge base.",
    "provider": "opencode",
    "model_id": "space-bunny-free",
    "temperature": 0.2,
    "tool_ids": [],
    "knowledge_ids": [],
}

GOOD_TOOL = {
    "name": "Web Search",
    "purpose": "Search the web",
    "category": "search",
    "handler": "builtin",
    "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}},
    "output_schema": {"type": "object"},
    "permissions": ["network"],
}


def request(**overrides) -> AgentRequest:
    payload = {
        "run_id": "run_1",
        "bot_id": "bot_1",
        "bot_version_id": "ver_1",
        "bot_version": "1.0.0",
        "bot_type": BotType.AGENT,
        "instructions": "",
        "message": "build me a pricing bot",
        "model": MODEL,
        "tools": (),
        "max_steps": 3,
    }
    payload.update(overrides)
    return AgentRequest(**payload)


class CollectingSink:
    def __init__(self) -> None:
        self.events: list[AgentEvent] = []

    async def __call__(self, event: AgentEvent) -> None:
        self.events.append(event)

    @property
    def types(self) -> list[str]:
        return [event.type for event in self.events]


# --- the bounded loop ----------------------------------------------------


class TestBoundedRepair:
    async def test_a_successful_attempt_is_returned_untouched(self) -> None:
        async def attempt(last):
            assert last is None
            return {"ok": True}

        outcome = await repair(attempt, max_repairs=2)
        assert outcome.value == {"ok": True}
        assert (outcome.attempts, outcome.repairs) == (1, 0)

    async def test_a_repairable_failure_is_retried_with_its_own_message(self) -> None:
        seen: list[str | None] = []

        async def attempt(last):
            seen.append(last.message if last else None)
            if len(seen) == 1:
                raise ValidationFailure(FailureReason.OUTPUT_SCHEMA, "missing name")
            return {"name": "fixed"}

        outcome = await repair(attempt, max_repairs=2)
        assert outcome.value == {"name": "fixed"}
        assert outcome.repairs == 1
        assert seen == [None, "missing name"], "the second attempt must know what was wrong"

    async def test_the_loop_is_bounded(self) -> None:
        """Without this, a model that cannot comply burns the run's deadline forever."""
        calls = 0

        async def attempt(_last):
            nonlocal calls
            calls += 1
            raise ValidationFailure(FailureReason.OUTPUT_SCHEMA, "still wrong")

        with pytest.raises(ValidationFailure) as excinfo:
            await repair(attempt, max_repairs=2)
        assert calls == 3, "one attempt plus exactly two repairs"
        assert excinfo.value.reason is FailureReason.REPAIR_EXHAUSTED
        assert excinfo.value.retryable is False, "a design problem, not a blip"

    async def test_exhaustion_reports_every_failure_it_saw(self) -> None:
        """The final failure carries the whole history, so a defect can be diagnosed without a re-run."""
        details: list = []

        async def recording(last):
            details.append(last)
            raise ValidationFailure(FailureReason.OUTPUT_CONSTRAINT, f"problem {len(details)}")

        with pytest.raises(ValidationFailure) as excinfo:
            await repair(recording, max_repairs=1)
        assert len(excinfo.value.details["failures"]) == 2
        assert excinfo.value.details["attempts"] == 2

    async def test_a_non_validation_failure_is_not_repaired(self) -> None:
        """A timeout or a security failure is not something another attempt can fix."""
        calls = 0

        async def attempt(_last):
            nonlocal calls
            calls += 1
            raise ModelFailure(FailureReason.MODEL_TIMEOUT, "provider timed out")

        with pytest.raises(ModelFailure):
            await repair(attempt, max_repairs=3)
        assert calls == 1

    async def test_security_failures_propagate_untouched(self) -> None:
        async def attempt(_last):
            raise SecurityFailure(FailureReason.UNSAFE_ARGUMENTS, "tried to shell out")

        with pytest.raises(SecurityFailure):
            await repair(attempt, max_repairs=3)

    async def test_each_rejected_attempt_is_reported(self) -> None:
        emitted: list[dict] = []

        async def emit(data: dict) -> None:
            emitted.append(data)

        async def attempt(_last):
            raise ValidationFailure(FailureReason.OUTPUT_SCHEMA, "nope")

        with pytest.raises(ValidationFailure):
            await repair(attempt, max_repairs=1, emit=emit)
        assert [e["attempt"] for e in emitted] == [1, 2]
        assert emitted[0]["maxAttempts"] == 2
        assert emitted[0]["reason"] == "output_schema"

    async def test_zero_repairs_means_exactly_one_attempt(self) -> None:
        calls = 0

        async def attempt(_last):
            nonlocal calls
            calls += 1
            raise ValidationFailure(FailureReason.OUTPUT_SCHEMA, "nope")

        with pytest.raises(ValidationFailure):
            await repair(attempt, max_repairs=0)
        assert calls == 1

    def test_the_default_budget_is_two_repairs(self) -> None:
        assert DEFAULT_MAX_REPAIRS == 2


# --- proposal generation --------------------------------------------------


class TestProposalGenerator:
    async def test_a_valid_bot_proposal_is_accepted_first_try(self) -> None:
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        generator = ProposalGenerator(fake)
        outcome = await generator.bot_proposal(
            message="pricing bot", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
        )
        assert isinstance(outcome.value, BotProposal)
        assert outcome.value.name == "Pricing Bot"
        assert outcome.repairs == 0

    async def test_fenced_json_is_accepted(self) -> None:
        """Models emit markdown fences even when told not to; that must not be a validation failure."""
        fenced = f"```json\n{json.dumps(GOOD_BOT)}\n```"
        fake = FakeModelClient().queue(ScriptedResponse(text=fenced))
        outcome = await ProposalGenerator(fake).bot_proposal(
            message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
        )
        assert outcome.value.name == "Pricing Bot"

    async def test_invalid_json_triggers_a_repair_that_can_succeed(self) -> None:
        fake = (
            FakeModelClient(sticky=False)
            .queue(ScriptedResponse(text="Sure! Here is your bot: {not json"))
            .queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        )
        outcome = await ProposalGenerator(fake).bot_proposal(
            message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
        )
        assert outcome.repairs == 1
        assert outcome.failures[0].reason is FailureReason.OUTPUT_SCHEMA

    async def test_the_repair_prompt_carries_the_rejection_reason(self) -> None:
        fake = (
            FakeModelClient(sticky=False)
            .queue(ScriptedResponse(text="not json"))
            .queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        )
        await ProposalGenerator(fake).bot_proposal(
            message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
        )
        repair_prompt = fake.requests[1].messages[-1].content
        assert "rejected" in repair_prompt and "JSON object only" in repair_prompt

    async def test_repair_budget_exhaustion_is_a_validation_failure(self) -> None:
        fake = FakeModelClient().queue(ScriptedResponse(text="not json"))
        with pytest.raises(ValidationFailure) as excinfo:
            await ProposalGenerator(fake, max_repairs=1).bot_proposal(
                message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
            )
        assert excinfo.value.reason is FailureReason.REPAIR_EXHAUSTED

    async def test_an_unknown_tool_is_reported_rather_than_fatal(self) -> None:
        """Naming a capability the workspace lacks is a legitimate thing to ask for.

        Rejecting it would send the repair prompt back to a model that will invent the same tool
        again, and the user would get no bot at all. So the id is dropped from the proposal and
        reported back, and the bot is built from what actually exists.
        """
        payload = {**GOOD_BOT, "tool_ids": ["tool-web-search", "order-status-lookup"]}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        outcome = await ProposalGenerator(fake, max_repairs=0).bot_proposal(
            message="x",
            instructions="",
            model=MODEL,
            deadline=Deadline.in_seconds(5),
            known_tool_ids=("tool-web-search",),
        )
        assert outcome.value.tool_ids == ["tool-web-search"]
        assert outcome.value.unattached_tools == ["order-status-lookup"]

    async def test_the_proposal_inherits_the_run_model(self) -> None:
        """A designer must not name a model id no provider serves.

        The model is the workspace's decision, so the proposal inherits whatever model is
        executing it — the one identity already proven to exist.
        """
        payload = {**GOOD_BOT, "provider": "openrouter", "model_id": "openai/gpt-3.5-turbo"}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        outcome = await ProposalGenerator(fake, max_repairs=0).bot_proposal(
            message="x",
            instructions="",
            model=MODEL,
            deadline=Deadline.in_seconds(5),
        )
        assert outcome.value.provider == str(MODEL.provider)
        assert outcome.value.model_id == MODEL.model_id

    async def test_an_unknown_knowledge_source_is_reported_rather_than_fatal(self) -> None:
        payload = {**GOOD_BOT, "knowledge_ids": ["faq", "missing-source"]}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        outcome = await ProposalGenerator(fake, max_repairs=0).bot_proposal(
            message="x",
            instructions="",
            model=MODEL,
            deadline=Deadline.in_seconds(5),
            known_knowledge_ids=("faq",),
        )
        assert outcome.value.knowledge_ids == ["faq"]
        assert outcome.value.unattached_knowledge == ["missing-source"]

    async def test_out_of_range_temperature_is_a_constraint_failure(self) -> None:
        payload = {**GOOD_BOT, "temperature": 9}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        with pytest.raises(ValidationFailure, match="temperature"):
            await ProposalGenerator(fake, max_repairs=0).bot_proposal(
                message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
            )

    async def test_a_simple_bot_must_be_deterministic(self) -> None:
        payload = {**GOOD_BOT, "bot_type": "simple", "provider": "opencode"}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        with pytest.raises(ValidationFailure, match="deterministic"):
            await ProposalGenerator(fake, max_repairs=0).bot_proposal(
                message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
            )

    async def test_an_http_tool_without_a_url_is_rejected(self) -> None:
        payload = {**GOOD_TOOL, "handler": "http", "url": None}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        with pytest.raises(ValidationFailure, match="url"):
            await ProposalGenerator(fake, max_repairs=0).tool_proposal(
                message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
            )

    async def test_an_http_tool_with_a_url_is_accepted(self) -> None:
        payload = {**GOOD_TOOL, "handler": "http", "url": "https://example.test/search"}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        outcome = await ProposalGenerator(fake).tool_proposal(
            message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
        )
        assert isinstance(outcome.value, ToolProposal)
        assert outcome.value.url == "https://example.test/search"

    async def test_a_tool_without_an_input_schema_is_rejected(self) -> None:
        payload = {**GOOD_TOOL, "input_schema": {}}
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(payload)))
        with pytest.raises(ValidationFailure, match="input_schema"):
            await ProposalGenerator(fake, max_repairs=0).tool_proposal(
                message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
            )

    async def test_proposals_are_generated_deterministically(self) -> None:
        """A proposal is shown to a human and then applied, so the same request must give the same
        answer."""
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        await ProposalGenerator(fake).bot_proposal(
            message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
        )
        assert fake.requests[0].model.temperature == 0.0

    async def test_an_expired_deadline_stops_the_attempt_before_calling_the_model(self) -> None:
        fake = FakeModelClient().queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        with pytest.raises(DeadlineExceededFailure):
            await ProposalGenerator(fake).bot_proposal(
                message="x",
                instructions="",
                model=MODEL,
                deadline=Deadline.in_seconds(0),
            )
        assert fake.requests == [], "a call that cannot finish must not be made"

    async def test_a_json_array_is_not_a_proposal(self) -> None:
        fake = FakeModelClient().queue(ScriptedResponse(text="[1, 2, 3]"))
        with pytest.raises(ValidationFailure, match="JSON object"):
            await ProposalGenerator(fake, max_repairs=0).bot_proposal(
                message="x", instructions="", model=MODEL, deadline=Deadline.in_seconds(5)
            )


class TestIntentMapping:
    @pytest.mark.parametrize(
        ("mode", "expected"),
        [
            ("bot-building", "build_bot"),
            ("tool-building", "build_tool"),
            ("agent-bot", "chat"),
            ("simple-bot", "chat"),
            (None, "chat"),
            ("", "chat"),
        ],
    )
    def test_mode_decides_the_intent(self, mode, expected) -> None:
        assert intent_for(mode) == expected


# --- the graph -----------------------------------------------------------


class TestProposalGraphPath:
    async def test_build_bot_produces_a_validated_proposal(self) -> None:
        fake = FakeModelClient(
            stream_deltas=[["I will design that."]],
        ).queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        runner = LangGraphRunner(fake, stream=True)
        sink = CollectingSink()
        result = await runner.run(
            request(intent="build_bot"),
            deadline=Deadline.in_seconds(10),
            emit=sink,
        )
        assert isinstance(result, AgentResult)
        assert result.bot_proposal is not None
        assert result.bot_proposal.name == "Pricing Bot"
        assert result.tool_proposal is None
        assert result.repairs == 0

    async def test_build_tool_produces_a_tool_proposal(self) -> None:
        fake = (
            FakeModelClient(stream_deltas=[["Designing the tool."]], sticky=False)
            .queue(ScriptedResponse(text="Designing the tool."))
            .queue(ScriptedResponse(text=json.dumps(GOOD_TOOL)))
        )
        runner = LangGraphRunner(fake, stream=True)
        result = await runner.run(
            request(intent="build_tool"), deadline=Deadline.in_seconds(10), emit=CollectingSink()
        )
        assert result.tool_proposal is not None
        assert result.tool_proposal.name == "Web Search"
        assert result.bot_proposal is None

    async def test_chat_mode_does_not_propose(self) -> None:
        """Paying for a proposal call on an ordinary question would be a waste of a model turn."""
        fake = FakeModelClient(stream_deltas=[["Just an answer."]])
        runner = LangGraphRunner(fake, stream=True)
        result = await runner.run(
            request(intent="chat"), deadline=Deadline.in_seconds(10), emit=CollectingSink()
        )
        assert result.bot_proposal is None and result.tool_proposal is None
        assert result.response == "Just an answer."

    async def test_a_failed_repair_fails_the_run_with_a_classification(self) -> None:
        fake = (
            FakeModelClient(stream_deltas=[["Designing."]], sticky=False)
            .queue(ScriptedResponse(text="Designing."))
            .queue(ScriptedResponse(text="definitely not json"))
        )
        runner = LangGraphRunner(fake, stream=True, max_repairs=1)
        with pytest.raises(ValidationFailure) as excinfo:
            await runner.run(
                request(intent="build_bot"), deadline=Deadline.in_seconds(10), emit=CollectingSink()
            )
        assert excinfo.value.reason is FailureReason.REPAIR_EXHAUSTED
        assert excinfo.value.retryable is False

    async def test_the_proposal_is_repaired_once_and_reported(self) -> None:
        # Three responses: the reasoning step, then the proposal's first (rejected) attempt and its
        # repair. A sticky fake would hand the proposal the answer meant for the chat step.
        fake = (
            FakeModelClient(stream_deltas=[["Designing."]], sticky=False)
            .queue(ScriptedResponse(text="Designing."))
            .queue(ScriptedResponse(text="not json"))
            .queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        )
        runner = LangGraphRunner(fake, stream=True)
        result = await runner.run(
            request(intent="build_bot"), deadline=Deadline.in_seconds(10), emit=CollectingSink()
        )
        assert result.repairs == 1
        assert result.bot_proposal is not None

    async def test_the_bubble_gets_text_even_though_the_answer_is_a_card(self) -> None:
        fake = (
            FakeModelClient(stream_deltas=[[]], sticky=False)
            .queue(ScriptedResponse(text=""))
            .queue(ScriptedResponse(text=json.dumps(GOOD_BOT)))
        )
        runner = LangGraphRunner(fake, stream=True)
        result = await runner.run(
            request(intent="build_bot"), deadline=Deadline.in_seconds(10), emit=CollectingSink()
        )
        assert "Pricing Bot" in result.response
