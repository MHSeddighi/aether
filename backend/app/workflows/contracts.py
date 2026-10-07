"""Workflow boundary contracts.

Plain dataclasses, not Pydantic models: the workflow payload is part of the durable history, so it
must stay trivially serialisable and stable for replay.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class RunAgentRequest:
    run_id: str
    workspace_id: str
    bot_id: str
    bot_version_id: str
    input: str
    conversation_id: str | None = None
    assistant_message_id: str | None = None
    history: tuple[tuple[str, str], ...] = ()
    attachments: tuple[dict, ...] = ()
    timeout_seconds: float = 180.0


@dataclass(frozen=True, slots=True)
class RunAgentOutcome:
    run_id: str
    status: str
    output: str | None = None
    failure: dict | None = None
    steps: int = 0
    tool_activity: tuple[dict, ...] = ()


@dataclass(frozen=True, slots=True)
class IndexKnowledgeRequest:
    source_id: str
    workspace_id: str


@dataclass(frozen=True, slots=True)
class BuildBotRequest:
    build_id: str
    workspace_id: str
    bot_id: str
    bot_version_id: str
    specification: str = ""
    checkpoints: dict[str, str] = field(default_factory=dict)
