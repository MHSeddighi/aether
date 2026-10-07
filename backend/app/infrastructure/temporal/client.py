"""Temporal client construction.

One place that knows how to reach Temporal; everything else receives a connected client.
"""

from __future__ import annotations

import asyncio

from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter

from app.infrastructure.config import Settings
from app.infrastructure.logging_config import get_logger

logger = get_logger(__name__)


def workflow_id_for_run(run_id: str) -> str:
    """Stable workflow id so a retried API call reuses the same execution (Rule 18)."""
    return f"run:{run_id}"


def workflow_id_for_build(build_id: str) -> str:
    return f"build:{build_id}"


def workflow_id_for_indexing(source_id: str) -> str:
    return f"index:{source_id}"


async def connect(settings: Settings) -> Client:
    """Connect with the pydantic-aware data converter, so domain models cross the boundary intact."""
    tls = bool(settings.temporal_tls)
    api_key = settings.temporal_api_key.get_secret_value() if settings.temporal_api_key else None
    client = await Client.connect(
        settings.temporal_host,
        namespace=settings.temporal_namespace,
        tls=tls,
        api_key=api_key,
        data_converter=pydantic_data_converter,
    )
    logger.info(
        "temporal client connected",
        extra={"host": settings.temporal_host, "namespace": settings.temporal_namespace},
    )
    return client


class TemporalConnection:
    """Lazily connects one client per process and reuses it.

    The API is the only long-lived Temporal user in the control plane, and opening a client per
    request would add a gRPC handshake to every `POST /runs`. The lock makes the first concurrent
    requests wait for a single connect instead of racing.
    """

    __slots__ = ("_client", "_lock", "_settings")

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Client | None = None
        self._lock = asyncio.Lock()

    async def get(self) -> Client:
        if self._client is not None:
            return self._client
        async with self._lock:
            if self._client is None:
                self._client = await connect(self._settings)
        return self._client

    async def ping(self) -> bool:
        client = await self.get()
        await client.service_client.check_health()
        return True

    async def aclose(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.close()
