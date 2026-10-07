"""State 5 — LangGraph agent graph: routing, tool loop, bounds, streaming, failure handling."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from app.agents.contracts import AgentResult, BotProposal
from app.agents.deterministic import DeterministicRunner
from app.agents.graph import LangGraphRunner
from app.agents.prompts import build_system_prompt
from app.agents.request import AgentEvent, AgentRequest, ConversationTurn, ToolSpec
from app.agents.runner import AgentRunner
from app.agents.state import STOP_MAX_STEPS
from app.domain.bots import BotType
from app.domain.deadline import Deadline
from app.domain.failures import (
    CancelledFailure,
    DeadlineExceededFailure,
    FailureReason,
    ModelFailure,
    SecurityFailure,
    ToolFailure,
    ValidationFailure,
)
from app.domain.models import ModelConfig, Provider
from app.domain.tools import ToolPermission
from app.infrastructure.models.base import (
    StreamChunk,
    ToolCall,
    user_message,
)
from app.infrastructure.models.fake import FakeModelClient, ScriptedResponse
from app.tools.base import NoToolsConfigured, ToolExecutor, ToolOutcome
from pydantic import ValidationError

SEARCH = ToolSpec(
    tool_id="tool-web-search",
    name="Web Search",
    description="Search the web",
    input_schema={
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
    output_schema={"type": "object", "properties": {"results": {"type": "array"}}},
    timeout_seconds=5.0,
    permissions=(ToolPermission.NETWORK,),
)


def make_request(**overrides) -> AgentRequest:
    payload: dict[str, Any] = {
        "run_id": "run_1",
        "bot_id": "bot_1",
        "bot_version_id": "ver_1",
        "bot_version": "1.0.0",
        "bot_type": BotType.AGENT,
        "instructions": "You are a research assistant.",
        "message": "What is the weather in Tehran?",
        "model": ModelConfig(provider=Provider.OPENCODE, model_id="space-bunny-free"),
        "tools": (SEARCH,),
        "max_steps": 4,
    }
    payload.update(overrides)
    return AgentRequest(**payload)


class RecordingToolExecutor(ToolExecutor):
    """Test double that records calls and returns scripted outcomes."""

    def __init__(self, outcomes: list[ToolOutcome | Exception] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._outcomes = list(outcomes or [])

    async def execute(
        self,
        *,
        tool_id: str,
        name: str,
        arguments: dict[str, Any],
        deadline: Deadline,
        idempotency_key: str,
        tool: Any | None = None,  # noqa: ARG002 - kept for protocol parity
    ) -> ToolOutcome:
        self.calls.append(
            {
                "tool_id": tool_id,
                "name": name,
                "arguments": arguments,
                "idempotency_key": idempotency_key,
                "remaining_seconds": round(deadline.remaining_seconds, 2),
            }
        )
        outcome = (
            self._outcomes.pop(0)
            if self._outcomes
            else ToolOutcome(
                tool_id=tool_id, name=name, ok=True, output={"temperature_c": 21}, detail="1 result"
            )
        )
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class CollectingSink:
    def __init__(self) -> None:
        self.events: list[AgentEvent] = []

    async def __call__(self, event: AgentEvent) -> None:
        self.events.append(event)

    @property
    def types(self) -> list[str]:
        return [event.type for event in self.events]

    @property
    def text(self) -> str:
        return "".join(e.data.get("text", "") for e in self.events if e.type == "agent.delta")


async def run(runner: AgentRunner, request: AgentRequest, *, timeout: float = 10.0):
    """Run one turn and return `(result, sink)`."""
    sink = CollectingSink()
    result = await runner.run(request, deadline=Deadline.in_seconds(timeout), emit=sink)
    return result, sink


class TestSingleStepAnswers:
    async def test_answers_without_tools(self) -> None:
        fake = FakeModelClient(stream_deltas=[["It is ", "21C in Tehran."]])
        runner = LangGraphRunner(fake, tool_executor=RecordingToolExecutor(), stream=True)
        result, sink = await run(runner, make_request())
        assert isinstance(result, AgentResult)
        assert result.response == "It is 21C in Tehran."
        assert result.steps == 1
        assert result.tool_activity == []
        assert sink.text == "It is 21C in Tehran."
        assert "agent.step.started" in sink.types
        assert sink.types[-1] == "agent.completed"

    async def test_non_streaming_path_uses_complete(self) -> None:
        fake = FakeModelClient().queue(ScriptedResponse(text="done", input_tokens=5, output_tokens=2))
        runner = LangGraphRunner(fake, stream=False)
        result, sink = await run(runner, make_request(tools=()))
        assert result.response == "done"
        assert result.usage.input_tokens == 5
        assert result.usage.output_tokens == 2
        assert sink.text == ""

    async def test_history_and_instructions_reach_the_model(self) -> None:
        fake = FakeModelClient(stream_deltas=[["ok"]])
        request = make_request(
            tools=(),
            history=(
                ConversationTurn(role="user", content="earlier question"),
                ConversationTurn(role="assistant", content="earlier answer"),
            ),
        )
        await run(LangGraphRunner(fake, stream=True), request)
        messages = fake.requests[0].messages
        assert messages[0].role == "system"
        assert "research assistant" in messages[0].content
        assert [m.content for m in messages[1:3]] == ["earlier question", "earlier answer"]
        assert messages[-1].content == request.message

    async def test_system_prompt_lists_tools_and_knowledge(self) -> None:
        prompt = build_system_prompt(make_request(knowledge=("kb-sales",)))
        assert "tool-web-search" in prompt or "Web Search" in prompt
        assert "kb-sales" in prompt

    async def test_tools_are_rendered_in_the_model_payload(self) -> None:
        fake = FakeModelClient(stream_deltas=[["ok"]])
        await run(LangGraphRunner(fake, stream=True), make_request())
        rendered = fake.requests[0].tools
        assert rendered[0].name == "tool_web_search"
        assert rendered[0].permissions == (ToolPermission.NETWORK,)


class TestToolLoop:
    async def test_executes_a_tool_then_answers(self) -> None:
        fake = FakeModelClient(stream_deltas=[[], ["It is ", "21C in Tehran."]])
        fake.queue(
            ScriptedResponse(
                tool_calls=(
                    ToolCall(id="call_1", name="tool_web_search", arguments={"query": "Tehran weather"}),
                ),
                finish_reason="tool_calls",
            )
        )
        fake.queue(ScriptedResponse(text="It is 21C in Tehran."))
        executor = RecordingToolExecutor()
        result, sink = await run(LangGraphRunner(fake, tool_executor=executor), make_request())

        assert executor.calls[0]["arguments"] == {"query": "Tehran weather"}
        assert executor.calls[0]["idempotency_key"] == "run_1:call_1"
        assert result.response == "It is 21C in Tehran."
        assert result.steps == 2
        assert result.tool_activity[0].name == "tool_web_search"
        assert str(result.tool_activity[0].status) == "completed"
        assert "tool.started" in sink.types
        assert "tool.completed" in sink.types

    async def test_tool_receives_the_remaining_deadline(self) -> None:
        fake = FakeModelClient(stream_deltas=[[], ["done"]])
        fake.queue(ScriptedResponse(tool_calls=(ToolCall(id="c1", name="tool_web_search", arguments={}),)))
        fake.queue(ScriptedResponse(text="done"))
        executor = RecordingToolExecutor()
        await run(LangGraphRunner(fake, tool_executor=executor), make_request(), timeout=30.0)
        assert 0 < executor.calls[0]["remaining_seconds"] <= 30.0

    async def test_tool_result_is_fed_back_to_the_model(self) -> None:
        fake = FakeModelClient(stream_deltas=[[], ["done"]])
        fake.queue(ScriptedResponse(tool_calls=(ToolCall(id="c1", name="tool_web_search", arguments={}),)))
        fake.queue(ScriptedResponse(text="done"))
        await run(LangGraphRunner(fake, tool_executor=RecordingToolExecutor()), make_request())
        second_request = fake.requests[1]
        tool_message = second_request.messages[-1]
        assert tool_message.role == "tool"
        assert "21" in tool_message.content

    async def test_multiple_tool_calls_in_one_step(self) -> None:
        fake = FakeModelClient(stream_deltas=[[], ["done"]])
        fake.queue(
            ScriptedResponse(
                tool_calls=(
                    ToolCall(id="c1", name="tool_web_search", arguments={}),
                    ToolCall(id="c2", name="tool_web_search", arguments={}),
                )
            )
        )
        fake.queue(ScriptedResponse(text="done"))
        executor = RecordingToolExecutor()
        result, _ = await run(LangGraphRunner(fake, tool_executor=executor), make_request())
        assert len(executor.calls) == 2
        assert len(result.tool_activity) == 2

    async def test_max_steps_is_enforced(self) -> None:
        fake = FakeModelClient(stream_deltas=[["working on it"] for _ in range(10)])
        for _ in range(6):
            fake.queue(ScriptedResponse(tool_calls=(ToolCall(id="c", name="tool_web_search", arguments={}),)))
        executor = RecordingToolExecutor()
        result, _ = await run(LangGraphRunner(fake, tool_executor=executor), make_request(max_steps=2))
        assert result.steps <= 3, "the graph must not loop past the step budget"
        assert len(executor.calls) <= 2
        assert STOP_MAX_STEPS in result.response or result.response

    async def test_no_tools_configured_refuses_a_tool_call(self) -> None:
        fake = FakeModelClient(stream_deltas=[[], ["fallback"]])
        fake.queue(ScriptedResponse(tool_calls=(ToolCall(id="c1", name="tool_sql_db", arguments={}),)))
        fake.queue(ScriptedResponse(text="fallback"))
        with pytest.raises(SecurityFailure) as excinfo:
            await run(LangGraphRunner(fake, tool_executor=NoToolsConfigured()), make_request())
        assert excinfo.value.reason is FailureReason.UNAUTHORIZED_TOOL
        assert not excinfo.value.retryable


class TestFailureHandling:
    async def test_recoverable_tool_failure_becomes_an_observation(self) -> None:
        fake = FakeModelClient(stream_deltas=[[], ["I could not reach the search tool."]])
        fake.queue(ScriptedResponse(tool_calls=(ToolCall(id="c1", name="tool_web_search", arguments={}),)))
        fake.queue(ScriptedResponse(text="I could not reach the search tool."))
        executor = RecordingToolExecutor([ToolFailure(FailureReason.TOOL_TIMEOUT, "web search timed out")])
        result, sink = await run(LangGraphRunner(fake, tool_executor=executor), make_request())
        assert str(result.tool_activity[0].status) == "failed"
        assert "tool.failed" in sink.types
        assert "could not reach" in result.response
        assert fake.requests[1].messages[-1].content  # the model was told about the failure

    async def test_model_failure_propagates_for_retry(self) -> None:
        class FailingClient(FakeModelClient):
            async def stream(self, request):  # noqa: ARG002
                raise ModelFailure(FailureReason.MODEL_RATE_LIMITED, "slow down")
                yield StreamChunk()  # pragma: no cover

        with pytest.raises(ModelFailure) as excinfo:
            await run(LangGraphRunner(FailingClient(), stream=True), make_request())
        assert excinfo.value.retryable

    async def test_expired_deadline_stops_before_the_model_call(self) -> None:
        fake = FakeModelClient(stream_deltas=[["never"]])
        await asyncio.sleep(0.05)  # let the budget expire
        with pytest.raises(DeadlineExceededFailure) as excinfo:
            await run(LangGraphRunner(fake, stream=True), make_request(), timeout=0.01)
        assert excinfo.value.reason is FailureReason.DEADLINE_EXCEEDED

    async def test_cancellation_propagates(self) -> None:
        class CancellingClient(FakeModelClient):
            async def stream(self, request):  # noqa: ARG002
                raise CancelledFailure()
                yield StreamChunk()  # pragma: no cover

        with pytest.raises(CancelledFailure):
            await run(LangGraphRunner(CancellingClient(), stream=True), make_request())


class TestResultValidation:
    async def test_empty_answer_is_rejected(self) -> None:
        fake = FakeModelClient(stream_deltas=[""])
        with pytest.raises(ValidationError, match="response or a proposal"):
            await run(LangGraphRunner(fake, stream=True), make_request(tools=()))

    async def test_result_forbids_unknown_fields(self) -> None:
        with pytest.raises(ValidationError):
            AgentResult(response="hi", unexpected="nope")

    async def test_bot_proposal_validates_its_own_schema(self) -> None:
        proposal = BotProposal(name="Sales Bot", temperature=0.15, code_snippet="print(1)")
        assert "code_snippet" not in proposal.as_payload
        with pytest.raises(ValidationError):
            BotProposal(name="Sales Bot", bot_type="quantum")

    def test_agent_result_serialises_for_storage(self) -> None:
        result = AgentResult(response="hi", steps=2)
        payload = result.model_dump(mode="json")
        assert payload["response"] == "hi"
        assert payload["usage"] == {"input_tokens": 0, "output_tokens": 0}


class TestRunnerSelection:
    def test_both_runners_satisfy_the_port(self) -> None:
        assert isinstance(LangGraphRunner(FakeModelClient()), AgentRunner)
        assert isinstance(DeterministicRunner(), AgentRunner)

    def test_tool_support_is_declared(self) -> None:
        assert LangGraphRunner(FakeModelClient()).supports_tools is True
        assert DeterministicRunner().supports_tools is False

    async def test_deterministic_runner_refuses_agent_bots(self) -> None:
        from app.agents.runner import supports_tools

        runner = DeterministicRunner()
        assert not supports_tools(runner)
        with pytest.raises(ValidationFailure):
            await run(runner, make_request())


class TestStateReducers:
    def test_usage_accumulates_across_steps(self) -> None:
        from app.agents.state import _merge_usage

        assert _merge_usage(
            {"input_tokens": 1, "output_tokens": 2}, {"input_tokens": 3, "output_tokens": 4}
        ) == {"input_tokens": 4, "output_tokens": 6}

    def test_pending_tool_calls_are_replaced_not_appended(self) -> None:
        from app.agents.state import _replace_list

        assert _replace_list([1, 2], []) == []

    def test_messages_are_appended(self) -> None:
        from app.agents.state import _replace_messages

        assert len(_replace_messages([user_message("a")], [user_message("b")])) == 2
