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
    """Provider keys must never leak from the developer's shell into tests."""
    for var in ("OPENROUTER_API_KEY", "OPENCODE_API_KEY", "DEEPSEEK_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    os.environ.setdefault("TZ", "UTC")
