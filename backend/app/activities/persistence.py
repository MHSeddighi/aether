"""Persistence and agent-execution activities.

Five meaningful boundaries (Rule 25): load the immutable execution spec, mark the run started,
execute the agent, persist the validated outcome, and persist a terminal outcome (failure or
cancellation). Every activity assumes it may run more than once and is therefore idempotent
(Rule 18).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from temporalio import activity

from app.activities.container import ActivityContainer, get
from app.agents.contracts import AgentResult
from app.agents.deterministic import DeterministicRunner
from app.agents.graph import LangGraphRunner
from app.agents.request import (
    MAX_HISTORY_MESSAGES,
    AgentEvent,
    AgentRequest,
    ConversationTurn,
    ToolSpec,
)
from app.agents.runner import AgentRunner
from app.domain.bots import BotMetricsAccumulator, BotType
from app.domain.conversations import AttachmentProposal, Message, Sender
from app.domain.deadline import Deadline
from app.domain.failures import AgentError, FailureReason, RunFailure, ValidationFailure
from app.domain.ids import new_id
from app.domain.models import ModelConfig
from app.domain.runs import RunEvent, RunEventType, RunStatus
from app.infrastructure.database.repositories.bot_repository import BotRepository
from app.infrastructure.database.repositories.conversation_repository import (
    ConversationRepository,
)
from app.infrastructure.database.repositories.run_repository import RunRepository
from app.infrastructure.database.repositories.tool_repository import ToolRepository
from app.infrastructure.logging_config import get_logger
from app.infrastructure.temporal.errors import to_activity_error
from app.workflows.contracts import RunAgentRequest

logger = get_logger(__name__)

AGENT_DELTA = "agent.delta"
TOOL_EVENT_TYPES = {
    "tool.started",
    "tool.completed",
    "tool.failed",
    "validation.failed",
    "repair.attempted",
    "agent.step.started",
    "agent.completed",
}


@activity.defn(name="load_bot_version")
async def load_bot_version(request: RunAgentRequest) -> dict[str, Any]:
    """Load the immutable bot version and the tool specs the agent may use.

    Returns plain data (not a domain object) so the workflow history stays trivially serialisable.
    """
    container = get()
    async with container.database.session() as session:
        bots = BotRepository(session)
        version = await bots.version(request.bot_version_id)
        if version is None or version.bot_id != request.bot_id:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"bot version {request.bot_version_id!r} not found for bot {request.bot_id!r}",
                details={"bot_id": request.bot_id, "bot_version_id": request.bot_version_id},
            )
        bot = await bots.get(request.bot_id, request.workspace_id)
        bot_type = bot.bot_type if bot is not None else BotType.AGENT
        tools = await ToolRepository(session).get_many(list(version.tool_ids), request.workspace_id)

    specs = [_tool_spec(tool) for tool in tools.values() if tool.enabled]
    return {
        "run_id": request.run_id,
        "message": request.input,
        "bot_id": version.bot_id,
        "bot_version_id": version.version_id,
        "bot_version": version.version,
        "bot_type": str(bot_type),
        # Variables are substituted here, once, on the way into the run: the runner and the
        # prompt builder never need to know they exist, and the substitution is recorded in the
        # workflow history like every other decision (Rule 36).
        "instructions": version.resolved_instructions,
        "model": version.model_spec.model_dump(mode="json"),
        "history": [
            {"role": role, "content": content} for role, content in request.history[-MAX_HISTORY_MESSAGES:]
        ],
        "tools": specs,
        "knowledge": list(version.knowledge_ids),
        "deterministic_rules": [rule.model_dump() for rule in version.deterministic_rules],
        "attachments": list(request.attachments),
        "intent": request.intent,
        "timeout_seconds": request.timeout_seconds,
    }


@activity.defn(name="start_run")
async def start_run(request: RunAgentRequest) -> dict[str, Any]:
    """Mark the run running and emit `run.started`. Idempotent."""
    container = get()
    async with container.database.session() as session:
        runs = RunRepository(session)
        run = await runs.get(request.run_id, request.workspace_id)
        if run is None:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"run {request.run_id!r} does not exist",
                details={"run_id": request.run_id},
            )
        now = datetime.now(UTC)
        await runs.mark_running(request.run_id, workflow_id=run.workflow_id or "", started_at=now)
        await append_event(
            runs,
            request.run_id,
            RunEventType.RUN_STARTED,
            {
                "botId": run.bot_id,
                "botVersionId": run.bot_version_id,
                "model": run.model.label,
            },
        )
        return {"run_id": request.run_id, "started_at": now.isoformat()}


@activity.defn(name="execute_agent")
async def execute_agent(spec: dict[str, Any]) -> dict[str, Any]:
    """Run the agent. The only activity that touches a model or a tool.

    Progress events are written from here, inside the activity, because only the process holding the
    model connection can observe token deltas.
    """
    container = get()
    runner = runner_for(container, spec)

    async def emit(event: AgentEvent) -> None:
        if event.type == AGENT_DELTA:
            # Deltas are streamed to SSE but never persisted (Rule 27).
            logger.debug(
                "agent delta",
                extra={"run_id": spec["run_id"], "chars": len(event.data.get("text", ""))},
            )
            return
        async with container.database.session() as session:
            await append_event(RunRepository(session), spec["run_id"], event.type, event.data)

    request = build_agent_request(spec, max_steps=container.settings.agent_max_steps)
    await emit(AgentEvent(type=RunEventType.AGENT_STARTED, data={"model": request.model.label}))

    deadline = Deadline.in_seconds(
        spec.get("timeout_seconds") or container.settings.agent_run_timeout_seconds
    )
    try:
        result = await runner.run(request, deadline=deadline, emit=emit)
    except AgentError as exc:
        # The taxonomy must survive the activity boundary. Raising the raw error lets Temporal
        # serialise it as a generic exception, so a rate limit would reach the workflow as
        # `unexpected` and be retried blindly; an `ApplicationError` carries the classification.
        raise to_activity_error(exc) from exc
    return result.model_dump(mode="json")


@activity.defn(name="persist_run_result")
async def persist_run_result(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate the agent result, then write the run and the assistant message. Idempotent."""
    container = get()
    run_id = payload["run_id"]
    try:
        result = AgentResult.model_validate(payload["result"])
    except ValueError as exc:
        raise ValidationFailure(
            FailureReason.OUTPUT_SCHEMA,
            f"agent result failed validation: {exc}",
            details={"run_id": run_id},
        ) from exc

    now = datetime.now(UTC)
    async with container.database.session() as session:
        runs = RunRepository(session)
        run = await runs.get(run_id)
        if run is None:
            raise ValidationFailure(FailureReason.OUTPUT_CONSTRAINT, f"run {run_id!r} does not exist")

        await runs.finish(
            run_id,
            status=RunStatus.SUCCEEDED,
            finished_at=now,
            output=result.response,
            tokens_in=result.usage.input_tokens,
            tokens_out=result.usage.output_tokens,
            steps=result.steps,
            repairs=result.repairs,
            tool_activities=[item.model_dump(mode="json") for item in result.tool_activity],
        )

        if run.assistant_message_id and run.conversation_id:
            message = Message(
                message_id=run.assistant_message_id,
                conversation_id=run.conversation_id,
                run_id=run_id,
                sender=Sender.BOT,
                content=result.response,
                is_streaming=False,
                tool_activity=result.tool_activity,
                knowledge_retrieval=result.knowledge_retrieval,
                attachments=result.attachments,
            )
            if result.bot_proposal:
                message.bot_proposal = AttachmentProposal(
                    proposed=result.bot_proposal.to_frontend_payload,
                    is_confirmed=False,
                    code_snippet=result.bot_proposal.code_snippet,
                )
            if result.tool_proposal:
                message.tool_proposal = AttachmentProposal(
                    proposed=result.tool_proposal.to_frontend_payload,
                    is_confirmed=False,
                    code_snippet=result.tool_proposal.code_snippet,
                )
            try:
                await ConversationRepository(session).update_message(message)
            except LookupError:
                logger.warning("assistant message missing", extra={"run_id": run_id})

        await append_event(
            runs,
            run_id,
            RunEventType.RUN_COMPLETED,
            {
                "steps": result.steps,
                "repairs": result.repairs,
                "usage": result.usage.model_dump(),
                "toolCalls": len(result.tool_activity),
            },
        )
        if run.assistant_message_id:
            await append_event(
                runs,
                run_id,
                RunEventType.MESSAGE_COMPLETED,
                {
                    "messageId": run.assistant_message_id,
                },
            )
    return {"run_id": run_id, "status": str(RunStatus.SUCCEEDED), "output": result.response}


