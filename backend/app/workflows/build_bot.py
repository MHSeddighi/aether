"""BuildBotWorkflow: durable build pipeline with checkpoints.

    spec
      ↓ checkpoint 1
    codegen
      ↓ checkpoint 2
    validate
      ↓ checkpoint 3
    docker_build
      ↓ checkpoint 4
    sandbox_test
      ↓ checkpoint 5
    publish
      ↓ COMPLETE

Every expensive/irreversible transition has a durable state/checkpoint (Rule 31). The workflow
never makes external calls directly; they are delegated to activities.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum

from pydantic import BaseModel
from temporalio import workflow
from temporalio.common import RetryPolicy

from app.infrastructure.temporal.errors import failure_from_exception, is_cancellation


class BuildStep(StrEnum):
    """The build state machine. Only forward transitions are allowed."""

    SPEC = "spec"
    CODEGEN = "codegen"
    VALIDATE = "validate"
    DOCKER_BUILD = "docker_build"
    SANDBOX_TEST = "sandbox_test"
    PUBLISH = "publish"


class BuildStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BuildSpec(BaseModel):
    """Immutable input to the build, captured at the start."""

    build_id: str
    workspace_id: str
    bot_id: str
    bot_version_id: str
    specification: str = ""
    base_image: str = "python:3.12-slim"


@dataclass(frozen=True, slots=True)
class BuildOutcome:
    build_id: str
    status: str
    image_tag: str | None = None
    image_digest: str | None = None


# Retry policies for each activity type.
SPEC_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
    maximum_attempts=3,
)
CODEGEN_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=60),
    maximum_attempts=2,
)
VALIDATE_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
    maximum_attempts=3,
)
DOCKER_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=5),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=300),
    maximum_attempts=2,
)
SANDBOX_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=60),
    maximum_attempts=2,
)
PUBLISH_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=60),
    maximum_attempts=3,
)


# Activities are imported lazily to keep the workflow sandbox clean.
with workflow.unsafe.imports_passed_through():
    from app.activities import build as build_activities


@workflow.defn(name="BuildBotWorkflow")
class BuildBotWorkflow:
    def __init__(self) -> None:
        self._request: BuildSpec | None = None

    @workflow.run
    async def run(self, request: BuildSpec) -> BuildOutcome:
        self._request = request
        # The step currently in flight, so a failure is checkpointed against the step that actually
        # failed rather than a meaningless sentinel (Rule 13: "what already happened / what failed").
        step = BuildStep.SPEC
        try:
            # `load_build_spec` returns plain data (a dict) to keep the durable history trivially
            # serialisable, so the workflow treats the spec as a mapping, exactly like `run_agent`.
            spec = await self._load_spec(request)
            await self._persist_checkpoint(spec["build_id"], BuildStep.SPEC, "succeeded", {})

            step = BuildStep.CODEGEN
            codegen = await self._generate_code(spec)
            await self._persist_checkpoint(spec["build_id"], BuildStep.CODEGEN, "succeeded", codegen)

            step = BuildStep.VALIDATE
            validated = await self._validate_code(spec, codegen)
            await self._persist_checkpoint(spec["build_id"], BuildStep.VALIDATE, "succeeded", validated)

            step = BuildStep.DOCKER_BUILD
            built = await self._docker_build(spec, codegen)
            await self._persist_checkpoint(spec["build_id"], BuildStep.DOCKER_BUILD, "succeeded", built)

            step = BuildStep.SANDBOX_TEST
            tested = await self._sandbox_test(spec, built)
            await self._persist_checkpoint(spec["build_id"], BuildStep.SANDBOX_TEST, "succeeded", tested)

            step = BuildStep.PUBLISH
            published = await self._publish(spec, built)
            await self._persist_checkpoint(spec["build_id"], BuildStep.PUBLISH, "succeeded", published)

        except Exception as exc:
            if is_cancellation(exc):
                # `BuildService.cancel` writes the durable `cancelled` status before asking Temporal
                # to stop (same split as runs), so the workflow side only logs and propagates.
                workflow.logger.info("build cancelled", extra={"build_id": request.build_id})
                raise
            failure = failure_from_exception(exc)
            await self._record_failure(request.build_id, step, failure.to_dict())
            raise

        return BuildOutcome(
            build_id=request.build_id,
            status="succeeded",
            image_tag=published["image_tag"],
            image_digest=published["image_digest"],
        )

    async def _load_spec(self, request: BuildSpec) -> dict:
        return await workflow.execute_activity(
            build_activities.load_build_spec,
            request,
            start_to_close_timeout=timedelta(seconds=30),
            schedule_to_close_timeout=timedelta(seconds=120),
            retry_policy=SPEC_RETRY,
        )

    async def _generate_code(self, spec: dict) -> dict:
        return await workflow.execute_activity(
            build_activities.generate_code,
            spec,
            start_to_close_timeout=timedelta(seconds=60),
            schedule_to_close_timeout=timedelta(seconds=180),
            retry_policy=CODEGEN_RETRY,
        )

    async def _validate_code(self, spec: dict, codegen: dict) -> dict:
        return await workflow.execute_activity(
            build_activities.validate_code,
            {"spec": spec, "codegen": codegen},
            start_to_close_timeout=timedelta(seconds=60),
            schedule_to_close_timeout=timedelta(seconds=180),
            retry_policy=VALIDATE_RETRY,
        )

    async def _docker_build(self, spec: dict, codegen: dict) -> dict:
        return await workflow.execute_activity(
            build_activities.docker_build,
            {"spec": spec, "codegen": codegen},
            start_to_close_timeout=timedelta(minutes=10),
            schedule_to_close_timeout=timedelta(minutes=20),
            heartbeat_timeout=timedelta(seconds=30),
            retry_policy=DOCKER_RETRY,
        )

    async def _sandbox_test(self, spec: dict, built: dict) -> dict:
        return await workflow.execute_activity(
            build_activities.sandbox_test,
            {"spec": spec, "built": built},
            start_to_close_timeout=timedelta(minutes=5),
            schedule_to_close_timeout=timedelta(minutes=10),
            heartbeat_timeout=timedelta(seconds=30),
            retry_policy=SANDBOX_RETRY,
        )

    async def _publish(self, spec: dict, built: dict) -> dict:
        return await workflow.execute_activity(
            build_activities.publish_artifact,
            {"spec": spec, "built": built},
            start_to_close_timeout=timedelta(seconds=60),
            schedule_to_close_timeout=timedelta(seconds=180),
            retry_policy=PUBLISH_RETRY,
        )

    async def _persist_checkpoint(
        self,
        build_id: str,
        step: BuildStep | str,
        status: str,
        output: dict,
        error: dict | None = None,
    ) -> None:
        await workflow.execute_activity(
            build_activities.persist_checkpoint,
            {
                "build_id": build_id,
                "step": str(step),
                "status": status,
                "output": output,
                "error": error,
            },
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=5, initial_interval=timedelta(seconds=1)),
        )

    async def _record_failure(self, build_id: str, step: BuildStep, failure: dict) -> None:
        try:
            await self._persist_checkpoint(build_id, step, "failed", {}, error=failure)
        except Exception:
            workflow.logger.error("could not persist build failure", extra={"build_id": build_id})


def build_workflow_id(build_id: str) -> str:
    """Stable workflow id so a retried API call reuses the same execution (Rule 18)."""
    return f"build:{build_id}"
