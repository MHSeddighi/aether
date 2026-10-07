"""Integration tests that need a real Postgres.

Run with:

    export TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/botbuilder_test
    uv run pytest -m integration

`scripts/init.sh` brings up Postgres + Temporal via docker compose and creates that database.
Tests are skipped (not failed) when no database is configured, so the unit suite stays green on a
machine without Postgres.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from app.infrastructure.config import Settings
from app.infrastructure.database.session import Database
from sqlalchemy import text

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def pytest_collection_modifyitems(items):
    if TEST_DATABASE_URL:
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL is not set")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest_asyncio.fixture(scope="session")
def migrated_database_url() -> str:
    """Apply the real Alembic migrations, so the tests also exercise them (triggers included)."""
    url = TEST_DATABASE_URL or ""
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("sqlalchemy.url", url)
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    return url


@pytest_asyncio.fixture
async def database(migrated_database_url: str) -> AsyncIterator[Database]:
    settings = Settings(environment="test", database_url=migrated_database_url)
    db = Database(settings)
    yield db
    await db.dispose()


@pytest_asyncio.fixture
async def session(database: Database) -> AsyncIterator:
    async with database.session() as active:
        yield active


async def seed_workspace(session, workspace_id: str = "ws_test") -> None:
    await session.execute(
        text(
            "INSERT INTO workspaces (id, name, plan, runs_used, runs_limit,"
            " tokens_used_million, tokens_limit_million)"
            " VALUES (:id, 'Acme AI Workspace', 'Team Pro', 0, 5000, 0, 50)"
        ),
        {"id": workspace_id},
    )
    await session.commit()