@activity.defn(name="fail_run")
async def fail_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist a classified failure. Called from the workflow's error path, so it must not raise."""
    container = get()
    run_id = payload["run_id"]
    failure = RunFailure.model_validate(payload["failure"])
    now = datetime.now(UTC)
    status = (
        RunStatus.TIMED_OUT
        if failure.reason in (FailureReason.DEADLINE_EXCEEDED, FailureReason.MODEL_TIMEOUT)
        else RunStatus.FAILED
    )

    async with container.database.session() as session:
        runs = RunRepository(session)
        await runs.finish(run_id, status=status, finished_at=now, failure=failure)
        await append_event(runs, run_id, RunEventType.RUN_FAILED, failure.to_dict())

        run = await runs.get(run_id)
        if run is not None:
            # Finalise the assistant bubble with the classified failure, so the error the user sees
            # during streaming survives a page reload (the run row alone does not carry the chat UI).
            if run.assistant_message_id and run.conversation_id:
                try:
                    await ConversationRepository(session).update_message(
                        Message(
                            message_id=run.assistant_message_id,
                            conversation_id=run.conversation_id,
                            run_id=run_id,
                            sender=Sender.BOT,
                            content=failure.message,
                            is_streaming=False,
                        )
                    )
                except LookupError:
                    logger.warning("assistant message missing on failure", extra={"run_id": run_id})
                else:
                    await append_event(
                        runs,
                        run_id,
                        RunEventType.MESSAGE_COMPLETED,
                        {"messageId": run.assistant_message_id},
                    )

            bots = BotRepository(session)
            existing = await bots.get(run.bot_id, run.workspace_id)
            accumulator = BotMetricsAccumulator(existing.metrics if existing else None)
            accumulator.record(
                latency_ms=run.latency_ms or 0,
                tokens=run.tokens_in + run.tokens_out,
                succeeded=False,
            )
            await bots.touch_usage(
                run.bot_id, last_used_at=run.finished_at or now, metrics=accumulator.result()
            )
    return {"run_id": run_id, "status": str(status)}


