"""In-memory fakes for the repository ports.

These exist so the use cases in `app.application` can be tested without Postgres or Temporal
(Dependency Inversion, Rule 38). They implement the *same protocols* as the SQLAlchemy repositories,
which is the whole point: the tests exercise the real use cases, only with a different collaborator.

Each fake keeps the invariants the real repositories guarantee (workspace scoping, immutable
versions, terminal-state writes), because a fake that ignores them would let broken code pass.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.domain.accounts import User, Workspace
from app.domain.bots import Bot, BotVersion
from app.domain.conversations import Conversation, Message
from app.domain.knowledge import KnowledgeSource
from app.domain.runs import Run, RunEvent, RunStatus
from app.domain.tools import Tool, ToolVersion
from app.workflows.contracts import RunAgentRequest


class EmailConflict(Exception):
    def __init__(self, email: str) -> None:
        super().__init__(email)
        self.email = email


class FakeAccountRepository:
    def __init__(self) -> None:
        self.workspaces: dict[str, Workspace] = {}
        self.users: dict[str, User] = {}

    async def create_workspace(self, workspace: Workspace) -> Workspace:
        self.workspaces[workspace.workspace_id] = workspace
        return workspace

    async def create_user(self, user: User) -> User:
        if any(existing.email == user.email.lower() for existing in self.users.values()):
            raise EmailConflict(user.email)
        self.users[user.user_id] = user
        return user

    async def get_user_by_email(self, email: str) -> User | None:
        return next((u for u in self.users.values() if u.email == email.lower()), None)

    async def get_user(self, user_id: str) -> User | None:
        return self.users.get(user_id)

    async def get_workspace(self, workspace_id: str) -> Workspace | None:
        return self.workspaces.get(workspace_id)

    async def record_usage(self, workspace_id: str, *, runs: int = 0, tokens: int = 0) -> None:
        workspace = self.workspaces.get(workspace_id)
        if workspace is not None:
            workspace.runs_used += runs
            workspace.tokens_used_million += tokens / 1_000_000


class FakeBotRepository:
    def __init__(self) -> None:
        self.bots: dict[str, Bot] = {}
        self.version_history: dict[str, list[BotVersion]] = {}

    async def add(self, bot: Bot, *, version: BotVersion, notes: str = "") -> Bot:
        stored = bot.model_copy(update={"versions": [version]})
        self.bots[bot.bot_id] = stored
        self.version_history[bot.bot_id] = [version]
        return stored

    async def get(self, bot_id: str, workspace_id: str) -> Bot | None:
        bot = self.bots.get(bot_id)
        return bot if bot and bot.workspace_id == workspace_id else None

    async def list(self, workspace_id: str, *, limit: int = 200) -> list[Bot]:
        return [b for b in self.bots.values() if b.workspace_id == workspace_id][:limit]

    async def update(self, bot: Bot, *, version: BotVersion | None, notes: str) -> Bot:
        existing = self.bots.get(bot.bot_id)
        if existing is None or existing.workspace_id != bot.workspace_id:
            raise LookupError(bot.bot_id)
        previous = self.version_history.get(bot.bot_id, [])
        if version is not None:
            # Newest first, and history is never rewritten — the real repository enforces this
            # with a database trigger, so the fake must not be laxer.
            self.version_history[bot.bot_id] = [version, *previous]
        stored = bot.model_copy(update={"versions": self.version_history.get(bot.bot_id, [])})
        self.bots[bot.bot_id] = stored
        return stored

    async def versions(self, bot_id: str, workspace_id: str) -> list[BotVersion]:
        bot = await self.get(bot_id, workspace_id)
        return list(self.version_history.get(bot_id, [])) if bot else []

    async def version(self, version_id: str) -> BotVersion | None:
        return next(
            (v for vs in self.version_history.values() for v in vs if v.version_id == version_id),
            None,
        )


class FakeRunRepository:
    def __init__(self) -> None:
        self.runs: dict[str, Run] = {}
        self.stored_events: list[RunEvent] = []

    async def add(self, run: Run) -> Run:
        # Idempotent by id, exactly like the real one (Rule 18).
        return self.runs.setdefault(run.run_id, run)

    async def get(self, run_id: str, workspace_id: str | None = None) -> Run | None:
        run = self.runs.get(run_id)
        if run is None or (workspace_id is not None and run.workspace_id != workspace_id):
            return None
        return run

    async def list(self, workspace_id: str, *, bot_id: str | None = None, limit: int = 50) -> list[Run]:
        return [
            r
            for r in self.runs.values()
            if r.workspace_id == workspace_id and (bot_id is None or r.bot_id == bot_id)
        ][:limit]

    async def finish(
        self,
        run_id: str,
        *,
        status: RunStatus,
        finished_at: datetime,
        output: str | None = None,
        failure=None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        steps: int | None = None,
        repairs: int | None = None,
        tool_activities: list[dict] | None = None,
    ) -> None:
        """Terminal writes are idempotent, so a cancelled run stays cancelled (Rule 18)."""
        run = self.runs.get(run_id)
        if run is None or run.status.is_terminal:
            return
        self.runs[run_id] = run.model_copy(
            update={
                "status": status,
                "finished_at": finished_at,
                "output": output if output is not None else run.output,
                "failure": failure if failure is not None else run.failure,
                "tokens_in": tokens_in if tokens_in is not None else run.tokens_in,
                "tokens_out": tokens_out if tokens_out is not None else run.tokens_out,
                "steps": steps if steps is not None else run.steps,
                "repairs": repairs if repairs is not None else run.repairs,
                "tool_activities": tool_activities if tool_activities is not None else run.tool_activities,
            }
        )

    async def append_event(self, event: RunEvent, *, allocate_seq: bool = True) -> RunEvent:
        stored = [e for e in self.stored_events if e.run_id == event.run_id]
        seq = max((e.seq for e in stored), default=0) + 1
        persisted = event.model_copy(update={"seq": seq})
        if not any(e.event_id == persisted.event_id for e in self.stored_events):
            self.stored_events.append(persisted)
        return persisted

    async def events(self, run_id: str, *, after_seq: int = 0, limit: int = 500) -> list[RunEvent]:
        return sorted(
            (e for e in self.stored_events if e.run_id == run_id and e.seq > after_seq),
            key=lambda e: e.seq,
        )[:limit]


class FakeConversationRepository:
    def __init__(self) -> None:
        self.conversations: dict[str, Conversation] = {}
        self.messages: dict[str, Message] = {}

    async def add(self, conversation: Conversation) -> Conversation:
        self.conversations[conversation.conversation_id] = conversation
        return conversation

    async def get(self, conversation_id: str, workspace_id: str) -> Conversation | None:
        conversation = self.conversations.get(conversation_id)
        if conversation is None or conversation.workspace_id != workspace_id:
            return None
        messages = [m for m in self.messages.values() if m.conversation_id == conversation_id]
        return conversation.model_copy(update={"messages": messages})

    async def list(self, workspace_id: str, *, limit: int = 100) -> list[Conversation]:
        return [c for c in self.conversations.values() if c.workspace_id == workspace_id][:limit]

    async def add_message(self, message: Message) -> Message:
        self.messages[message.message_id] = message
        return message

    async def update_message(self, message: Message) -> Message:
        if message.message_id not in self.messages:
            raise LookupError(message.message_id)
        self.messages[message.message_id] = message
        return message

    async def get_message(self, message_id: str, workspace_id: str) -> Message | None:
        message = self.messages.get(message_id)
        if message is None:
            return None
        conversation = self.conversations.get(message.conversation_id)
        if conversation is None or conversation.workspace_id != workspace_id:
            return None
        return message

    async def rename(self, conversation_id: str, workspace_id: str, title: str) -> bool:
        conversation = await self.get(conversation_id, workspace_id)
        if conversation is None:
            return False
        self.conversations[conversation_id] = conversation.model_copy(update={"title": title})
        return True

    async def set_pinned(self, conversation_id: str, workspace_id: str, pinned: bool) -> bool:
        conversation = await self.get(conversation_id, workspace_id)
        if conversation is None:
            return False
        self.conversations[conversation_id] = conversation.model_copy(update={"is_pinned": pinned})
        return True

    async def delete(self, conversation_id: str, workspace_id: str) -> bool:
        conversation = await self.get(conversation_id, workspace_id)
        if conversation is None:
            return False
        del self.conversations[conversation_id]
        for message_id in [
            m.message_id for m in self.messages.values() if m.conversation_id == conversation_id
        ]:
            del self.messages[message_id]
        return True


class FakeToolRepository:
    def __init__(self) -> None:
        self.tools: dict[str, Tool] = {}

    async def add(self, tool: Tool, *, version: ToolVersion) -> Tool:
        self.tools[tool.tool_id] = tool.model_copy(update={"versions": [version]})
        return self.tools[tool.tool_id]

    async def get(self, tool_id: str, workspace_id: str) -> Tool | None:
        tool = self.tools.get(tool_id)
        return tool if tool and tool.workspace_id == workspace_id else None

    async def list(self, workspace_id: str, *, only_enabled: bool = False) -> list[Tool]:
        return [
            t
            for t in self.tools.values()
            if t.workspace_id == workspace_id and (t.enabled or not only_enabled)
        ]

    async def update(
        self, tool: Tool, *, version: ToolVersion | None, previous_versions: list[ToolVersion]
    ) -> Tool:
        versions = [version, *previous_versions] if version is not None else previous_versions
        stored = tool.model_copy(update={"versions": versions})
        if version is not None:
            stored = stored.model_copy(update={"version": version.version})
        self.tools[tool.tool_id] = stored
        return stored

    async def delete(self, tool_id: str, workspace_id: str) -> bool:
        tool = await self.get(tool_id, workspace_id)
        if tool is None:
            return False
        del self.tools[tool_id]
        return True


class FakeKnowledgeRepository:
    def __init__(self) -> None:
        self.sources: dict[str, KnowledgeSource] = {}

    async def add(self, source: KnowledgeSource) -> KnowledgeSource:
        self.sources[source.source_id] = source
        return source

    async def get(self, source_id: str, workspace_id: str) -> KnowledgeSource | None:
        source = self.sources.get(source_id)
        return source if source and source.workspace_id == workspace_id else None

    async def list(self, workspace_id: str) -> list[KnowledgeSource]:
        return [s for s in self.sources.values() if s.workspace_id == workspace_id]

    async def save(self, source: KnowledgeSource) -> KnowledgeSource:
        self.sources[source.source_id] = source
        return source

    async def delete(self, source_id: str, workspace_id: str) -> list[str]:
        source = await self.get(source_id, workspace_id)
        if source is None:
            return []
        del self.sources[source_id]
        return [blob.storage_path for blob in source.files]


class FakeRunStarter:
    """Records what the application asked Temporal to do, so tests can assert on it."""

    def __init__(self) -> None:
        self.started: list[tuple[RunAgentRequest, str]] = []
        self.cancelled: list[str] = []
        self.fail_start_with: Exception | None = None

    async def start(self, request: RunAgentRequest, *, workflow_id: str) -> str:
        if self.fail_start_with is not None:
            raise self.fail_start_with
        self.started.append((request, workflow_id))
        return workflow_id

    async def cancel(self, run_id: str) -> bool:
        self.cancelled.append(run_id)
        return True


class InMemoryBlobStore:
    """Blob store for tests: bytes in a dict, so no filesystem is needed."""

    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}

    def path_for(self, workspace_id: str, source_id: str, filename: str) -> Path:  # noqa: F821
        from pathlib import Path

        return Path(f"/memory/{workspace_id}/{source_id}/{filename}")

    def write(self, path, chunks) -> int:
        payload = b"".join(chunks)
        self.blobs[str(path)] = payload
        return len(payload)

    def read(self, path) -> bytes:
        return self.blobs[str(path)]

    def delete(self, path) -> None:
        self.blobs.pop(str(path), None)


def now() -> datetime:
    return datetime.now(UTC)
