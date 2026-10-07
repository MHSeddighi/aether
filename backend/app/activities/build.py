"""Build activities: the durable steps of the `BuildBotWorkflow`.

One activity per meaningful boundary (Rule 25): load the spec, generate code, validate it, build the
image, test it in the sandbox, publish the artifact, and record each checkpoint.

Every activity assumes it may run more than once and is therefore idempotent (Rule 18): code
generation is a pure function of the spec, `docker build` is idempotent by tag, and the checkpoint
write is an upsert on `(build_id, step)`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from temporalio import activity

from app.activities.container import get
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.ids import new_id
from app.infrastructure.logging_config import get_logger
from app.workflows.build_bot import BuildSpec, BuildStatus, BuildStep

logger = get_logger(__name__)

#: Checkpoints live in their own table rather than in the run table: a build is a different
#: lifecycle from a run and must not be able to corrupt run events.
CHECKPOINT_TABLE = "build_checkpoints"


@activity.defn(name="load_build_spec")
async def load_build_spec(request: BuildSpec) -> dict[str, Any]:
    """Verify the bot version exists, then return the spec as plain data.

    Plain data (not a domain object) keeps the durable history trivially serialisable.
    """
    container = get()
    async with container.database.session() as session:
        from app.infrastructure.database.repositories.bot_repository import BotRepository

        version = await BotRepository(session).version(request.bot_version_id)
        if version is None or version.bot_id != request.bot_id:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"bot version {request.bot_version_id!r} not found for bot {request.bot_id!r}",
                details={"bot_id": request.bot_id, "bot_version_id": request.bot_version_id},
            )
    return request.model_dump(mode="json")


@activity.defn(name="generate_code")
async def generate_code(spec: dict[str, Any]) -> dict[str, Any]:
    """Produce the build context: `Dockerfile`, `entrypoint.py`, `requirements.txt`.

    Deterministic for a given spec (Rule 18): the same specification always yields byte-identical
    files, so a retried activity cannot produce a different build than the checkpoint recorded.
    """
    build_spec = BuildSpec.model_validate(spec)
    return {
        "dockerfile": _generate_dockerfile(build_spec),
        "entrypoint.py": _generate_entrypoint(build_spec),
        "requirements.txt": _generate_requirements(),
    }


@activity.defn(name="validate_code")
async def validate_code(payload: dict[str, Any]) -> dict[str, Any]:
    """Reject a build context that could never work, before spending a Docker build on it."""
    codegen = payload["codegen"]

    try:
        compile(codegen["entrypoint.py"], "entrypoint.py", "exec")
    except SyntaxError as exc:
        raise ValidationFailure(
            FailureReason.OUTPUT_SCHEMA,
            f"generated code has a syntax error on line {exc.lineno}: {exc.msg}",
            details={"file": "entrypoint.py", "line": exc.lineno},
        ) from exc

    if not any(line.startswith("FROM ") for line in codegen["dockerfile"].splitlines()):
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "generated Dockerfile has no FROM instruction",
            details={"file": "Dockerfile"},
        )

    # Blank lines and comments are legal in a requirements file; an entry with no package name is
    # not, and it would only fail much later inside the image build.
    for number, line in enumerate(codegen["requirements.txt"].splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not stripped.split(";")[0].strip():
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"requirements.txt has an entry with no package name on line {number}",
                details={"file": "requirements.txt", "line": number},
            )

    return {"validated": True, "files": sorted(codegen)}


@activity.defn(name="docker_build")
async def docker_build(payload: dict[str, Any]) -> dict[str, Any]:
    """Build the image and return its tag, digest and size."""
    from app.infrastructure.docker.sandbox import build_image

    spec = BuildSpec.model_validate(payload["spec"])
    codegen = payload["codegen"]

    with TemporaryDirectory(prefix=f"build-{spec.build_id}-") as tmpdir:
        context = Path(tmpdir)
        for name in ("Dockerfile", "entrypoint.py", "requirements.txt"):
            (context / name).write_text(codegen[name], encoding="utf-8")
        result = await build_image(context, f"bot-{spec.build_id}:build")

    return {
        "image_tag": result.tag,
        "image_digest": result.digest,
        "size_bytes": result.size_bytes,
    }


@activity.defn(name="sandbox_test")
async def sandbox_test(payload: dict[str, Any]) -> dict[str, Any]:
    """Run the built image inside the locked-down sandbox and report whether it started."""
    from app.infrastructure.docker.sandbox import SandboxPolicy, run_sandbox_test

    container = get()
    result = await run_sandbox_test(
        payload["built"]["image_tag"],
        policy=SandboxPolicy.from_settings(container.settings),
    )
    return {
        "passed": result.passed,
        "output": result.output,
        "duration_ms": result.duration_ms,
    }


@activity.defn(name="publish_artifact")
async def publish_artifact(payload: dict[str, Any]) -> dict[str, Any]:
    """Record the built image as an artifact.

    Idempotent by `(workspace_id, build_id)`: a retry overwrites the same row rather than publishing
    a second artifact for one build (Rule 18).
    """
    container = get()
    spec = BuildSpec.model_validate(payload["spec"])
    built = payload["built"]

    async with container.database.session() as session:
        from sqlalchemy import delete

        from app.infrastructure.database.tables import ArtifactRow

        # One artifact per build: a retried publish replaces the previous record.
        await session.execute(
            delete(ArtifactRow).where(
                ArtifactRow.workspace_id == spec.workspace_id,
                ArtifactRow.build_id == spec.build_id,
            )
        )
        artifact = ArtifactRow(
            id=new_id("art"),
            workspace_id=spec.workspace_id,
            bot_id=spec.bot_id,
            build_id=spec.build_id,
            kind="docker_image",
            uri=built["image_tag"],
            checksum_sha256=built["image_digest"],
            metadata_json={
                "specification": spec.specification,
                "base_image": spec.base_image,
                "size_bytes": built["size_bytes"],
            },
            created_at=datetime.now(UTC),
        )
        session.add(artifact)
        await session.flush()
        await session.refresh(artifact, ["id"])

    return {"artifact_id": artifact.id, **built}


@activity.defn(name="persist_checkpoint")
async def persist_checkpoint(payload: dict[str, Any]) -> dict[str, Any]:
    """Upsert one checkpoint. Called after every step, so a resumed build knows where it was."""
    container = get()
    step = BuildStep(payload["step"])
    status = BuildStatus(payload["status"])
    now = datetime.now(UTC)

    async with container.database.session() as session:
        from sqlalchemy import text

        await session.execute(
            text(
                f"INSERT INTO {CHECKPOINT_TABLE} (build_id, step, status, output, error, created_at) "
                "VALUES (:build_id, :step, :status, :output, :error, :created_at) "
                "ON CONFLICT (build_id, step) DO UPDATE SET "
                "status = EXCLUDED.status, output = EXCLUDED.output, "
                "error = EXCLUDED.error, created_at = EXCLUDED.created_at"
            ),
            {
                "build_id": payload["build_id"],
                # `BuildStep`/`BuildStatus` are StrEnums, so binding them directly would store their
                # repr on some drivers; the explicit `str()` keeps the column value stable.
                "step": str(step),
                "status": str(status),
                "output": json.dumps(payload["output"], default=str),
                "error": json.dumps(payload["error"], default=str) if payload.get("error") else None,
                "created_at": now,
            },
        )
    return {"build_id": payload["build_id"], "step": str(step), "status": str(status)}


# --- code generation ------------------------------------------------------


def _generate_dockerfile(spec: BuildSpec) -> str:
    return f"""FROM {spec.base_image}

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY entrypoint.py .

# Never root inside the container, and never privileged: the image may hold nothing but the bot.
USER 1000:1000
CMD ["python", "entrypoint.py"]
"""


def _generate_entrypoint(spec: BuildSpec) -> str:
    """A minimal, runnable bot. Deterministic for a given spec so retries cannot diverge."""
    description = spec.specification.replace('"""', "'''").strip()
    return f'''"""Generated entrypoint for build {spec.build_id}.

Specification: {description[:500]}
"""


async def main() -> None:
    print("bot ready", flush=True)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
'''


def _generate_requirements() -> str:
    return "httpx>=0.27\n"
