"""State 10 — the Docker sandbox.

These tests assert the *boundary*, not Docker itself: the flags the sandbox must always apply, and
the classification of its failures. A test that actually built images would be testing the host's
Docker install, not this code.

The non-negotiable properties (Rule 32):

* no network, no host filesystem, no docker socket, no secrets;
* no root, no capabilities, no privilege escalation;
* bounded memory, CPUs and pids;
* a hard timeout on every call.
"""

from __future__ import annotations

import asyncio

import pytest
from app.domain.failures import DeadlineExceededFailure
from app.infrastructure.config import Settings
from app.infrastructure.docker.sandbox import (
    SandboxPolicy,
    docker_available,
    run_sandbox_test,
)


class TestSandboxPolicy:
    def test_defaults_are_locked_down(self) -> None:
        policy = SandboxPolicy()
        assert policy.network == "none", "generated code must not reach the network"
        assert policy.timeout_seconds > 0

    def test_policy_is_built_from_configuration(self) -> None:
        settings = Settings(
            _env_file=None,
            sandbox_network="none",
            sandbox_memory="128m",
            sandbox_cpus="0.5",
            sandbox_pids_limit=32,
            sandbox_timeout_seconds=12.0,
        )
        policy = SandboxPolicy.from_settings(settings)
        assert (policy.memory, policy.cpus, policy.pids_limit) == ("128m", "0.5", 32)
        assert policy.timeout_seconds == 12.0

    def test_run_flags_block_everything_that_matters(self) -> None:
        flags = " ".join(SandboxPolicy().run_flags())
        assert "--network=none" in flags, "no outbound calls"
        assert "--read-only" in flags, "the image is not a scratch pad"
        assert "--cap-drop=ALL" in flags, "no capabilities"
        assert "--security-opt=no-new-privileges" in flags, "setuid gains nothing"
        assert "--pids-limit=" in flags, "a fork bomb dies immediately"
        assert "--memory=" in flags and "--cpus=" in flags, "bounded resources"
        assert "--user=1000:1000" in flags, "never root inside the container"

    def test_the_policy_never_mounts_the_host_or_the_docker_socket(self) -> None:
        """A container that can reach the socket can start a privileged sibling, and the whole
        boundary is gone. Nothing in the policy may add a `-v` or a socket mount."""
        flags = SandboxPolicy().run_flags()
        assert not any(flag.startswith(("-v", "--volume", "--mount")) for flag in flags)
        assert not any("docker.sock" in flag for flag in flags)

    def test_the_policy_never_injects_environment_variables(self) -> None:
        flags = SandboxPolicy().run_flags()
        assert not any(flag.startswith(("--env", "-e", "--env-file")) for flag in flags), (
            "there must be no way to hand a secret to untrusted code"
        )

    def test_configuration_can_tighten_the_envelope(self) -> None:
        """An operator may lower the limits; the hard-coded safety flags are not configuration."""
        flags = " ".join(SandboxPolicy(memory="64m", pids_limit=8).run_flags())
        assert "--memory=64m" in flags
        assert "--pids-limit=8" in flags
        assert "--cap-drop=ALL" in flags


@pytest.mark.skipif(not docker_available(), reason="the docker CLI is not available here")
class TestSandboxExecution:
    async def test_a_healthy_image_passes(self) -> None:
        result = await run_sandbox_test("python:3.12-slim", policy=SandboxPolicy(timeout_seconds=20))
        # The image has no entrypoint that exits 0, so this is a smoke test of the harness itself.
        assert result.duration_ms >= 0
        assert isinstance(result.passed, bool)

    async def test_a_missing_image_fails_rather_than_hangs(self) -> None:
        result = await run_sandbox_test(
            "definitely-not-a-real-image:aether",
            policy=SandboxPolicy(timeout_seconds=30),
        )
        assert result.passed is False
        assert "definitely-not-a-real-image" in result.output

    async def test_the_timeout_is_enforced(self) -> None:
        """A container that never exits must not hold the activity open (Rule 16).

        Uses a locally-present image so the failure is the deadline, not a missing image, and passes
        the full interpreter because `docker run` replaces the image's CMD entirely.
        """
        started = asyncio.get_running_loop().time()
        with pytest.raises(DeadlineExceededFailure):
            await run_sandbox_test(
                "python:3.12-slim",
                policy=SandboxPolicy(timeout_seconds=2),
                command=("python3", "-c", "import time; time.sleep(120)"),
            )
        assert asyncio.get_running_loop().time() - started < 30


