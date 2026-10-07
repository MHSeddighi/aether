"""FastAPI application factory.

The app wires routers and infrastructure together and nothing else: use cases are constructed here
and injected, so tests can build an app with fakes.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.middleware import RequestIdMiddleware
from app.api.routes import health
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.logging_config import configure_logging, get_logger

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    app.state.settings = settings
    app.state.readiness = health.ReadinessRegistry(checks={})

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


def _register_routers(app: FastAPI, settings: Settings) -> None:
    """Feature routers are added as their state lands (States 2, 3, 8, 9)."""
    return None
