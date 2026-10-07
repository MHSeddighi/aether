"""State 1 — settings, app factory, health, error envelope."""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.api.app import create_app
from app.api.errors import ApiError, ConflictError, NotFoundError
from app.api.routes import health
from app.domain.ids import new_id
from app.infrastructure.config import ProviderConfig, Settings
from app.infrastructure.logging_config import JsonFormatter, configure_logging


class TestSettings:
    def test_defaults_are_usable_for_local_development(self) -> None:
        s = Settings(_env_file=None)
        assert s.default_provider == "opencode"
        assert s.provider("opencode").base_url == "https://opencode.ai/zen/v1"
        assert s.default_model_id == "space-bunny-free"

    def test_unknown_provider_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="unknown providers"):
            Settings(providers={"ollama": ProviderConfig(name="opencode", base_url="x")},
                     _env_file=None)

    def test_api_key_reads_from_named_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
        cfg = ProviderConfig(name="openrouter", base_url="http://x", api_key_env="OPENROUTER_API_KEY")
        assert cfg.resolved_api_key() == "sk-or-test"

    def test_missing_api_key_is_allowed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("OPENCODE_API_KEY", raising=False)
        cfg = ProviderConfig(name="opencode", base_url="http://x", api_key_env="OPENCODE_API_KEY")
        assert cfg.resolved_api_key() is None

    def test_secret_is_not_leaked_in_repr(self) -> None:
        cfg = ProviderConfig(name="opencode", base_url="http://x", api_key=SecretStr("hunter2"))
        assert "hunter2" not in repr(cfg)

    def test_out_of_range_values_are_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Settings(default_temperature=9.0, _env_file=None)
        with pytest.raises(ValidationError):
            Settings(agent_max_repairs=99, _env_file=None)


class TestAppFactory:
    def test_healthz_needs_no_infrastructure(self, client: TestClient) -> None:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_readyz_reports_registered_checks(self, app) -> None:
        async def ok() -> bool:
            return True

        async def bad() -> bool:
            raise RuntimeError("postgres is down")

        app.state.readiness.register("postgres", ok)
        app.state.readiness.register("temporal", bad)
        with TestClient(app) as client:
            response = client.get("/readyz")
        assert response.status_code == 503
        assert response.json() == {
            "status": "degraded",
            "checks": {"postgres": True, "temporal": False},
        }

    def test_openapi_is_served(self, client: TestClient) -> None:
        assert client.get("/openapi.json").status_code == 200

    def test_request_id_is_echoed_and_generated(self, client: TestClient) -> None:
        generated = client.get("/healthz").headers["X-Request-Id"]
        assert generated.startswith("req_")
        supplied = client.get("/healthz", headers={"X-Request-Id": "req_fixed"}).headers["X-Request-Id"]
        assert supplied == "req_fixed"


class TestErrorEnvelope:
    def test_unknown_route_uses_envelope(self, client: TestClient) -> None:
        response = client.get("/nope")
        assert response.status_code == 404
        body = response.json()["error"]
        assert body["code"] == "not_found"
        assert body["request_id"].startswith("req_")

    def test_validation_error_lists_fields(self, app) -> None:
        @app.get("/_probe")
        async def _probe(payload: dict[str, int]) -> dict[str, int]:  # pragma: no cover
            return payload

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/_probe", params={"x": "not-an-int"})
        assert response.status_code == 422
        body = response.json()["error"]
        assert body["code"] == "validation_error"
        assert body["details"]["errors"]

    def test_api_error_helpers_shape_envelope(self) -> None:
        assert NotFoundError("bot", "bot_x").status_code == 404
        assert ConflictError("already archived").code == "conflict"
        error = ApiError(418, "teapot", "short and stout")
        assert (error.status_code, error.code, error.message) == (418, "teapot", "short and stout")


class TestLogging:
    def test_json_formatter_emits_one_object_with_context(self) -> None:
        record = logging.LogRecord("test", logging.INFO, __file__, 1, "hello %s", ("world",), None)
        record.request_id = "req_1"
        payload = json.loads(JsonFormatter().format(record))
        assert payload["message"] == "hello world"
        assert payload["request_id"] == "req_1"
        assert payload["level"] == "INFO"

    def test_configure_logging_replaces_root_handlers(self) -> None:
        configure_logging("INFO")
        assert len(logging.getLogger().handlers) == 1


class TestIds:
    def test_ids_are_prefixed_and_sortable(self) -> None:
        first = new_id("run")
        second = new_id("run")
        assert first.startswith("run_") and second.startswith("run_")
        assert first != second
        assert len(first) == len("run_") + 26


class TestReadinessRegistry:
    async def test_registry_defaults_to_ready(self) -> None:
        registry = health.ReadinessRegistry(checks={})
        assert await registry.run() == {}
