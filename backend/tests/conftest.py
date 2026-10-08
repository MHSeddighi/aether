"""Shared fixtures."""

from __future__ import annotations

import os

import pytest
from app.api.app import create_app
from app.infrastructure.config import Settings
from fastapi.testclient import TestClient


@pytest.fixture
def settings() -> Settings:
    return Settings(
        environment="test",
        log_level="WARNING",
        jwt_secret="test-secret",
        database_url="postgresql+asyncpg://postgres:postgres@localhost:5432/botbuilder_test",
    )


@pytest.fixture
def app(settings: Settings):
    return create_app(settings)


@pytest.fixture
def client(app) -> TestClient:
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provider keys must never leak from the developer's shell into tests.

    The exception is the opt-in live-provider suite (`LIVE_PROVIDER=...`): that test *needs* the
    real key for the provider it is exercising, so it is kept and every other key is still removed.
    """
    live_key = {
        "openrouter": "OPENROUTER_API_KEY",
        "opencode": "OPENCODE_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
    }.get(os.getenv("LIVE_PROVIDER", ""))
    for var in ("OPENROUTER_API_KEY", "OPENCODE_API_KEY", "DEEPSEEK_API_KEY"):
        if var == live_key:
            continue
        monkeypatch.delenv(var, raising=False)
    os.environ.setdefault("TZ", "UTC")
