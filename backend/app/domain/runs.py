"""Run and run-event contracts.

Run status and the event type vocabulary are the application's streaming contract (Rule 27); the
frontend renders them, so they live in the domain rather than in a route module.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domain.failures import RunFailure
from app.domain.models import ModelConfig


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"

    @property
    def is_terminal(self) -> bool:
        return self in {
            RunStatus.SUCCEEDED,
            RunStatus.FAILED,
            RunStatus.CANCELLED,
            RunStatus.TIMED_OUT,
        }


#: Only these statuses may transition to SUCCEEDED/FAILED/... (Rule 19).
_ALLOWED_TRANSITIONS: dict[RunStatus, frozenset[RunStatus]] = {
    RunStatus.QUEUED: frozenset(
        {RunStatus.RUNNING, RunStatus.CANCELLED, RunStatus.FAILED, RunStatus.TIMED_OUT}
    ),
    RunStatus.RUNNING: frozenset(
        {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.TIMED_OUT}
    ),
    RunStatus.SUCCEEDED: frozenset(),
    RunStatus.FAILED: frozenset(),
    RunStatus.CANCELLED: frozenset(),
    RunStatus.TIMED_OUT: frozenset(),
}


class RunEventType(StrEnum):
    RUN_STARTED = "run.started"
    AGENT_STARTED = "agent.started"
    AGENT_STEP_STARTED = "agent.step.started"
    AGENT_DELTA = "agent.delta"
    TOOL_STARTED = "tool.started"
    TOOL_COMPLETED = "tool.completed"
    TOOL_FAILED = "tool.failed"
    VALIDATION_FAILED = "validation.failed"
    REPAIR_ATTEMPTED = "repair.attempted"
    MESSAGE_COMPLETED = "message.completed"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"
    RUN_CANCELLED = "run.cancelled"

    @property
    def is_terminal(self) -> bool:
        return self in {
            RunEventType.RUN_COMPLETED,
            RunEventType.RUN_FAILED,
            RunEventType.RUN_CANCELLED,
        }

    @property
    def is_persisted(self) -> bool:
        """Token deltas are streamed live but never stored (Rule 27)."""
        return self is not RunEventType.AGENT_DELTA


class RunEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    event_id: str
    run_id: str
    seq: int = Field(ge=1)
    type: RunEventType
    ts: datetime = Field(default_factory=lambda: datetime.now(UTC))
    data: dict[str, Any] = Field(default_factory=dict)

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.event_id,
            "runId": self.run_id,
            "seq": self.seq,
            "type": str(self.type),
            "ts": self.ts.isoformat(),
            "data": self.data,
        }


class Run(BaseModel):
    run_id: str
    workspace_id: str
    bot_id: str
    bot_version_id: str
    bot_version: str
    model: ModelConfig
    status: RunStatus = RunStatus.QUEUED
    input: str
    conversation_id: str | None = None
    assistant_message_id: str | None = None
    workflow_id: str | None = None
    failure: RunFailure | None = None
    output: str | None = None
    tool_activities: list[dict[str, Any]] = Field(default_factory=list)
    knowledge_sources: list[str] = Field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    steps: int = 0
    repairs: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    finished_at: datetime | None = None
    deadline_at: datetime | None = None

    def can_transition_to(self, status: RunStatus) -> bool:
        return status in _ALLOWED_TRANSITIONS[self.status]

    @property
    def latency_ms(self) -> int | None:
        if self.started_at is None:
            return None
        end = self.finished_at or datetime.now(UTC)
        return int((end - self.started_at).total_seconds() * 1000)


class RunEventSequence:
    """Monotonic per-run sequence allocator.

    The database assigns `seq` under a row lock in production; this object is the in-process
    equivalent used by tests and by the workflow's in-memory bookkeeping.
    """

    __slots__ = ("_next",)

    def __init__(self, start: int = 1) -> None:
        self._next = start

    def take(self) -> int:
        value = self._next
        self._next += 1
        return value


def run_to_dict(run: Run) -> dict[str, Any]:
    return {
        "id": run.run_id,
        "botId": run.bot_id,
        "botVersionId": run.bot_version_id,
        "botVersion": run.bot_version,
        "status": str(run.status),
        "input": run.input,
        "conversationId": run.conversation_id,
        "assistantMessageId": run.assistant_message_id,
        "model": {
            "provider": str(run.model.provider),
            "modelId": run.model.model_id,
            "label": run.model.label,
            "temperature": run.model.temperature,
            "topP": run.model.top_p,
            "maxOutputTokens": run.model.max_output_tokens,
            "timeoutSeconds": run.model.timeout_seconds,
            "retry": run.model.retry.model_dump(),
        },
        "failure": run.failure.to_dict() if run.failure else None,
        "output": run.output,
        "toolActivity": run.tool_activities,
        "knowledgeSources": run.knowledge_sources,
        "usage": {
            "inputTokens": run.tokens_in,
            "outputTokens": run.tokens_out,
        },
        "steps": run.steps,
        "repairs": run.repairs,
        "latencyMs": run.latency_ms,
        "createdAt": run.created_at.isoformat(),
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "deadlineAt": run.deadline_at.isoformat() if run.deadline_at else None,
    }
