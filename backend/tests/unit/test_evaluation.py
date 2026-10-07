"""State 11 — deterministic evaluators.

The evaluators judge the real agent and the real Tool Gateway with fake models, so these tests assert
both that the evaluators work *and* that the invariants they exist to protect actually hold.
"""

from __future__ import annotations

import json
from typing import Any

from app.agents.request import AgentRequest, ToolSpec
from app.domain.bots import BotType
from app.domain.failures import FailureReason
from app.domain.models import ModelConfig, Provider
from app.domain.tools import ToolPermission
from app.evaluation import (
    Check,
    EvalResult,
    Expectation,
    FailureEvaluator,
    OutputEvaluator,
    RegressionEvaluator,
    Scenario,
    SecurityEvaluator,
)
from app.infrastructure.models.base import ToolCall
from app.infrastructure.models.fake import ScriptedResponse
from app.tools.base import ToolExecutor, ToolOutcome

MODEL = ModelConfig(provider=Provider.OPENCODE, model_id="fake-model")

GOOD_BOT = {
    "name": "Pricing Bot",
    "description": "Answers pricing questions",
    "instructions": "Answer using the knowledge base.",
    "provider": "opencode",
    "model_id": "fake-model",
    "temperature": 0.2,
    "tool_ids": [],
    "knowledge_ids": [],
}


def request(*, message: str = "hello", **overrides: Any) -> AgentRequest:
    payload: dict[str, Any] = {
        "run_id": "run_1",
        "bot_id": "bot_1",
        "bot_version_id": "ver_1",
        "bot_version": "1.0.0",
        "bot_type": BotType.AGENT,
        "instructions": "",
        "message": message,
        "model": MODEL,
    }
    payload.update(overrides)
    return AgentRequest(**payload)


class ScriptedExecutor(ToolExecutor):
    def __init__(self, outcome: ToolOutcome | None = None) -> None:
        self.calls: list[str] = []
        self._outcome = outcome

    async def execute(self, *, tool_id, name, arguments, deadline, idempotency_key, tool=None):
        self.calls.append(name)
        return self._outcome or ToolOutcome(tool_id=tool_id, name=name, ok=True, output={"ok": True})


# --- result type ----------------------------------------------------------


class TestEvalResult:
    def test_a_result_is_passing_when_every_check_passes(self) -> None:
        result = EvalResult("c", (Check("a", True), Check("b", True)))
        assert result.passed and result.failures == ()

    def test_a_result_names_the_failed_check(self) -> None:
        result = EvalResult("c", (Check("a", True), Check("b", False, "nope")))
        assert not result.passed
        assert [check.name for check in result.failures] == ["b"]
        assert "FAIL" in str(result)


# --- output evaluator -----------------------------------------------------


class TestOutputEvaluator:
    async def test_a_successful_chat_run_passes(self) -> None:
        scenario = Scenario("chat", request(), responses=(ScriptedResponse(text="Hello there"),))
        result = await OutputEvaluator().evaluate(
            scenario, Expectation(response_contains="Hello", max_steps=1)
        )
        assert result.passed, str(result)

    async def test_a_missing_expected_substring_fails(self) -> None:
        scenario = Scenario("chat", request(), responses=(ScriptedResponse(text="Hello"),))
        result = await OutputEvaluator().evaluate(scenario, Expectation(response_contains="goodbye"))
        assert not result.passed
        assert "response.contains" in [check.name for check in result.failures]

    async def test_a_proposal_is_recognised(self) -> None:
        scenario = Scenario(
            "build-bot",
            request(message="build me a bot", intent="build_bot"),
            responses=(
                ScriptedResponse(text="Let me design that."),
                ScriptedResponse(text=json.dumps(GOOD_BOT)),
            ),
        )
        result = await OutputEvaluator().evaluate(
            scenario, Expectation(requires_proposal=True, proposal_name="Pricing Bot")
        )
        assert result.passed, str(result)

    async def test_a_missing_proposal_fails(self) -> None:
        scenario = Scenario("chat", request(), responses=(ScriptedResponse(text="no proposal"),))
        result = await OutputEvaluator().evaluate(scenario, Expectation(requires_proposal=True))
        assert not result.passed

    async def test_tool_calls_are_counted(self) -> None:
        executor = ScriptedExecutor()
        scenario = Scenario(
            "tools",
            request(tools=(_search_spec(),)),
            responses=(
                ScriptedResponse(
                    tool_calls=(ToolCall(id="c1", name="tool_web_search", arguments={"query": "x"}),),
                    finish_reason="tool_calls",
                ),
                ScriptedResponse(text="done"),
            ),
            tool_executor=executor,
        )
        result = await OutputEvaluator().evaluate(scenario, Expectation(min_tool_calls=1))
        assert result.passed, str(result)
        assert executor.calls == ["tool_web_search"]

    async def test_forbidden_content_fails(self) -> None:
        scenario = Scenario("leak", request(), responses=(ScriptedResponse(text="the secret is 42"),))
        result = await OutputEvaluator().evaluate(scenario, Expectation(response_not_contains=("secret",)))
        assert not result.passed


