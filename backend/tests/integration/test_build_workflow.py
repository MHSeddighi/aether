"""State 10 — the build workflow's durable checkpoints.

The real `BuildBotWorkflow` runs against Temporal's time-skipping test environment; only its
activities are stubbed, registered under the *production* activity names (the same pattern as
`test_workflow.py`). So the ordering, checkpoint persistence and failure classification are genuinely
exercised while Docker and Postgres stay out of the picture.

The property under test (Rule 13/31): every expensive/irreversible transition writes a checkpoint
before moving on, so a crashed build leaves a readable trail of exactly how far it got.

    uv run pytest tests/integration/test_build_workflow.py
    TEMPORAL_TEST_SERVER=1 uv run pytest tests/integration/test_build_workflow.py   # fail instead of skip
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
import pytest_asyncio
from app.workflows.build_bot import BuildBotWorkflow, BuildSpec
from temporalio import activity, workflow
from temporalio.client import WorkflowFailureError
from temporalio.exceptions import CancelledError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

pytestmark = pytest.mark.integration

REQUIRED = os.getenv("TEMPORAL_TEST_SERVER") == "1"

GOOD_CODEGEN = {
    "dockerfile": "FROM python:3.12-slim\nUSER 1000:1000\n",
    "entrypoint.py": "print('ready')\n",
    "requirements.txt": "httpx>=0.27\n",
}

#: The stub the module-level activities delegate to. Set once by the `worker_env` fixture.
SCRIPT: ScriptedBuild | None = None


class ScriptedBuild:
    """Activity stubs. Every call is recorded so the checkpoint order can be asserted."""

    def __init__(self, *, fail_at: str | None = None, sleep_seconds: float = 0.0) -> None:
        self.fail_at = fail_at
        self.sleep_seconds = sleep_seconds
        self.calls: list[str] = []
        self.checkpoints: list[dict] = []

    def count(self, name: str) -> int:
        return self.calls.count(name)

    def steps(self) -> list[str]:
        return [c["step"] for c in self.checkpoints]

    # --- the stubbed activities, registered by name below -----------------

    async def load_build_spec(self, request: BuildSpec) -> dict:
        self.calls.append("load_build_spec")
        return request.model_dump(mode="json")

    async def generate_code(self, _spec: dict) -> dict:
        self.calls.append("generate_code")
        if self.fail_at == "codegen":
            raise RuntimeError("code generation exploded")
        return GOOD_CODEGEN

    async def validate_code(self, _payload: dict) -> dict:
        self.calls.append("validate_code")
        if self.fail_at == "validate":
            raise RuntimeError("invalid code")
        return {"validated": True}

    async def docker_build(self, _payload: dict) -> dict:
        self.calls.append("docker_build")
        if self.sleep_seconds:
            await asyncio.sleep(self.sleep_seconds)
        if self.fail_at == "docker_build":
            raise RuntimeError("image build failed")
        return {"image_tag": "bot:build", "image_digest": "sha256:abc", "size_bytes": 100}

    async def sandbox_test(self, _payload: dict) -> dict:
        self.calls.append("sandbox_test")
        if self.fail_at == "sandbox_test":
            raise RuntimeError("sandbox refused the image")
        return {"passed": True}

    async def publish_artifact(self, _payload: dict) -> dict:
        self.calls.append("publish_artifact")
        return {"artifact_id": "art_1", "image_tag": "bot:build", "image_digest": "sha256:abc"}

    async def persist_checkpoint(self, payload: dict) -> dict:
        self.calls.append("persist_checkpoint")
        self.checkpoints.append(
            {"step": payload["step"], "status": payload["status"], "error": payload.get("error")}
        )
        return {"build_id": payload["build_id"]}


def _script() -> ScriptedBuild:
    if SCRIPT is None:  # pragma: no cover - only reachable outside the fixture
        raise RuntimeError("test script not installed")
    return SCRIPT


@activity.defn(name="load_build_spec")
async def stub_load_build_spec(request: BuildSpec) -> dict:
    return await _script().load_build_spec(request)


@activity.defn(name="generate_code")
async def stub_generate_code(spec: dict) -> dict:
    return await _script().generate_code(spec)


@activity.defn(name="validate_code")
async def stub_validate_code(payload: dict) -> dict:
    return await _script().validate_code(payload)


@activity.defn(name="docker_build")
async def stub_docker_build(payload: dict) -> dict:
    return await _script().docker_build(payload)


@activity.defn(name="sandbox_test")
async def stub_sandbox_test(payload: dict) -> dict:
    return await _script().sandbox_test(payload)


@activity.defn(name="publish_artifact")
async def stub_publish_artifact(payload: dict) -> dict:
    return await _script().publish_artifact(payload)


@activity.defn(name="persist_checkpoint")
async def stub_persist_checkpoint(payload: dict) -> dict:
    return await _script().persist_checkpoint(payload)


STUB_ACTIVITIES = [
    stub_load_build_spec,
    stub_generate_code,
    stub_validate_code,
    stub_docker_build,
    stub_sandbox_test,
    stub_publish_artifact,
    stub_persist_checkpoint,
]


def make_spec(build_id: str) -> BuildSpec:
    return BuildSpec(
        build_id=build_id,
        workspace_id="ws_test",
        bot_id="bot_1",
        bot_version_id="ver_1",
        specification="a pricing bot",
    )


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def temporal_env():
    try:
        async with await WorkflowEnvironment.start_time_skipping() as env:
            yield env
    except Exception as exc:
        if isinstance(exc, pytest.skip.Exception):
            raise
        if REQUIRED and isinstance(exc, (AssertionError, RuntimeError)):
            raise
        pytest.skip(f"Temporal test environment unavailable: {type(exc).__name__}: {exc}")


@pytest_asyncio.fixture(loop_scope="module")
async def worker_env(temporal_env):
    global SCRIPT
    script = ScriptedBuild()
    SCRIPT = script
    queue = f"test-build-{uuid.uuid4().hex[:8]}"
    async with Worker(
        temporal_env.client,
        task_queue=queue,
        workflows=[BuildBotWorkflow],
        activities=STUB_ACTIVITIES,
    ):
        yield temporal_env.client, script, queue
    SCRIPT = None


async def _run(client, queue: str, build_id: str):
    return await client.execute_workflow(
        BuildBotWorkflow,
        make_spec(build_id),
        id=f"build:{build_id}",
        task_queue=queue,
    )


@pytest.mark.asyncio(loop_scope="module")
class TestBuildWorkflow:
    async def test_successful_build_walks_every_step_in_order(self, worker_env) -> None:
        client, script, queue = worker_env
        outcome = await _run(client, queue, "build_ok")
        assert outcome.status == "succeeded"
        assert outcome.image_tag == "bot:build"
        steps = [c for c in script.calls if c != "persist_checkpoint"]
        assert steps == [
            "load_build_spec",
            "generate_code",
            "validate_code",
            "docker_build",
            "sandbox_test",
            "publish_artifact",
        ]

    async def test_every_step_is_checkpointed_before_the_next(self, worker_env) -> None:
        """A crash must leave a readable trail: one succeeded checkpoint per completed step."""
        client, script, queue = worker_env
        await _run(client, queue, "build_checkpoints")
        assert script.steps() == [
            "spec",
            "codegen",
            "validate",
            "docker_build",
            "sandbox_test",
            "publish",
        ]
        assert all(c["status"] == "succeeded" for c in script.checkpoints)

    async def test_a_codegen_failure_is_checkpointed_against_codegen(self, worker_env) -> None:
        client, script, queue = worker_env
        script.fail_at = "codegen"
        try:
            with pytest.raises(WorkflowFailureError):
                await _run(client, queue, "build_bad_codegen")
            # CODEGEN_RETRY allows two attempts, so it is attempted twice then fails.
            assert script.count("generate_code") == 2
            assert script.count("docker_build") == 0
            assert ("codegen", "failed") in {(c["step"], c["status"]) for c in script.checkpoints}
        finally:
            script.fail_at = None

    async def test_a_docker_failure_stops_before_publish(self, worker_env) -> None:
        client, script, queue = worker_env
        script.fail_at = "docker_build"
        try:
            with pytest.raises(WorkflowFailureError):
                await _run(client, queue, "build_bad_docker")
            assert script.count("docker_build") == 2, "DOCKER_RETRY allows two attempts"
            assert script.count("publish_artifact") == 0
            assert ("docker_build", "failed") in {(c["step"], c["status"]) for c in script.checkpoints}
        finally:
            script.fail_at = None

    async def test_a_failed_build_checkpoint_carries_a_classified_failure(self, worker_env) -> None:
        client, script, queue = worker_env
        script.fail_at = "validate"
        try:
            with pytest.raises(WorkflowFailureError):
                await _run(client, queue, "build_bad_validate")
            failed = next(c for c in script.checkpoints if c["status"] == "failed")
            assert failed["step"] == "validate"
            assert failed["error"]["kind"] == "internal"
            assert failed["error"]["retryable"] is False
        finally:
            script.fail_at = None

    async def test_cancellation_leaves_a_resumable_state(self, worker_env) -> None:
        """Cancelling mid-build must not publish, so a resumed build redoes only the unfinished step."""
        client, script, queue = worker_env
        script.sleep_seconds = 30
        try:
            handle = await client.start_workflow(
                BuildBotWorkflow,
                make_spec("build_cancel"),
                id="build:build_cancel",
                task_queue=queue,
            )
            await asyncio.sleep(1)
            await handle.cancel()
            with pytest.raises((CancelledError, WorkflowFailureError)):
                await handle.result()
            assert script.count("publish_artifact") == 0
        finally:
            script.sleep_seconds = 0


class TestBuildWorkflowContract:
    def test_workflow_name_is_stable(self) -> None:
        definition = workflow._Definition.must_from_class(BuildBotWorkflow)
        assert definition.name == "BuildBotWorkflow"

    def test_build_workflow_id_is_stable(self) -> None:
        from app.workflows.build_bot import build_workflow_id

        assert build_workflow_id("build_1") == "build:build_1"

    def test_spec_defaults_are_safe(self) -> None:
        spec = make_spec("build_x")
        assert spec.base_image == "python:3.12-slim"
        assert spec.specification == "a pricing bot"

    def test_docker_build_has_a_heartbeat_so_a_hung_build_is_detected(self) -> None:
        from pathlib import Path

        source = (Path(__file__).resolve().parents[2] / "app" / "workflows" / "build_bot.py").read_text()
        assert "heartbeat_timeout=timedelta(seconds=30)" in source
