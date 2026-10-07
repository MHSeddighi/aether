"""Process-wide dependencies for activities.

Temporal activities are plain async functions with one argument, so the dependencies they need
(a database handle, the agent runner, settings) are resolved from this container at execution time.
The worker entrypoint installs it; tests install their own. Nothing else reaches for globals.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.agents.runner import AgentRunner
from app.infrastructure.config import Settings
from app.infrastructure.database.session import Database


@dataclass(slots=True)
class ActivityContainer:
    settings: Settings
    database: Database
    agent_runner: AgentRunner


_container: ActivityContainer | None = None


def install(container: ActivityContainer) -> None:
    global _container
    _container = container


def get() -> ActivityContainer:
    if _container is None:
        raise RuntimeError(
            "activity container is not installed; the worker entrypoint must call "
            "app.activities.container.install(...)"
        )
    return _container


def reset() -> None:
    """Used by tests to guarantee isolation between cases."""
    global _container
    _container = None
