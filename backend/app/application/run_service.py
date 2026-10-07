"""Run use cases: start, inspect, cancel.

This is the control plane for durable execution. It never runs an agent and never calls a model: it
snapshots what a run needs, hands that snapshot to `RunStarter`, and reads back state and events.
That is what makes a run reproducible (Rule 36) and what makes the HTTP request fast (Rule 14).

Three rules shape this file:

* **Idempotency.** `RunRepository.add` and the stable workflow id mean a retried `POST /runs` cannot
  start a second execution (Rule 18).
* **Cancellation is persisted before it is requested.** Temporal closes a cancelled workflow
  immediately and abandons workflow-side cleanup, so the caller writes `cancelled` first (see
  `docs/implementation-progress.md`, decision 4).
* **Terminal states are final.** `finish` is idempotent, so cancelling a finished run is a no-op
  rather than an error the frontend has to special-case.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.application.bot_service import BotService
from app.application.ports import ConversationRepositoryPort, RunRepositoryPort, RunStarter
from app.domain.bots import BotStatus, BotVersion
from app.domain.conversations import HISTORY_WINDOW
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.ids import new_id
from app.domain.runs import Run, RunEvent, RunEventType, RunStatus


class RunNotFound(Exception):
    def __init__(self, run_id: str) -> None:
        super().__init__(f"run {run_id!r} was not found")
        self.run_id = run_id


class BotNotRunnable(Exception):
    """The bot exists but cannot start a run (disabled, archived, or has no version)."""

    def __init__(self, bot_id: str, reason: str) -> None:
        super().__init__(f"bot {bot_id!r} cannot start a run: {reason}")
        self.bot_id = bot_id
        self.reason = reason


class StartRunCommand:
    """Everything needed to start one run. Small on purpose: no model, no provider, no options."""

    __slots__ = (
        "assistant_message_id",
        "attachments",
        "bot_id",
        "conversation_id",
        "input",
        "timeout_seconds",
    )

    def __init__(
        self,
        *,
        bot_id: str,
        input: str,
        conversation_id: str | None = None,
        assistant_message_id: str | None = None,
        attachments: tuple[dict, ...] = (),
        timeout_seconds: float | None = None,
    ) -> None:
        self.bot_id = bot_id
        self.input = input
        self.conversation_id = conversation_id
        self.assistant_message_id = assistant_message_id
        self.attachments = attachments
        self.timeout_seconds = timeout_seconds


class RunService:
    def __init__(
        self,
        runs: RunRepositoryPort,
        bots: BotService,
        starter: RunStarter,
        conversations: ConversationRepositoryPort | None = None,
        *,
        default_timeout_seconds: float = 180.0,
    ) -> None:
        self._runs = runs
        self._bots = bots
        self._starter = starter
        self._conversations = conversations
        self._default_timeout = default_timeout_seconds

    # --- use cases --------------------------------------------------------

    async def start(self, workspace_id: str, command: StartRunCommand) -> Run:
        """Persist a queued run, then start its workflow. Returns the queued run (Rule 14)."""
        version = await self._runnable_version(workspace_id, command.bot_id)
        timeout = command.timeout_seconds or self._default_timeout
        now = datetime.now(UTC)
        run = Run(
            run_id=new_id("run"),
            workspace_id=workspace_id,
            bot_id=command.bot_id,
            bot_version_id=version.version_id,
            bot_version=version.version,
            # The model configuration is captured here, not read again inside the workflow, so the
            # run can be reproduced and compared later (Rule 36).
            model=version.model_spec,
            status=RunStatus.QUEUED,
            input=command.input,
            conversation_id=command.conversation_id,
            assistant_message_id=command.assistant_message_id,
            knowledge_sources=list(version.knowledge_ids),
            created_at=now,
            deadline_at=now + timedelta(seconds=timeout),
        )
        run = await self._runs.add(run)

        from app.workflows.contracts import RunAgentRequest  # local import keeps the port module light

        request = RunAgentRequest(
            run_id=run.run_id,
            workspace_id=workspace_id,
            bot_id=run.bot_id,
            bot_version_id=run.bot_version_id,
            input=run.input,
            conversation_id=run.conversation_id,
            assistant_message_id=run.assistant_message_id,
            history=await self._history(workspace_id, run),
            attachments=tuple(command.attachments),
            timeout_seconds=timeout,
        )
        await self._starter.start(request, workflow_id=f"run:{run.run_id}")
        return run

    async def get(self, workspace_id: str, run_id: str) -> Run:
        run = await self._runs.get(run_id, workspace_id)
        if run is None:
            raise RunNotFound(run_id)
        return run

    async def list(self, workspace_id: str, *, bot_id: str | None = None, limit: int = 50) -> list[Run]:
        return await self._runs.list(workspace_id, bot_id=bot_id, limit=limit)

    async def cancel(self, workspace_id: str, run_id: str) -> Run:
        """Cancel a queued or running run.

        The durable `cancelled` state is written *first* (Rule 19: cancellation is its own outcome,
        not a failure), then Temporal is asked to stop. If the workflow is already gone — finished, or
        never started — the run is already terminal and this is a no-op.
        """
        run = await self.get(workspace_id, run_id)
        if run.status.is_terminal:
            return run

        now = datetime.now(UTC)
        await self._runs.finish(run_id, status=RunStatus.CANCELLED, finished_at=now)
        await self._runs.append_event(
            RunEvent(
                event_id=new_id("evt"),
                run_id=run_id,
                seq=1,
                type=RunEventType.RUN_CANCELLED,
                data={"reason": "cancelled by user"},
            )
        )
        await self._starter.cancel(run_id)
        return await self.get(workspace_id, run_id)

    async def events(self, workspace_id: str, run_id: str, *, after_seq: int = 0) -> list[RunEvent]:
        await self.get(workspace_id, run_id)  # ownership check before reading events
        return await self._runs.events(run_id, after_seq=after_seq)

    # --- helpers ----------------------------------------------------------

    async def _runnable_version(self, workspace_id: str, bot_id: str) -> BotVersion:
        from app.application.bot_service import BotNotFound

        try:
            bot = await self._bots.get(workspace_id, bot_id)
        except BotNotFound as exc:
            raise BotNotRunnable(bot_id, "not found") from exc
        if not bot.enabled:
            raise BotNotRunnable(bot_id, "the bot is disabled")
        if bot.status is BotStatus.ARCHIVED:
            raise BotNotRunnable(bot_id, "the bot is archived")
        latest = bot.latest_version()
        if latest is None:
            raise BotNotRunnable(bot_id, "the bot has no version")
        return latest

    async def _history(self, workspace_id: str, run: Run) -> tuple[tuple[str, str], ...]:
        """Prior turns of the conversation, oldest first, so the agent keeps context."""
        if self._conversations is None or run.conversation_id is None:
            return ()
        conversation = await self._conversations.get(run.conversation_id, workspace_id)
        if conversation is None:
            return ()
        turns = [
            (str(message.sender), message.content)
            for message in conversation.messages
            if message.content.strip() and not message.is_streaming
        ]
        return tuple(turns[-HISTORY_WINDOW:])

    @staticmethod
    def assert_input(text: str) -> str:
        value = (text or "").strip()
        if not value:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                "input must not be empty",
                details={"field": "input"},
            )
        return value


def is_deterministic(version: BotVersion) -> bool:
    """A version that never reaches the model gateway (Rule 4/36)."""
    return version.model_spec.provider.value == "deterministic"


__all__ = ["BotNotRunnable", "RunNotFound", "RunService", "StartRunCommand"]
