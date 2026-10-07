"""FastAPI application factory.

The app wires routers and infrastructure together and nothing else: use cases are constructed here
and injected, so tests can build an app with fakes.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.middleware import RequestIdMiddleware
from app.api.routes import (
    auth,
    bots,
    conversations,
    events,
    health,
    knowledge,
    models,
    runs,
    tools,
)
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.database.session import Database
from app.infrastructure.logging_config import configure_logging, get_logger
from app.infrastructure.temporal.client import TemporalConnection

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Own the process-wide connections and close them on shutdown."""
    connection: TemporalConnection = app.state.temporal
    try:
        yield
    finally:
        await app.state.database.dispose()
        await connection.aclose()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.readiness = health.ReadinessRegistry(checks={})
    app.state.database = Database(settings)
    # One lazily-connected Temporal client per process: `POST /runs` needs it on every call, so it
    # must not reconnect each time (Rule 14).
    app.state.temporal = TemporalConnection(settings)
    _register_readiness_probes(app)

    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id"],
    )

    register_exception_handlers(app)
    app.include_router(health.router)

    _register_routers(app, settings)
    logger.info("application created", extra={"environment": settings.environment})
    return app


def _register_readiness_probes(app: FastAPI) -> None:
    """Each dependency registers its own check, so the route module stays infrastructure-free."""
    app.state.readiness.register("postgres", app.state.database.ping)
    app.state.readiness.register("temporal", lambda: _temporal_ping(app))


async def _temporal_ping(app: FastAPI) -> bool:
    try:
        await app.state.temporal.ping()
        return True
    except Exception:
        logger.warning("temporal ping failed", exc_info=True)
        return False


def _register_routers(app: FastAPI, settings: Settings) -> None:
    """Every router the product exposes, mounted under the versioned prefix."""
    for module in (auth, bots, tools, knowledge, conversations, runs, events, models):
        app.include_router(module.router, prefix=settings.api_prefix)
    logger.info("routers registered", extra={"prefix": settings.api_prefix, "count": 8})
