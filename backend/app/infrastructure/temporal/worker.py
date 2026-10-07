"""Worker entrypoint.

    python -m app.infrastructure.temporal.worker --queues agent
    python -m app.infrastructure.temporal.worker --queues build

Task queues come from settings, so the agent and build workers are the same image with different
configuration (Rule 3).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import signal
from dataclasses import dataclass
from datetime import timedelta

from temporalio.worker import Worker

from app.activities.container import (
    ActivityContainer,
    ModelClientBuilder,
    ToolExecutorBuilder,
    install,
)
from app.activities.persistence import (
    cancel_run,
    execute_agent,
    fail_run,
    load_bot_version,
    persist_run_result,
    start_run,
)
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.database.session import Database
from app.infrastructure.logging_config import configure_logging, get_logger
from app.infrastructure.models.gateway import build_model_client
from app.infrastructure.temporal.client import connect
from app.tools.gateway import build_tool_gateway
from app.workflows.run_agent import RunAgentWorkflow

logger = get_logger(__name__)

AGENT_ACTIVITIES = [
    load_bot_version,
    start_run,
    execute_agent,
    persist_run_result,
    fail_run,
    cancel_run,
]


@dataclass(slots=True)
class WorkerRole:
    """Which task queues and activities this process serves."""

    name: str
    task_queues: list[str]
    workflows: list[type]
    activities: list


def agent_role(settings: Settings) -> WorkerRole:
    return WorkerRole(
        name="agent",
        task_queues=[settings.temporal_task_queue],
        workflows=[RunAgentWorkflow],
        activities=AGENT_ACTIVITIES,
    )


def build_role(settings: Settings) -> WorkerRole:
    """Build worker. Its activities arrive with State 10 (BuildBotWorkflow); it polls meanwhile."""
    return WorkerRole(
        name="build",
        task_queues=[settings.temporal_build_task_queue],
        workflows=[],
        activities=[],
    )


def role_for(name: str, settings: Settings) -> WorkerRole:
    return agent_role(settings) if name == "agent" else build_role(settings)


def build_container(
    settings: Settings,
    database: Database,
    *,
    model_client_builder: ModelClientBuilder | None = None,
    tool_executor_builder: ToolExecutorBuilder | None = None,
) -> ActivityContainer:
    """Assemble the activity container. Factories, not instances: a run builds its own client."""
    builder = model_client_builder or (lambda config: build_model_client(settings, config))
    container = ActivityContainer(
        settings=settings,
        database=database,
        model_client_builder=builder,
        tool_executor_builder=tool_executor_builder,
    )
    install(container)
    return container


async def run_worker(role: WorkerRole, settings: Settings) -> None:
    configure_logging(settings.log_level)
    if not role.activities:
        logger.warning("role has no activities registered yet", extra={"role": role.name})
    database = Database(settings)
    tool_gateway = build_tool_gateway(settings)
    build_container(settings, database, tool_executor_builder=lambda: tool_gateway)
    client = await connect(settings)

    workers = [
        Worker(
            client,
            task_queue=task_queue,
            workflows=role.workflows,
            activities=role.activities,
            graceful_shutdown_timeout=timedelta(seconds=15),
        )
        for task_queue in role.task_queues
    ]

    logger.info(
        "worker started", extra={"role": role.name, "task_queues": role.task_queues, "pid": os.getpid()}
    )
    try:
        await asyncio.gather(*(worker.run() for worker in workers))
    except asyncio.CancelledError:
        logger.info("worker shutting down", extra={"role": role.name})
    finally:
        await database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Temporal worker")
    parser.add_argument(
        "--queues",
        default="agent",
        choices=["agent", "build", "all"],
        help="which task queues this process polls",
    )
    parser.add_argument("--log-level", default=None)
    args = parser.parse_args()

    settings = get_settings()
    if args.log_level:
        settings.log_level = args.log_level

    roles = (
        [agent_role(settings), build_role(settings)]
        if args.queues == "all"
        else [role_for(args.queues, settings)]
    )

    async def _main() -> None:
        loop = asyncio.get_running_loop()
        running = asyncio.gather(*(run_worker(role, settings) for role in roles))
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, running.cancel)
        await running

    asyncio.run(_main())


if __name__ == "__main__":
    main()
