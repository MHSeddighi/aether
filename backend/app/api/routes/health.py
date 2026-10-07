"""Liveness and readiness.

`/healthz` touches nothing. `/readyz` reports dependency checks; each check is registered by the
component that owns it (Postgres in `infrastructure.database`, Temporal in
`infrastructure.temporal`) so this module stays free of infrastructure imports.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import APIRouter, Request, Response, status

ReadinessCheck = Callable[[], Awaitable[bool]]

router = APIRouter(tags=["health"])


@dataclass(slots=True)
class ReadinessRegistry:
    checks: dict[str, ReadinessCheck]

    def register(self, name: str, check: ReadinessCheck) -> None:
        # A coroutine object here would be silently awaited-and-failed later; reject it now.
        if not callable(check):
            raise TypeError(f"readiness check {name!r} must be callable, got {type(check).__name__}")
        self.checks[name] = check

    async def run(self) -> dict[str, bool]:
        results: dict[str, bool] = {}
        for name, check in self.checks.items():
            try:
                results[name] = bool(await check())
            except Exception:
                results[name] = False
        return results


@router.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", include_in_schema=False)
async def readyz(request: Request, response: Response) -> dict[str, object]:
    registry: ReadinessRegistry = request.app.state.readiness
    results = await registry.run()
    ready = all(results.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ok" if ready else "degraded", "checks": results}
