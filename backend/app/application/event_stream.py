"""Reading a run's event stream.

    history  → the events a client missed (GET /runs/{id}/events)
    follow   → the same events as they are appended, plus a durable close (GET /runs/{id}/stream)

Two deliberate properties:

* **No broker.** The stream is a read of `run_events`, the durable application state the contract
  already promises (Rule 27/28). There is no in-memory fan-out to build, operate or lose — a client
  that connects after the run finished sees the whole run.
* **Gaps are impossible.** The client sends the last sequence number it saw, and the repository's
  `seq > after_seq` filter plus its gap-free allocation means the resumed stream is exactly the
  events it missed, in order.

Token-level `agent.delta` events are *not* delivered here. They are not persisted (Rule 27) and
shipping them would require a message broker between the worker and the API — precisely the
infrastructure the rules forbid. The frontend's typing state comes from the assistant message's
`isStreaming` flag, which is set when the turn is created and cleared when the result is persisted.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

from app.application.ports import RunRepositoryPort
from app.domain.runs import RunEvent, RunEventType

#: How often the table is polled. The terminal event is written by the worker, so this is the upper
#: bound on how long a client waits to learn the run finished.
DEFAULT_POLL_INTERVAL = 0.4

#: Events fetched per round trip.
BATCH_SIZE = 200

#: A stream cannot outlive its run by much; this is the backstop for a run that never terminates.
MAX_STREAM_SECONDS = 900.0


class RunEventStream:
    """Turns stored run events into an ordered, resumable stream."""

    def __init__(
        self,
        runs: RunRepositoryPort,
        *,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        batch_size: int = BATCH_SIZE,
        max_seconds: float = MAX_STREAM_SECONDS,
    ) -> None:
        self._runs = runs
        self._poll_interval = poll_interval
        self._batch_size = batch_size
        self._max_seconds = max_seconds

    async def history(self, run_id: str, *, after_seq: int = 0, limit: int = 500) -> list[RunEvent]:
        return await self._runs.events(run_id, after_seq=after_seq, limit=limit)

    async def follow(self, run_id: str, *, after_seq: int = 0) -> AsyncIterator[RunEvent]:
        """Yield every event after `after_seq`, then end once a terminal event has been sent.

        Ends early (without a terminal event) only when the run is already terminal and the client is
        fully caught up — a client that reconnects after the run finished gets its backlog and a
        clean close instead of a stream that never ends.
        """
        deadline = datetime.now(UTC) + timedelta(seconds=self._max_seconds)
        seq = after_seq
        while datetime.now(UTC) < deadline:
            batch = await self._runs.events(run_id, after_seq=seq, limit=self._batch_size)
            for event in batch:
                seq = event.seq
                yield event
                if event.type.is_terminal:
                    return
            if not batch:
                run = await self._runs.get(run_id)
                if run is None or run.status.is_terminal:
                    return
                await asyncio.sleep(self._poll_interval)

    @staticmethod
    def is_terminal(event: RunEvent) -> bool:
        return event.type.is_terminal

    @staticmethod
    def terminal_types() -> tuple[str, ...]:
        return tuple(str(t) for t in RunEventType if t.is_terminal)
