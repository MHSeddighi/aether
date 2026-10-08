"""Ports the application layer depends on (Dependency Inversion, Rule 38).

These protocols exist for exactly one reason: the use cases in `app.application` must be unit-testable
without Postgres and without Temporal. The SQLAlchemy repositories in
`app.infrastructure.database.repositories` satisfy them structurally — no adapter, no inheritance, no
registration. Anything that does *not* have a second implementation and no test benefit (the AES
round trip, a JSON encoder) deliberately gets no interface.

`RunStarter` is the one port with a genuinely different implementation: `TemporalRunStarter` in
production, a recording fake in tests.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol, runtime_checkable

from app.domain.accounts import User, Workspace
from app.domain.bots import Bot, BotVersion
from app.domain.conversations import Conversation, Message
from app.domain.failures import RunFailure
from app.domain.models import CatalogModel
from app.domain.runs import Run, RunEvent, RunStatus
from app.domain.tools import Tool, ToolVersion
from app.workflows.contracts import IndexKnowledgeRequest, RunAgentRequest


@runtime_checkable
class AccountRepositoryPort(Protocol):
    async def create_workspace(self, workspace: Workspace) -> Workspace: ...

    async def create_user(self, user: User) -> User: ...

    async def get_user_by_email(self, email: str) -> User | None: ...

    async def get_user(self, user_id: str) -> User | None: ...

    async def get_workspace(self, workspace_id: str) -> Workspace | None: ...

    async def record_usage(self, workspace_id: str, *, runs: int = 0, tokens: int = 0) -> None: ...


@runtime_checkable
class BotRepositoryPort(Protocol):
    async def add(self, bot: Bot, *, version: BotVersion, notes: str = ...) -> Bot: ...

    async def get(self, bot_id: str, workspace_id: str) -> Bot | None: ...

    async def list(self, workspace_id: str, *, limit: int = ...) -> list[Bot]: ...

    async def update(self, bot: Bot, *, version: BotVersion, notes: str) -> Bot: ...

    async def versions(self, bot_id: str, workspace_id: str) -> list[BotVersion]: ...

    async def version(self, version_id: str) -> BotVersion | None: ...

    async def find_builder(self, workspace_id: str) -> Bot | None: ...

    async def add_builder(self, bot: Bot, *, version: BotVersion) -> Bot: ...


@runtime_checkable
class RunRepositoryPort(Protocol):
    async def add(self, run: Run) -> Run: ...

    async def get(self, run_id: str, workspace_id: str | None = ...) -> Run | None: ...

    async def list(self, workspace_id: str, *, bot_id: str | None = ..., limit: int = ...) -> list[Run]: ...

    async def finish(
        self,
        run_id: str,
        *,
        status: RunStatus,
        finished_at: datetime,
        output: str | None = ...,
        failure: RunFailure | None = ...,
        tokens_in: int | None = ...,
        tokens_out: int | None = ...,
        steps: int | None = ...,
        repairs: int | None = ...,
        tool_activities: list[dict] | None = ...,
    ) -> None: ...

    async def append_event(self, event: RunEvent, *, allocate_seq: bool = True) -> RunEvent: ...

    async def events(self, run_id: str, *, after_seq: int = 0, limit: int = ...) -> list[RunEvent]: ...


@runtime_checkable
class ConversationRepositoryPort(Protocol):
    async def add(self, conversation: Conversation) -> Conversation: ...

    async def get(self, conversation_id: str, workspace_id: str) -> Conversation | None: ...

    async def list(self, workspace_id: str, *, limit: int = ...) -> list[Conversation]: ...

    async def add_message(self, message: Message) -> Message: ...

    async def update_message(self, message: Message) -> Message: ...

    async def rename(self, conversation_id: str, workspace_id: str, title: str) -> bool: ...

    async def set_pinned(self, conversation_id: str, workspace_id: str, pinned: bool) -> bool: ...

    async def set_bot(self, conversation_id: str, workspace_id: str, bot_id: str) -> bool: ...

    async def delete(self, conversation_id: str, workspace_id: str) -> bool: ...

    async def get_message(self, message_id: str, workspace_id: str) -> Message | None: ...


@runtime_checkable
class ToolRepositoryPort(Protocol):
    async def add(self, tool: Tool, *, version: ToolVersion) -> Tool: ...

    async def get(self, tool_id: str, workspace_id: str) -> Tool | None: ...

    async def list(self, workspace_id: str, *, only_enabled: bool = ...) -> list[Tool]: ...

    async def update(
        self, tool: Tool, *, version: ToolVersion | None, previous_versions: list[ToolVersion]
    ) -> Tool: ...

    async def delete(self, tool_id: str, workspace_id: str) -> bool: ...


@runtime_checkable
class ModelCatalogPort(Protocol):
    async def models(self, *, force_refresh: bool = False) -> list[CatalogModel]: ...


@runtime_checkable
class RunStarter(Protocol):
    """Starts and cancels durable run executions.

    This is the application's only view of Temporal: the use cases know that a run is executed
    durably and that cancellation is requested, but not that Temporal implements it.
    """

    async def start(self, request: RunAgentRequest, *, workflow_id: str) -> str: ...

    async def cancel(self, run_id: str) -> bool: ...


@runtime_checkable
class BuildRepositoryPort(Protocol):
    async def add_build(self, build: dict) -> dict: ...

    async def get_build(self, build_id: str, workspace_id: str) -> dict | None: ...

    async def finish_build(self, build_id: str, *, status: str, failure: dict | None = None) -> None: ...

    async def get_checkpoints(self, build_id: str) -> list[dict]: ...


@runtime_checkable
class BuildStarter(Protocol):
    """Starts and cancels durable build executions (Temporal-backed in production)."""

    async def start(self, spec: object, *, workflow_id: str) -> str: ...

    async def cancel(self, build_id: str) -> bool: ...


@runtime_checkable
class KnowledgeStarter(Protocol):
    """Starts durable knowledge indexing (Temporal-backed in production)."""

    async def start(self, request: IndexKnowledgeRequest, *, workflow_id: str) -> str: ...
