"""Run event routes: history and the live SSE stream.

`GET /runs/{id}/events` is a plain JSON list — that is the reconnect path, and it works even when the
run has long finished.

`GET /runs/{id}/stream` is SSE, served by `sse-starlette` (Rule 27/41: the library does the framing,
the ping comments and the disconnect handling; this module only decides *what* to send). Resumption
uses the standard `Last-Event-ID` header, falling back to `?after_seq=` for clients that cannot set
headers. Each message carries `id: <seq>`, so the browser's own `EventSource` reconnect resends the
last id and the stream resumes exactly where it stopped.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sse_starlette.sse import EventSourceResponse

from app.api.deps import RunServiceDep, WorkspaceId, get_event_stream
from app.api.errors import NotFoundError
from app.application.event_stream import RunEventStream
from app.application.run_service import RunNotFound
from app.domain.runs import RunEvent

router = APIRouter(prefix="/runs", tags=["events"])

#: Emitted by `sse-starlette` as a comment so proxies keep the connection open without the client
#: seeing an event. Must be comfortably shorter than a typical proxy idle timeout.
HEARTBEAT_SECONDS = 15.0

EventStreamDep = Annotated[RunEventStream, Depends(get_event_stream)]


@router.get("/{run_id}/events")
async def run_events(
    run_id: str,
    service: RunServiceDep,
    stream: EventStreamDep,
    workspace: WorkspaceId,
    after_seq: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> list[dict]:
    """Persisted events after `after_seq`, oldest first. This is the reconnect path."""
    await _own_run(service, workspace, run_id)
    events = await stream.history(run_id, after_seq=after_seq, limit=limit)
    return [event.to_payload() for event in events]


@router.get("/{run_id}/stream")
async def stream_run(
    run_id: str,
    service: RunServiceDep,
    stream: EventStreamDep,
    workspace: WorkspaceId,
    after_seq: Annotated[int, Query(ge=0)] = 0,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> EventSourceResponse:
    """Live SSE.

    `Last-Event-ID` wins over `after_seq` when both are present: the browser sets it automatically on
    reconnect, and honouring it is the whole point of a resumable stream.
    """
    await _own_run(service, workspace, run_id)
    resume_from = _resume_point(after_seq, last_event_id)

    async def publisher():
        async for event in stream.follow(run_id, after_seq=resume_from):
            yield _to_sse(event)

    return EventSourceResponse(
        publisher(),
        ping=HEARTBEAT_SECONDS,
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


async def _own_run(service: RunServiceDep, workspace: str, run_id: str) -> None:
    """Authorisation before any event is read: an unknown run is a 404, not an empty stream."""
    try:
        await service.get(workspace, run_id)
    except RunNotFound as exc:
        raise NotFoundError("run", run_id) from exc


def _resume_point(after_seq: int, last_event_id: str | None) -> int:
    if not last_event_id:
        return after_seq
    try:
        return max(int(last_event_id), 0)
    except ValueError:
        # A malformed header must not break the stream; fall back to the query parameter.
        return after_seq


def _to_sse(event: RunEvent) -> dict:
    """One SSE message: `id` is the sequence number, `event` is the type, `data` is the payload."""
    return {
        "id": str(event.seq),
        "event": str(event.type),
        "data": json.dumps(event.to_payload(), default=str),
    }
