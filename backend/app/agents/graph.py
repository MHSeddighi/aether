"""The LangGraph agent.

    plan ──no tool calls──▶ finalize ─▶ END
      │ tool calls
      ▼
     act ──▶ plan (next step)

`plan` is the only node that talks to a model and `act` is the only node that talks to a tool, both
through ports, so the graph is provider-agnostic and tool-agnostic (Open/Closed). Streaming deltas
are emitted from `plan` because only that node holds the model connection.

Failure handling follows the taxonomy: a tool failure becomes an observation the model can react to
(a recoverable failure), a security failure stops the run immediately (Rule 20).
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agents.contracts import AgentResult, AgentUsage, BotProposal, ToolProposal
from app.agents.prompts import build_system_prompt
from app.agents.proposal import ProposalGenerator, _as_schema
from app.agents.repair import DEFAULT_MAX_REPAIRS
from app.agents.request import AgentEvent, AgentRequest
from app.agents.state import STOP_MAX_STEPS, STOP_NO_TOOLS, AgentState
from app.domain.conversations import ToolActivity, ToolActivityStatus
from app.domain.deadline import Deadline
from app.domain.failures import AgentError, FailureKind, FailureReason, SecurityFailure, ValidationFailure
from app.infrastructure.logging_config import get_logger
from app.infrastructure.models.base import (
    ChatMessage,
    GenerationRequest,
    ModelClient,
    ModelTool,
    ToolCall,
    assistant_message,
    system_message,
    tool_result_message,
    user_message,
)
from app.tools.base import ToolExecutor

logger = get_logger(__name__)

STEP_STARTED = "agent.step.started"
COMPLETED = "agent.completed"


class LangGraphRunner:
    """`AgentRunner` implementation backed by LangGraph."""

    supports_tools = True

    def __init__(
        self,
        model_client: ModelClient,
        *,
        tool_executor: ToolExecutor | None = None,
        stream: bool = True,
        max_repairs: int | None = None,
    ) -> None:
        self._client = model_client
        self._tool_executor = tool_executor
        self._stream = stream
        self._max_repairs = DEFAULT_MAX_REPAIRS if max_repairs is None else max_repairs

    async def run(self, request: AgentRequest, *, deadline: Deadline, emit) -> AgentResult:
        graph = self._build_graph(request, deadline, emit)
        initial: AgentState = {
            "messages": self._initial_messages(request),
            "steps": 0,
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "tool_results": [],
            "pending_tool_calls": [],
        }
        final = await graph.ainvoke(initial)
        return self._to_result(request, final)

    # --- graph ------------------------------------------------------------

    def _build_graph(self, request: AgentRequest, deadline: Deadline, emit):
        proposes = self._proposes(request)
        builder = StateGraph(AgentState)
        builder.add_node("plan", self._plan_node(request, deadline, emit))
        builder.add_node("act", self._act_node(request, deadline, emit))
        if proposes:
            builder.add_node("propose", self._propose_node(request, deadline))
        builder.add_node("finalize", self._finalize_node(emit))

        builder.add_edge(START, "plan")
        builder.add_conditional_edges(
            "plan",
            self._route_after_plan,
            {"tools": "act", "done": "propose" if proposes else "finalize"},
        )
        builder.add_edge("act", "plan")
        if proposes:
            # Tools may inform the proposal (the model can search before it designs), so the propose
            # node runs after the reasoning loop, not instead of it.
            builder.add_edge("propose", "finalize")
        builder.add_edge("finalize", END)
        return builder.compile()

    def _proposes(self, request: AgentRequest) -> bool:
        return request.intent in {"build_bot", "build_tool"}

    def _route_after_plan(self, state: AgentState) -> str:
        if state.get("pending_tool_calls"):
            return "tools"
        return "done"

    # --- nodes ------------------------------------------------------------

    def _plan_node(self, request: AgentRequest, deadline: Deadline, emit):
        async def plan(state: AgentState) -> dict[str, Any]:
            step = state.get("steps", 0) + 1
            await emit(
                AgentEvent(
                    type=STEP_STARTED,
                    data={
                        "step": step,
                        "tools": [spec.tool_id for spec in request.tools],
                    },
                )
            )
            deadline.require(0.2, what="model call")

            generation = GenerationRequest(
                model=request.model,
                messages=tuple(state["messages"]),
                tools=tuple(
                    ModelTool(
                        name=spec.tool_id.replace("-", "_"),
                        description=spec.description or spec.name,
                        input_schema=spec.input_schema,
                        permissions=spec.permissions,
                    )
                    for spec in request.tools
                ),
            )
            text, calls, usage = await self._call_model(generation, emit=emit)
            update: dict[str, Any] = {
                "steps": step,
                "usage": usage,
                "pending_tool_calls": list(calls),
                "messages": [assistant_message(text, calls)],
            }
            if not calls:
                update["final_text"] = text
                update["stop_reason"] = STOP_NO_TOOLS
            elif step >= request.max_steps:
                # Bounded: never loop forever (Rule 23). The tool calls are dropped and the model is
                # asked for a final answer next step.
                update["pending_tool_calls"] = []
                update["stop_reason"] = STOP_MAX_STEPS
                update["last_error"] = f"step budget of {request.max_steps} reached"
                update["messages"] = [
                    assistant_message(text, ()),
                    user_message(
                        f"Step budget reached ({request.max_steps}). Answer now using what you have."
                    ),
                ]
            return update

        return plan

    def _act_node(self, request: AgentRequest, deadline: Deadline, emit):
        async def act(state: AgentState) -> dict[str, Any]:
            calls: list[ToolCall] = list(state.get("pending_tool_calls") or [])
            results: list[dict[str, Any]] = []
            messages: list[ChatMessage] = []

            for call in calls:
                # The remaining budget is passed down, so a tool can never outlive the run (Rule 17).
                outcome = await self._execute_tool(request, call, deadline=deadline, emit=emit)
                results.append(
                    {
                        "tool_id": outcome.tool_id,
                        "name": outcome.name,
                        "ok": outcome.ok,
                        "detail": outcome.detail,
                        "duration_ms": outcome.duration_ms,
                    }
                )
                messages.append(tool_result_message(call.id, call.name, outcome.as_message_content()))

            return {
                "messages": messages,
                "tool_results": results,
                "pending_tool_calls": [],
            }

        return act

    def _finalize_node(self, emit):
        async def finalize(state: AgentState) -> dict[str, Any]:
            await emit(
                AgentEvent(
                    type=COMPLETED,
                    data={
                        "steps": state.get("steps", 0),
                        "toolCalls": len(state.get("tool_results") or []),
                        "proposed": bool(state.get("proposal")),
                    },
                )
            )
            return {"final_text": state.get("final_text", "")}

        return finalize

    def _propose_node(self, request: AgentRequest, deadline: Deadline):
        """Generate the structured proposal, with a bounded repair loop (Rule 23).

        Nothing reaches `AgentState` until it has passed schema *and* business-constraint
        validation, so no downstream node ever sees raw model JSON (Rule 21).
        """

        async def propose(_state: AgentState) -> dict[str, Any]:
            generator = ProposalGenerator(self._client, max_repairs=self._max_repairs)
            known_tools = tuple(spec.tool_id for spec in request.tools)
            if request.intent == "build_tool":
                outcome = await generator.tool_proposal(
                    message=request.message,
                    instructions=request.instructions,
                    model=request.model,
                    deadline=deadline,
                )
                proposal = outcome.value
            else:
                outcome = await generator.bot_proposal(
                    message=request.message,
                    instructions=request.instructions,
                    model=request.model,
                    deadline=deadline,
                    known_tool_ids=known_tools,
                    known_knowledge_ids=tuple(request.knowledge),
                )
                proposal = outcome.value
            if isinstance(proposal, BotProposal):
                payload = proposal.as_payload
            elif isinstance(proposal, ToolProposal):
                payload = proposal.model_dump(mode="json")
            else:  # pragma: no cover - the generator returns exactly one of the two
                raise ValidationFailure(
                    FailureReason.OUTPUT_SCHEMA,
                    "the proposal generator returned an unexpected type",
                )
            return {"proposal": payload, "repairs": outcome.repairs}

        return propose

    # --- model and tool calls ---------------------------------------------

    async def _call_model(
        self, generation: GenerationRequest, *, emit
    ) -> tuple[str, tuple[ToolCall, ...], dict[str, int]]:
        if not self._stream:
            completion = await self._client.complete(generation)
            return (
                completion.text,
                completion.tool_calls,
                {
                    "input_tokens": completion.input_tokens,
                    "output_tokens": completion.output_tokens,
                },
            )

        collected: list[str] = []
        calls: list[ToolCall] = []
        usage = {"input_tokens": 0, "output_tokens": 0}
        async for chunk in self._client.stream(generation):
            if chunk.text:
                collected.append(chunk.text)
                await emit(AgentEvent(type="agent.delta", data={"text": chunk.text}, persisted=False))
            if chunk.tool_call_delta is not None:
                calls.append(chunk.tool_call_delta)
            if chunk.usage:
                usage = dict(chunk.usage)
        return "".join(collected), tuple(calls), usage

    async def _execute_tool(self, request: AgentRequest, call: ToolCall, *, deadline, emit) -> Any:
        from app.tools.base import NoToolsConfigured

        executor = self._tool_executor or NoToolsConfigured()
        tool_id = call.name.replace("_", "-")
        contract = next((spec for spec in request.tools if spec.tool_id.replace("-", "_") == call.name), None)
        if contract is None:
            # The bot's declared tools are the authorization boundary. A model can hallucinate a
            # tool name, or be prompt-injected into naming one; either way it is not declared, so it
            # must never reach the gateway. Fail closed (Rule 20).
            raise SecurityFailure(
                FailureReason.UNAUTHORIZED_TOOL,
                f"tool {call.name!r} is not declared by this bot",
                details={"tool": call.name},
            )
        await emit(AgentEvent(type="tool.started", data={"tool": call.name, "toolId": tool_id}))
        try:
            outcome = await executor.execute(
                tool_id=tool_id,
                name=call.name,
                arguments=call.arguments,
                deadline=deadline or Deadline.in_seconds(request.model.timeout_seconds),
                idempotency_key=f"{request.run_id}:{call.id}",
                tool=contract,
            )
        except AgentError as failure:
            if failure.kind is FailureKind.SECURITY:
                # A security failure is never recoverable: stop the run (Rule 20).
                raise
            outcome = _failed_outcome(tool_id, call.name, failure)
        if outcome.ok:
            await emit(
                AgentEvent(
                    type="tool.completed",
                    data={
                        "tool": call.name,
                        "toolId": tool_id,
                        "detail": outcome.detail,
                        "durationMs": outcome.duration_ms,
                    },
                )
            )
        else:
            await emit(
                AgentEvent(
                    type="tool.failed",
                    data={
                        "tool": call.name,
                        "toolId": tool_id,
                        "error": outcome.error,
                    },
                )
            )
        return outcome

    # --- results ----------------------------------------------------------

    def _initial_messages(self, request: AgentRequest) -> list[ChatMessage]:
        messages: list[ChatMessage] = [system_message(build_system_prompt(request))]
        for turn in request.history:
            messages.append(
                user_message(turn.content) if turn.role == "user" else assistant_message(turn.content)
            )
        messages.append(user_message(request.message))
        return messages

    def _to_result(self, request: AgentRequest, state: AgentState) -> AgentResult:
        usage = state.get("usage") or {}
        activities = [
            ToolActivity(
                name=str(item["name"]),
                status=ToolActivityStatus.COMPLETED if item["ok"] else ToolActivityStatus.FAILED,
                detail=str(item.get("detail") or ""),
                tool_id=str(item.get("tool_id") or ""),
            )
            for item in state.get("tool_results") or []
        ]
        proposal = state.get("proposal")
        text = state.get("final_text") or ""
        if not text.strip() and state.get("last_error"):
            text = str(state["last_error"])
        if not text.strip() and proposal:
            text = _proposal_summary(request.intent, proposal)
        # A proposal is re-validated here rather than trusted from the graph state: this is the edge
        # where AI output becomes application state (Rule 21).
        bot_proposal = _as_bot_proposal(proposal) if request.intent == "build_bot" else None
        tool_proposal = _as_tool_proposal(proposal) if request.intent == "build_tool" else None
        return AgentResult(
            response=text,
            tool_activity=activities,
            usage=AgentUsage(
                input_tokens=int(usage.get("input_tokens", 0)),
                output_tokens=int(usage.get("output_tokens", 0)),
            ),
            steps=int(state.get("steps", 0)),
            repairs=int(state.get("repairs", 0)),
            bot_proposal=bot_proposal,
            tool_proposal=tool_proposal,
        )


def _failed_outcome(tool_id: str, name: str, failure: AgentError):
    from app.tools.base import ToolOutcome

    return ToolOutcome(
        tool_id=tool_id, name=name, ok=False, error=str(failure.reason), detail=failure.message
    )


def _as_bot_proposal(payload: dict[str, Any] | None) -> BotProposal | None:
    return _as_schema(BotProposal, payload) if payload else None


def _as_tool_proposal(payload: dict[str, Any] | None) -> ToolProposal | None:
    return _as_schema(ToolProposal, payload) if payload else None


def _proposal_summary(intent: str, proposal: dict[str, Any]) -> str:
    """The chat bubble still needs text: the proposal itself is shown as a card, not as prose."""
    if intent == "build_tool":
        return f"I drafted the tool “{proposal.get('name', '')}”. Review it before deploying."
    return f"I drafted a bot called “{proposal.get('name', '')}”. Review it before deploying."


__all__ = ["LangGraphRunner"]