# --- failure evaluator ----------------------------------------------------


class TestFailureEvaluator:
    async def test_a_model_timeout_is_a_retryable_model_failure(self) -> None:
        result = await FailureEvaluator().model_failure("timeout", request(), FailureReason.MODEL_TIMEOUT)
        assert result.passed, str(result)

    async def test_a_rate_limit_is_retryable(self) -> None:
        result = await FailureEvaluator().model_failure("rate", request(), FailureReason.MODEL_RATE_LIMITED)
        assert result.passed, str(result)

    async def test_a_malformed_proposal_exhausts_the_repair_budget(self) -> None:
        result = await FailureEvaluator().malformed_proposal(
            "bad-json", request(message="build", intent="build_bot")
        )
        assert result.passed, str(result)

    async def test_a_tool_timeout_is_a_retryable_tool_failure(self) -> None:
        assert (await FailureEvaluator().tool_timeout("tt")).passed

    async def test_a_tool_crash_is_a_retryable_tool_failure(self) -> None:
        assert (await FailureEvaluator().tool_failure("tf")).passed

    async def test_malformed_tool_output_is_rejected(self) -> None:
        assert (await FailureEvaluator().tool_invalid_output("tio")).passed


# --- security evaluator ---------------------------------------------------


class TestSecurityEvaluator:
    async def test_an_unauthorized_tool_is_refused(self) -> None:
        assert (await SecurityEvaluator().unauthorized_tool("unauth")).passed

    async def test_a_bot_with_no_tools_refuses_everything(self) -> None:
        assert (await SecurityEvaluator().no_tools_configured("none")).passed

    async def test_unsafe_tool_arguments_are_refused(self) -> None:
        assert (await SecurityEvaluator().unsafe_tool_arguments("unsafe")).passed

    async def test_prompt_injection_cannot_invoke_a_forbidden_tool(self) -> None:
        assert (await SecurityEvaluator().prompt_injection_cannot_call_a_forbidden_tool("inject")).passed

    def test_generated_code_cannot_escape_the_sandbox(self) -> None:
        assert SecurityEvaluator().sandbox_boundary("sandbox").passed


# --- regression evaluator -------------------------------------------------


class TestRegressionEvaluator:
    async def test_the_same_case_runs_across_two_bot_versions(self) -> None:
        cases = [
            (
                Scenario(
                    "v1",
                    request(bot_version="1.0.0"),
                    responses=(ScriptedResponse(text="answer v1"),),
                ),
                Expectation(response_contains="answer"),
            ),
            (
                Scenario(
                    "v2",
                    request(bot_version="2.0.0"),
                    responses=(ScriptedResponse(text="answer v2"),),
                ),
                Expectation(response_contains="answer"),
            ),
        ]
        grouped = await RegressionEvaluator().across_versions(cases)
        assert set(grouped) == {"1.0.0", "2.0.0"}
        assert all(result.passed for results in grouped.values() for result in results)


# --- helpers --------------------------------------------------------------


def _search_spec() -> ToolSpec:
    return ToolSpec(
        tool_id="tool-web-search",
        name="Web Search",
        description="Search the web",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
        permissions=(ToolPermission.NETWORK,),
    )
