"""Run persistence.

`append_event` is the heart of the SSE contract: the sequence number is allocated under a row lock on
the run, so concurrent activities cannot produce duplicates or gaps (Rule 28), and a replayed
activity attempt is a no-op because the `(run_id, seq, type)` pair already exists.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.failures import RunFailure
from app.domain.models import ModelConfig
from app.domain.runs import Run, RunEvent, RunEventType, RunStatus
from app.infrastructure.database.tables import RunEventRow, RunRow


def to_domain(row: RunRow) -> Run:
    return Run(
        run_id=row.id,
        workspace_id=row.workspace_id,
        bot_id=row.bot_id,
        bot_version_id=row.bot_version_id,
        bot_version=row.bot_version,
        model=ModelConfig.model_validate(row.model_config),
        status=RunStatus(row.status),
        input=row.input,
        conversation_id=row.conversation_id,
        assistant_message_id=row.assistant_message_id,
        workflow_id=row.workflow_id,
        failure=RunFailure.model_validate(row.failure) if row.failure else None,
        output=row.output,
        tool_activities=list(row.tool_activities or []),
        knowledge_sources=list(row.knowledge_sources or []),
        tokens_in=row.tokens_in,
        tokens_out=row.tokens_out,
        steps=row.steps,
        repairs=row.repairs,
        created_at=row.created_at,
        started_at=row.started_at,
        finished_at=row.finished_at,
        deadline_at=row.deadline_at,
    )


def event_to_domain(row: RunEventRow) -> RunEvent:
    return RunEvent(
        event_id=row.id,
        run_id=row.run_id,
        seq=row.seq,
        type=RunEventType(row.type),
        ts=row.created_at,
        data=row.data or {},
    )


class RunRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, run: Run) -> Run:
        """Insert a queued run. Idempotent by id so an API retry cannot double-start (Rule 18)."""
        existing = await self._session.get(RunRow, run.run_id)
        if existing is not None:
            return to_domain(existing)
        self._session.add(
            RunRow(
                id=run.run_id,
                workspace_id=run.workspace_id,
                bot_id=run.bot_id,
                bot_version_id=run.bot_version_id,
                bot_version=run.bot_version,
                model_config=run.model.model_dump(mode="json"),
                status=str(run.status),
                input=run.input,
                conversation_id=run.conversation_id,
                assistant_message_id=run.assistant_message_id,
                workflow_id=run.workflow_id,
                output=run.output,
                tool_activities=run.tool_activities,
                knowledge_sources=run.knowledge_sources,
                tokens_in=run.tokens_in,
                tokens_out=run.tokens_out,
                steps=run.steps,
                repairs=run.repairs,
                created_at=run.created_at,
                started_at=run.started_at,
                finished_at=run.finished_at,
                deadline_at=run.deadline_at,
            )
        )
        await self._session.flush()
        return run

    async def get(self, run_id: str, workspace_id: str | None = None) -> Run | None:
        row = await self._session.get(RunRow, run_id)
        if row is None or (workspace_id is not None and row.workspace_id != workspace_id):
            return None
        return to_domain(row)

    async def list(self, workspace_id: str, *, bot_id: str | None = None, limit: int = 50) -> list[Run]:
        query = select(RunRow).where(RunRow.workspace_id == workspace_id)
        if bot_id:
            query = query.where(RunRow.bot_id == bot_id)
        result = await self._session.execute(query.order_by(RunRow.created_at.desc()).limit(limit))
        return [to_domain(row) for row in result.scalars().all()]

    async def mark_running(self, run_id: str, *, workflow_id: str, started_at: datetime) -> None:
        row = await self._session.get(RunRow, run_id)
        if row is not None and row.status == str(RunStatus.QUEUED):
            row.status = str(RunStatus.RUNNING)
            row.workflow_id = workflow_id
            row.started_at = started_at

    async def finish(
        self,
        run_id: str,
        *,
        status: RunStatus,
        finished_at: datetime,
        output: str | None = None,
        failure: RunFailure | None = None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        steps: int | None = None,
        repairs: int | None = None,
        tool_activities: list[dict] | None = None,
    ) -> None:
        """Idempotent terminal write: re-running it overwrites with the same values."""
        row = await self._session.get(RunRow, run_id)
        if row is None or row.finished_at is not None:
            return
        row.status = str(status)
        row.finished_at = finished_at
        row.output = output if output is not None else row.output
        row.failure = failure.model_dump(mode="json") if failure else None
        if tokens_in is not None:
            row.tokens_in = tokens_in
        if tokens_out is not None:
            row.tokens_out = tokens_out
        if steps is not None:
            row.steps = steps
        if repairs is not None:
            row.repairs = repairs
        if tool_activities is not None:
            row.tool_activities = tool_activities

    async def append_event(self, event: RunEvent, *, allocate_seq: bool = True) -> RunEvent:
        """Append an event. Returns the stored event (with its final `seq`).

        Deltas are never persisted (Rule 27); callers must not ask to store them.
        """
        if not event.type.is_persisted:
            raise ValueError(f"{event.type} events must not be persisted")

        if allocate_seq:
            seq = await self._next_seq(event.run_id)
        else:
            seq = event.seq

        # `ON CONFLICT DO NOTHING` without a target covers *every* unique constraint, so a replayed
        # activity is a no-op whether it collides on the event id or on (run_id, seq).
        statement = (
            pg_insert(RunEventRow)
            .values(
                id=event.event_id,
                run_id=event.run_id,
                seq=seq,
                type=str(event.type),
                data=event.data,
                created_at=event.ts,
            )
            .on_conflict_do_nothing()
        )
        result = await self._session.execute(statement)
        if result.rowcount == 0:
            # A replay must report the sequence number that was actually stored.
            existing = await self._event_row(event.event_id)
            if existing is not None:
                return event_to_domain(existing)
        return event.model_copy(update={"seq": seq})

    async def _event_row(self, event_id: str) -> RunEventRow | None:
        result = await self._session.execute(select(RunEventRow).where(RunEventRow.id == event_id))
        return result.scalar_one_or_none()

    async def events(self, run_id: str, *, after_seq: int = 0, limit: int = 500) -> list[RunEvent]:
        result = await self._session.execute(
            select(RunEventRow)
            .where(RunEventRow.run_id == run_id, RunEventRow.seq > after_seq)
            .order_by(RunEventRow.seq)
            .limit(limit)
        )
        return [event_to_domain(row) for row in result.scalars().all()]

    async def last_seq(self, run_id: str) -> int:
        result = await self._session.execute(
            select(func.coalesce(func.max(RunEventRow.seq), 0)).where(RunEventRow.run_id == run_id)
        )
        return int(result.scalar_one())

    async def _next_seq(self, run_id: str) -> int:
        """Lock the run row, then read the current maximum: serialises concurrent activities."""
        await self._session.execute(select(RunRow.id).where(RunRow.id == run_id).with_for_update())
        return await self.last_seq(run_id) + 1
