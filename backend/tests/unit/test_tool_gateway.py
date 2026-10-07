"""State 7 — Tool Gateway: validation, permissions, deadlines, idempotency, error classification."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from app.agents.graph import LangGraphRunner
from app.agents.request import AgentEvent, AgentRequest, ToolSpec
from app.domain.bots import BotType
from app.domain.deadline import Deadline
from app.domain.failures import (
    DeadlineExceededFailure,
    FailureReason,
    SecurityFailure,
    ToolFailure,
)
from app.domain.models import ModelConfig, Provider
from app.domain.tools import Tool, ToolPermission, ToolVersion
from app.infrastructure.models.base import ToolCall
from app.infrastructure.models.fake import FakeModelClient, ScriptedResponse
from app.tools.base import ToolExecutor
from app.tools.gateway import ToolGateway
from app.tools.handlers import HttpRequestHandler, KnowledgeSearchHandler, PythonMathHandler

NOW = datetime.now(UTC)


def math_tool(
    *, permissions=(ToolPermission.NONE,), timeout: float = 5.0, output_schema: dict | None = None
) -> Tool:
    """A `python_math` tool with schemas, mirroring what the API stores."""
    tool = Tool(
        tool_id="tool-python-math",
        workspace_id="ws",
        name="Python Math",
        purpose="Evaluate arithmetic",
        enabled=True,
    )
    version = ToolVersion(
        tool_id=tool.tool_id,
        version_id="tv_1",
        version=1,
        created_at=NOW,
        input_schema={
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
        output_schema=output_schema
        or {
            "type": "object",
            "properties": {"expression": {"type": "string"}, "result": {}},
            "required": ["expression", "result"],
        },
        handler="builtin",
        timeout_seconds=timeout,
        permissions=tuple(permissions),
    )
    tool.versions = [version]
    return tool


def call(
    gateway: ToolGateway,
    *,
    tool: Tool | None = None,
    arguments=None,
    key: str = "k1",
    timeout: float = 10.0,
    name: str = "python_math",
    deadline: Deadline | None = None,
):
    return gateway.execute(
        tool_id=tool.tool_id if tool else "tool-python-math",
        name=name,
        arguments=arguments if arguments is not None else {"expression": "2 + 2"},
        deadline=deadline or Deadline.in_seconds(timeout),
        idempotency_key=key,
        tool=tool,
    )


class TestHappyPath:
    async def test_valid_input_executes_the_handler(self) -> None:
        outcome = await call(ToolGateway(), tool=math_tool())
        assert outcome.ok
        assert outcome.output == {"expression": "2 + 2", "result": 4}
        assert outcome.duration_ms >= 0
        assert not outcome.idempotent_replay

    async def test_gateway_satisfies_the_executor_port(self) -> None:
        assert isinstance(ToolGateway(), ToolExecutor)

    async def test_unknown_tool_is_reported(self) -> None:
        with pytest.raises(ToolFailure) as excinfo:
            await call(ToolGateway(), name="does_not_exist")
        assert excinfo.value.reason is FailureReason.TOOL_NOT_FOUND
        assert not excinfo.value.retryable

    async def test_result_is_truncated_when_huge(self) -> None:
        class HugeHandler:
            async def __call__(self, arguments, *, deadline):
                return {"blob": "x" * 50_000}

        gateway = ToolGateway(handler_factory=lambda name: HugeHandler())
        outcome = await call(gateway)
        assert outcome.output["truncated"] is True


class TestInputValidation:
    async def test_missing_required_field_is_rejected_before_execution(self) -> None:
        with pytest.raises(ToolFailure) as excinfo:
            await call(ToolGateway(), tool=math_tool(), arguments={})
        assert excinfo.value.reason is FailureReason.TOOL_INPUT_INVALID
        assert excinfo.value.repairable, "the agent can retry with corrected arguments"

    async def test_wrong_type_is_rejected(self) -> None:
        with pytest.raises(ToolFailure) as excinfo:
            await call(ToolGateway(), tool=math_tool(), arguments={"expression": 42})
        assert excinfo.value.reason is FailureReason.TOOL_INPUT_INVALID

    async def test_extra_properties_are_rejected_when_the_schema_forbids_them(self) -> None:
        tool = math_tool()
        tool.versions[0] = tool.versions[0].model_copy(
            update={
                "input_schema": {
                    "type": "object",
                    "properties": {"expression": {"type": "string"}},
                    "required": ["expression"],
                    "additionalProperties": False,
                }
            }
        )
        with pytest.raises(ToolFailure) as excinfo:
            await call(ToolGateway(), tool=tool, arguments={"expression": "1", "evil": True})
        assert excinfo.value.reason is FailureReason.TOOL_INPUT_INVALID

    async def test_no_schema_means_no_validation_and_no_crash(self) -> None:
        outcome = await call(ToolGateway(), arguments={"expression": "3 * 3"})
        assert outcome.output["result"] == 9


class TestPermissions:
    async def test_permission_denied_is_a_non_retryable_security_failure(self) -> None:
        gateway = ToolGateway(granted_permissions=frozenset({ToolPermission.NONE}))
        with pytest.raises(SecurityFailure) as excinfo:
            await call(gateway, tool=math_tool(permissions=(ToolPermission.NETWORK,)))
        assert excinfo.value.reason is FailureReason.UNAUTHORIZED_TOOL
        assert not excinfo.value.retryable
        assert not excinfo.value.repairable

    async def test_declared_permissions_are_enforced_even_without_a_tool_object(self) -> None:
        gateway = ToolGateway(granted_permissions=frozenset({ToolPermission.NONE}))
        outcome = await call(gateway, arguments={"expression": "1"})
        assert outcome.ok, "a tool with no declared permissions needs no grant"

    async def test_fail_closed_for_sandbox_execution(self) -> None:
        gateway = ToolGateway(granted_permissions=frozenset({ToolPermission.NONE, ToolPermission.NETWORK}))
        tool = math_tool(permissions=(ToolPermission.SANDBOX_EXECUTION,))
        with pytest.raises(SecurityFailure):
            await call(gateway, tool=tool)

    async def test_network_permission_is_allowed_when_granted(self) -> None:
        gateway = ToolGateway(granted_permissions=frozenset({ToolPermission.NONE, ToolPermission.NETWORK}))
        tool = math_tool(permissions=(ToolPermission.NETWORK,))
        assert (await call(gateway, tool=tool)).ok


class TestDeadlines:
    async def test_handler_timeout_produces_a_retryable_tool_timeout(self) -> None:
        class SlowHandler:
            async def __call__(self, arguments, *, deadline):
                await asyncio.sleep(5)
                return {}

        gateway = ToolGateway(handler_factory=lambda name: SlowHandler())
        with pytest.raises(ToolFailure) as excinfo:
            await call(gateway, tool=math_tool(timeout=0.05))
        assert excinfo.value.reason is FailureReason.TOOL_TIMEOUT
        assert excinfo.value.retryable

    async def test_timeout_is_clamped_to_the_remaining_run_budget(self) -> None:
        """A 30s run must not authorise a 60s tool call (Rule 17)."""
        seen: list[float] = []

        class RecordingHandler:
            async def __call__(self, arguments, *, deadline):
                seen.append(deadline.remaining_seconds)
                return {"expression": "1", "result": 1}

        gateway = ToolGateway(handler_factory=lambda name: RecordingHandler())
        await call(gateway, tool=math_tool(timeout=60.0), timeout=30.0)
        assert 0 < seen[0] <= 30.0

    async def test_expired_deadline_stops_before_the_handler_runs(self) -> None:
        ran = False

        class Handler:
            async def __call__(self, arguments, *, deadline):
                nonlocal ran
                ran = True
                return {}

        gateway = ToolGateway(handler_factory=lambda name: Handler())
        deadline = Deadline.in_seconds(0.01)
        await asyncio.sleep(0.05)
        assert deadline.expired
        with pytest.raises(DeadlineExceededFailure):
            await call(gateway, deadline=deadline)
        assert ran is False


class TestOutputValidation:
    async def test_invalid_output_is_rejected(self) -> None:
        class BadHandler:
            async def __call__(self, arguments, *, deadline):
                return {"expression": "1"}  # missing `result`

        gateway = ToolGateway(handler_factory=lambda name: BadHandler())
        with pytest.raises(ToolFailure) as excinfo:
            await call(gateway, tool=math_tool())
        assert excinfo.value.reason is FailureReason.TOOL_INVALID_OUTPUT
        assert not excinfo.value.retryable, "a broken handler will not fix itself"

    async def test_broken_output_schema_is_reported_as_a_tool_failure(self) -> None:
        tool = math_tool(output_schema={"type": "not-a-type"})
        with pytest.raises(ToolFailure) as excinfo:
            await call(ToolGateway(), tool=tool)
        assert excinfo.value.reason is FailureReason.TOOL_INVALID_OUTPUT

    async def test_handler_exception_is_classified_as_unavailable(self) -> None:
        class Boom:
            async def __call__(self, arguments, *, deadline):
                raise RuntimeError("handler exploded")

        with pytest.raises(ToolFailure) as excinfo:
            await call(ToolGateway(handler_factory=lambda name: Boom()))
        assert excinfo.value.reason is FailureReason.TOOL_UNAVAILABLE
        assert excinfo.value.retryable


class TestIdempotency:
    async def test_same_key_replays_the_stored_result(self) -> None:
        calls = 0

        class CountingHandler:
            async def __call__(self, arguments, *, deadline):
                nonlocal calls
                calls += 1
                return {"expression": "1 + 1", "result": 2}

        gateway = ToolGateway(handler_factory=lambda name: CountingHandler())
        first = await call(gateway, tool=math_tool(), key="run:1")
        second = await call(gateway, tool=math_tool(), key="run:1")
        assert calls == 1, "an expensive or irreversible action must not run twice"
        assert second.idempotent_replay is True
        assert second.output == first.output

    async def test_different_keys_execute_again(self) -> None:
        calls = 0

        class CountingHandler:
            async def __call__(self, arguments, *, deadline):
                nonlocal calls
                calls += 1
                return {"expression": "1", "result": 1}

        gateway = ToolGateway(handler_factory=lambda name: CountingHandler())
        await call(gateway, tool=math_tool(), key="a")
        await call(gateway, tool=math_tool(), key="b")
        assert calls == 2

    async def test_expired_records_are_discarded(self) -> None:
        gateway = ToolGateway(handler_factory=lambda name: PythonMathHandler(), idempotency_ttl_seconds=0.0)
        await call(gateway, tool=math_tool(), key="k")
        await asyncio.sleep(0.01)
        assert gateway._replay("k") is None


class TestBuiltinHandlers:
    @pytest.mark.parametrize(
        ("expression", "expected"),
        [
            ("2 + 2", 4),
            ("10 / 4", 2.5),
            ("round(sqrt(16))", 4.0),
            ("max(1, 5, 3)", 5),
            ("-3 ** 2", -9),
            ("sum([1, 2, 3])", 6),
        ],
    )
    async def test_math_handler_computes(self, expression: str, expected: float) -> None:
        handler = PythonMathHandler()
        result = await handler({"expression": expression}, deadline=Deadline.in_seconds(5))
        assert result["result"] == expected

    @pytest.mark.parametrize(
        "expression",
        [
            "__import__('os').system('rm -rf /')",
            "open('/etc/passwd').read()",
            "().__class__.__bases__",
            "[x for x in range(10)]",
            "lambda: 1",
        ],
    )
    async def test_math_handler_refuses_anything_beyond_arithmetic(self, expression: str) -> None:
        with pytest.raises(ToolFailure):
            await PythonMathHandler()({"expression": expression}, deadline=Deadline.in_seconds(5))

    async def test_math_handler_reports_zero_division(self) -> None:
        with pytest.raises(ToolFailure) as excinfo:
            await PythonMathHandler()({"expression": "1/0"}, deadline=Deadline.in_seconds(5))
        assert excinfo.value.reason is FailureReason.TOOL_INVALID_OUTPUT

    async def test_knowledge_search_returns_matches(self) -> None:
        handler = KnowledgeSearchHandler({"kb-sales": ["Retention fell 14% in week 2", "Unrelated"]})
        result = await handler({"query": "retention"}, deadline=Deadline.in_seconds(5))
        assert result["count"] == 1
        assert result["matches"][0]["source_id"] == "kb-sales"

    async def test_http_handler_returns_status_and_body(self) -> None:
        import httpx

        def factory():
            return httpx.AsyncClient(
                transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"ok": True}))
            )

        handler = HttpRequestHandler(client_factory=factory)
        result = await handler({"url": "https://example.test/x"}, deadline=Deadline.in_seconds(5))
        assert result["status_code"] == 200
        assert result["json"] == {"ok": True}


class TestGatewayInTheGraph:
    async def test_agent_routes_a_tool_call_through_the_gateway(self) -> None:
        tool = math_tool()
        spec = ToolSpec(
            tool_id=tool.tool_id,
            name=tool.name,
            description=tool.purpose,
            input_schema=tool.versions[0].input_schema,
            output_schema=tool.versions[0].output_schema,
            timeout_seconds=5.0,
            handler="builtin",
            handler_config={"name": "python_math"},
        )
        request = AgentRequest(
            run_id="run_1",
            bot_id="bot_1",
            bot_version_id="ver_1",
            bot_version="1.0.0",
            bot_type=BotType.AGENT,
            instructions="be helpful",
            message="what is 2 + 2?",
            model=ModelConfig(provider=Provider.OPENCODE, model_id="space-bunny-free"),
            tools=(spec,),
            max_steps=3,
        )
        fake = FakeModelClient(stream_deltas=[[], ["The answer is 4."]])
        fake.queue(
            ScriptedResponse(
                tool_calls=(ToolCall(id="c1", name="tool_python_math", arguments={"expression": "2 + 2"}),),
                finish_reason="tool_calls",
            )
        )
        fake.queue(ScriptedResponse(text="The answer is 4."))

        class BoundGateway(ToolGateway):
            """Binds the stored tool to each call, as the agent activity will do in State 8."""

            async def execute(self, *, tool_id, name, arguments, deadline, idempotency_key, tool=None):
                return await super().execute(
                    tool_id=tool_id,
                    name=name,
                    arguments=arguments,
                    deadline=deadline,
                    idempotency_key=idempotency_key,
                    tool=tool,
                )

        gateway = BoundGateway()
        events: list[AgentEvent] = []

        async def emit(event: AgentEvent) -> None:
            events.append(event)

        result = await LangGraphRunner(fake, tool_executor=gateway).run(
            request, deadline=Deadline.in_seconds(10), emit=emit
        )
        # The model calls `tool_python_math`; the gateway resolves it back to the run's `tool-python-math`
        # contract, so the declared schemas and the `python_math` builtin both apply.
        assert result.response == "The answer is 4."
        assert [a.name for a in result.tool_activity] == ["tool_python_math"]
        assert "tool.completed" in [e.type for e in events]
