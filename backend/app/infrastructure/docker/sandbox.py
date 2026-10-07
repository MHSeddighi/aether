"""Docker sandbox: the boundary for untrusted generated code.

Generated code never runs in the API, the Temporal worker or the LangGraph worker. It runs here,
inside a container built with nothing it needs and everything it must not have (Rule 32):

    --network=none        no outbound calls at all, so a bot cannot exfiltrate or fetch payloads
    --read-only           the image is not a scratch pad
    --cap-drop=ALL        no Linux capabilities
    --security-opt        no-new-privileges: setuid binaries cannot gain anything
    --pids-limit          a fork bomb dies immediately
    --memory/--cpus       bounded resources
    --tmpfs               the only writable path
    no -v, no --env-file  no host filesystem, no database credentials, no Temporal credentials

The Docker socket is never mounted. That is the single most important line in this file: a container
that can reach the socket can start a privileged sibling and the whole boundary is gone.

Every call has an explicit timeout and is killed on expiry (Rule 16).
"""

from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.domain.failures import (
    DeadlineExceededFailure,
    FailureReason,
    InternalFailure,
    ToolFailure,
)
from app.infrastructure.config import Settings
from app.infrastructure.logging_config import get_logger

logger = get_logger(__name__)

#: Applied to every `docker run`, in one place so no call site can forget a flag.
SANDBOX_RUN_FLAGS: tuple[str, ...] = (
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=100",
    "--memory=256m",
    "--cpus=1.0",
    "--tmpfs=/tmp:rw,noexec,nosuid,size=32m",
    "--user=1000:1000",
)


@dataclass(frozen=True, slots=True)
class ImageBuildResult:
    tag: str
    digest: str
    size_bytes: int


@dataclass(frozen=True, slots=True)
class SandboxResult:
    passed: bool
    output: str
    duration_ms: int


@dataclass(frozen=True, slots=True)
class SandboxPolicy:
    """The resource envelope, assembled from configuration."""

    network: str = "none"
    memory: str = "256m"
    cpus: str = "1.0"
    pids_limit: int = 100
    timeout_seconds: float = 30.0

    @classmethod
    def from_settings(cls, settings: Settings | None) -> SandboxPolicy:
        if settings is None:
            return cls()
        return cls(
            network=settings.sandbox_network,
            memory=settings.sandbox_memory,
            cpus=settings.sandbox_cpus,
            pids_limit=settings.sandbox_pids_limit,
            timeout_seconds=settings.sandbox_timeout_seconds,
        )

    def run_flags(self) -> list[str]:
        """The policy as `docker run` flags.

        The flags are derived from configuration rather than the module constant so an operator can
        tighten (or loosen, deliberately) the envelope without a code change — while the
        non-negotiable ones (no socket, no host mounts, dropped capabilities) stay hard-coded.
        """
        return [
            f"--network={self.network}",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            f"--pids-limit={self.pids_limit}",
            f"--memory={self.memory}",
            f"--cpus={self.cpus}",
            "--tmpfs=/tmp:rw,noexec,nosuid,size=32m",
            "--user=1000:1000",
        ]


def docker_available() -> bool:
    return shutil.which("docker") is not None


def _ensure_docker() -> None:
    if not docker_available():
        raise InternalFailure(
            FailureReason.UNEXPECTED,
            "the docker CLI is not available in this process; the sandbox cannot run",
            details={"component": "sandbox"},
        )


async def _docker(args: list[str], *, timeout_seconds: float, purpose: str) -> tuple[int, str]:
    """Run the docker CLI under a hard timeout.

    `asyncio.wait_for` kills the process group on expiry, so a runaway build cannot outlive its
    activity (Rule 16).
    """
    _ensure_docker()
    try:
        process = await asyncio.create_subprocess_exec(
            "docker",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except OSError as exc:
        raise InternalFailure(
            FailureReason.UNEXPECTED,
            f"could not start docker: {exc}",
            details={"purpose": purpose},
        ) from exc

    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise DeadlineExceededFailure(
            f"docker {purpose} exceeded its {timeout_seconds:.0f}s budget",
            details={"purpose": purpose, "timeout_seconds": timeout_seconds},
        ) from exc

    return process.returncode or 0, stdout.decode(errors="replace")


async def build_image(
    context_dir: Path,
    tag: str,
    *,
    timeout_seconds: float = 600.0,
) -> ImageBuildResult:
    """Build an image from `context_dir`.

    Idempotent by tag: building the same tag twice simply produces the same image, which is what
    makes the `docker_build` activity safe to retry (Rule 18).
    """
    code, output = await _docker(
        [
            "build",
            "--tag",
            tag,
            "--quiet",
            str(context_dir),
        ],
        timeout_seconds=timeout_seconds,
        purpose="build",
    )
    if code != 0:
        raise ToolFailure(
            FailureReason.TOOL_UNAVAILABLE,
            f"docker build failed with exit code {code}",
            details={"tag": tag, "output": output[-4000:]},
        )

    digest, size = await _image_metadata(tag)
    return ImageBuildResult(tag=tag, digest=digest, size_bytes=size)


async def run_sandbox_test(
    image_tag: str,
    *,
    policy: SandboxPolicy | None = None,
    command: tuple[str, ...] | None = None,
) -> SandboxResult:
    """Run the image briefly inside the sandbox and report whether it started cleanly.

    The check is deliberately shallow — "does it start and exit cleanly" — because anything deeper
    belongs to the generated bot's own test suite, which the sandbox test then invokes.
    """
    policy = policy or SandboxPolicy()
    loop = asyncio.get_running_loop()
    started = loop.time()
    code, output = await _docker(
        [
            "run",
            "--rm",
            *policy.run_flags(),
            image_tag,
            *(command or ()),
        ],
        timeout_seconds=policy.timeout_seconds,
        purpose="sandbox run",
    )
    duration_ms = int((loop.time() - started) * 1000)
    return SandboxResult(passed=code == 0, output=output[-4000:], duration_ms=duration_ms)


async def _image_metadata(tag: str) -> tuple[str, str, int]:
    code, output = await _docker(
        ["image", "inspect", tag, "--format", "{{.Id}} {{.Size}}"],
        timeout_seconds=30.0,
        purpose="inspect",
    )
    if code != 0:
        raise ToolFailure(
            FailureReason.TOOL_UNAVAILABLE,
            f"could not inspect image {tag}",
            details={"tag": tag, "output": output[-2000:]},
        )
    parts = output.split()
    digest = parts[0] if parts else ""
    size = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    return digest, size


async def remove_image(tag: str) -> bool:
    """Best-effort cleanup of a build's image. Never raises: it runs on failure paths."""
    try:
        code, _ = await _docker(["image", "rm", "--force", tag], timeout_seconds=60.0, purpose="rm")
    except Exception:
        logger.warning("image removal failed", extra={"tag": tag}, exc_info=True)
        return False
    return code == 0
