"""Build use cases: start a durable build, read its state, cancel it.

Mirrors `RunService`: the use case persists the build request and starts the workflow, but never
executes anything itself. The workflow and its activities do all the real work.
"""

from __future__ import annotations

from app.application.bot_service import BotNotFound, BotService
from app.application.ports import BuildRepositoryPort, BuildStarter
from app.domain.failures import ValidationFailure
from app.domain.ids import new_id


class BuildNotFound(Exception):
    def __init__(self, build_id: str) -> None:
        super().__init__(f"build {build_id!r} was not found")
        self.build_id = build_id


class BuildNotStartable(Exception):
    def __init__(self, bot_id: str, reason: str) -> None:
        super().__init__(f"bot {bot_id!r} cannot be built: {reason}")
        self.bot_id = bot_id
        self.reason = reason


class BuildService:
    def __init__(self, builds: BuildRepositoryPort, bots: BotService, starter: BuildStarter) -> None:
        self._builds = builds
        self._bots = bots
        self._starter = starter

    async def start(self, workspace_id: str, *, bot_id: str, specification: str = "") -> str:
        """Persist a pending build, then start its workflow. Returns the build id."""
        try:
            version = await self._bots.latest_version_id(workspace_id, bot_id)
        except BotNotFound as exc:
            raise BuildNotStartable(bot_id, "not found") from exc
        except ValidationFailure as exc:
            raise BuildNotStartable(bot_id, str(exc.message)) from exc

        build_id = new_id("build")
        build = await self._builds.add_build(
            {
                "build_id": build_id,
                "workspace_id": workspace_id,
                "bot_id": bot_id,
                "bot_version_id": version.version_id,
                "model_config": version.model_spec.model_dump(mode="json"),
                "specification": specification or "",
                "status": "pending",
            }
        )

        from app.workflows.build_bot import BuildSpec

        await self._starter.start(
            BuildSpec(
                build_id=build_id,
                workspace_id=workspace_id,
                bot_id=bot_id,
                bot_version_id=version.version_id,
                specification=specification or "",
            ),
            workflow_id=f"build:{build_id}",
        )
        return build["build_id"]

    async def get(self, workspace_id: str, build_id: str) -> dict:
        build = await self._builds.get_build(build_id, workspace_id)
        if build is None:
            raise BuildNotFound(build_id)
        checkpoints = await self._builds.get_checkpoints(build_id)
        return {**build, "checkpoints": checkpoints}

    async def cancel(self, workspace_id: str, build_id: str) -> dict:
        build = await self._builds.get_build(build_id, workspace_id)
        if build is None:
            raise BuildNotFound(build_id)
        await self._builds.finish_build(build_id, status="cancelled")
        await self._starter.cancel(build_id)
        return {"build_id": build_id, "status": "cancelled"}