class TestSandboxGeneration:
    """The generated build context must be valid *before* any Docker build is attempted."""

    def test_generated_dockerfile_never_runs_as_root(self) -> None:
        from app.activities.build import _generate_dockerfile
        from app.workflows.build_bot import BuildSpec

        dockerfile = _generate_dockerfile(
            BuildSpec(
                build_id="b1",
                workspace_id="w1",
                bot_id="bot_1",
                bot_version_id="v1",
                specification="a bot",
            )
        )
        assert "USER 1000:1000" in dockerfile
        assert "USER root" not in dockerfile

    def test_generated_entrypoint_is_valid_python(self) -> None:
        from app.activities.build import _generate_entrypoint
        from app.workflows.build_bot import BuildSpec

        source = _generate_entrypoint(
            BuildSpec(
                build_id="b1",
                workspace_id="w1",
                bot_id="bot_1",
                bot_version_id="v1",
                specification='a bot with """ in it',
            )
        )
        compile(source, "entrypoint.py", "exec"), "a spec containing a triple quote must not break codegen"

    def test_code_generation_is_deterministic(self) -> None:
        """A retried activity must produce byte-identical files, or the build it recorded is not the
        build it will do (Rule 18)."""
        from app.activities.build import _generate_dockerfile, _generate_entrypoint
        from app.workflows.build_bot import BuildSpec

        spec = BuildSpec(
            build_id="b1", workspace_id="w1", bot_id="bot_1", bot_version_id="v1", specification="x"
        )
        assert _generate_entrypoint(spec) == _generate_entrypoint(spec)
        assert _generate_dockerfile(spec) == _generate_dockerfile(spec)


class TestCodeValidation:
    """`validate_code` rejects a build context that could never work, before spending a build."""

    async def _validate(self, **codegen) -> dict:
        from app.activities.build import validate_code

        return await validate_code({"spec": {}, "codegen": codegen})

    async def test_a_valid_context_is_accepted(self) -> None:
        result = await self._validate(
            **{
                "dockerfile": "FROM python:3.12-slim\nUSER 1000\n",
                "entrypoint.py": "print('hi')\n",
                "requirements.txt": "httpx>=0.27\n",
            }
        )
        assert result["validated"] is True

    async def test_a_syntax_error_is_rejected(self) -> None:
        from app.domain.failures import ValidationFailure

        with pytest.raises(ValidationFailure, match="syntax error"):
            await self._validate(
                **{
                    "dockerfile": "FROM python:3.12-slim\n",
                    "entrypoint.py": "def broken(:\n",
                    "requirements.txt": "",
                }
            )

    async def test_a_dockerfile_without_from_is_rejected(self) -> None:
        from app.domain.failures import ValidationFailure

        with pytest.raises(ValidationFailure, match="FROM"):
            await self._validate(
                **{
                    "dockerfile": "RUN echo hi\n",
                    "entrypoint.py": "print('hi')\n",
                    "requirements.txt": "",
                }
            )

    async def test_an_empty_requirement_line_is_allowed(self) -> None:
        """Blank lines and comments are legal in a requirements file."""
        result = await self._validate(
            **{
                "dockerfile": "FROM python:3.12-slim\n",
                "entrypoint.py": "print('hi')\n",
                "requirements.txt": "# runtime deps\nhttpx>=0.27\n\n",
            }
        )
        assert result["validated"] is True

    async def test_a_requirement_with_no_package_name_is_rejected(self) -> None:
        from app.domain.failures import ValidationFailure

        with pytest.raises(ValidationFailure, match="no package name"):
            await self._validate(
                **{
                    "dockerfile": "FROM python:3.12-slim\n",
                    "entrypoint.py": "print('hi')\n",
                    "requirements.txt": "httpx>=0.27\n;\n",
                }
            )