@activity.defn(name="cancel_run")
async def cancel_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist a cancellation. Runs after the workflow was cancelled, so it must not raise."""
    container = get()
    run_id = payload["run_id"]
    now = datetime.now(UTC)
    async with container.database.session() as session:
        runs = RunRepository(session)
        await runs.finish(run_id, status=RunStatus.CANCELLED, finished_at=now)
        await append_event(runs, run_id, RunEventType.RUN_CANCELLED, {"reason": payload.get("reason", "")})
    return {"run_id": run_id, "status": str(RunStatus.CANCELLED)}


# --- helpers ---------------------------------------------------------------


def runner_for(container: ActivityContainer, spec: dict[str, Any]) -> AgentRunner:
    """Pick the executor for this run: deterministic bots never reach the gateway (Rule 4/36)."""
    if BotType(spec["bot_type"]) is BotType.SIMPLE:
        return DeterministicRunner()
    model = ModelConfig.model_validate(spec["model"])
    tool_executor = container.tool_executor_builder() if container.tool_executor_builder else None
    return LangGraphRunner(
        container.model_client_builder(model),
        tool_executor=tool_executor,
        stream=True,
    )


def _tool_spec(tool) -> ToolSpec:
    active = tool.active_version()
    return ToolSpec(
        tool_id=tool.tool_id,
        name=tool.name,
        description=tool.purpose,
        input_schema=active.input_schema if active else {},
        output_schema=active.output_schema if active else {},
        timeout_seconds=active.timeout_seconds if active else 20.0,
        permissions=active.permissions if active else (),
        handler=active.handler if active else "builtin",
        handler_config=dict(active.handler_config) if active else {},
    )


def build_agent_request(spec: dict[str, Any], *, max_steps: int) -> AgentRequest:
    """Turn the plain execution spec into the immutable request the runner consumes."""
    return AgentRequest(
        run_id=spec["run_id"],
        bot_id=spec["bot_id"],
        bot_version_id=spec["bot_version_id"],
        bot_version=spec["bot_version"],
        bot_type=BotType(spec["bot_type"]),
        instructions=spec["instructions"],
        message=spec.get("message", ""),
        model=ModelConfig.model_validate(spec["model"]),
        history=tuple(ConversationTurn.model_validate(turn) for turn in spec.get("history", [])),
        tools=tuple(ToolSpec.model_validate(tool) for tool in spec.get("tools", [])),
        knowledge=tuple(spec.get("knowledge", [])),
        deterministic_rules=tuple(spec.get("deterministic_rules", [])),
        attachments=tuple(spec.get("attachments", [])),
        intent=str(spec.get("intent", "chat")),
        max_steps=max_steps,
    )


async def append_event(runs: RunRepository, run_id: str, event_type: str, data: dict[str, Any]) -> RunEvent:
    """Append one run event, allocating its sequence number. Deltas are rejected (Rule 27)."""
    return await runs.append_event(
        RunEvent(
            event_id=new_id("evt"),
            run_id=run_id,
            seq=1,
            type=RunEventType(event_type),
            data=data,
        )
    )
