"""Process-wide dependencies for activities.

Temporal activities are plain async functions with one argument, so the dependencies they need
(a database handle, settings, and *factories* for the model client and tool executor) are resolved
from this container at execution time. The worker entrypoint installs it; tests install their own.

The container holds factories rather than instances on purpose: a run carries its own model
configuration (Rule 36), so the client must be built per run, not once per worker.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from app.domain.models import ModelConfig
from app.infrastructure.config import Settings
from app.infrastructure.database.session import Database
from app.infrastructure.models.base import ModelClient
from app.tools.base import ToolExecutor

ModelClientBuilder = Callable[[ModelConfig], ModelClient]
ToolExecutorBuilder = Callable[[], ToolExecutor]


@dataclass(slots=True)
class ActivityContainer:
    settings: Settings
    database: Database
    model_client_builder: ModelClientBuilder
    #: State 7 replaces this with the real ToolGateway; `None` means "tools are refused".
    tool_executor_builder: ToolExecutorBuilder | None = field(default=None)


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
