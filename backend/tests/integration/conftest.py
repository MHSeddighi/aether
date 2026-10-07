"""Integration tests that need a real Postgres.

Run with:

    export TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/botbuilder_test
    uv run pytest -m integration

`scripts/init.sh` brings up Postgres + Temporal via docker compose and creates that database.
Database tests skip (not fail) when TEST_DATABASE_URL is unset, so the suite stays green on a machine
without Postgres. Workflow tests use Temporal's time-skipping test environment and need no database.
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


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Apply the real Alembic migrations once, so the tests also exercise them (triggers included)."""
    if not TEST_DATABASE_URL:
        return
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest_asyncio.fixture
async def database() -> AsyncIterator[Database]:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    settings = Settings(environment="test", database_url=TEST_DATABASE_URL)
    db = Database(settings)
    yield db
    await db.dispose()


@pytest_asyncio.fixture
async def session(database: Database) -> AsyncIterator:
    """A clean database per test: the migration runs once per session, rows do not survive."""
    async with database.engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE users, workspaces, runs, run_events, messages, "
                "conversations, bots, bot_versions, tools, tool_versions, "
                "knowledge_sources, files, artifacts RESTART IDENTITY CASCADE"
            )
        )
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
