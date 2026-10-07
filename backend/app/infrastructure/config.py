"""Application settings.

Model providers are *configuration*, never code paths (Rule 6/7):

* base URLs and catalogue URLs are protocol constants of the provider, defined once here;
* API keys come from the environment variable named by ``ProviderConfig.api_key_env`` and are
  optional — OpenCode Zen serves some models keyless;
* fallback model lists are configuration defaults that operators can override, because free-model
  availability is dynamic.

Nothing outside this module reads ``os.environ``.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["openrouter", "opencode", "deepseek", "fake"]

ModelEntry = tuple[str, str]  # (model_id, display label)


class ProviderConfig(BaseModel):
    """Everything needed to talk to one OpenAI-compatible provider."""

    name: ProviderName
    base_url: str
    api_key_env: str | None = None
    api_key: SecretStr | None = None
    extra_headers: dict[str, str] = Field(default_factory=dict)
    catalog_url: str | None = None
    fallback_models: list[ModelEntry] = Field(default_factory=list)
    default_model_id: str | None = None

    def resolved_api_key(self) -> str | None:
        """API key from the instance or, failing that, from the named environment variable."""
        if self.api_key is not None:
            return self.api_key.get_secret_value()
        if self.api_key_env:
            value = os.environ.get(self.api_key_env)
            return value or None
        return None


def _provider_defaults() -> dict[str, ProviderConfig]:
    return {
        "openrouter": ProviderConfig(
            name="openrouter",
            base_url="https://openrouter.ai/api/v1",
            api_key_env="OPENROUTER_API_KEY",
            catalog_url="https://openrouter.ai/api/v1/models",
            extra_headers={
                "HTTP-Referer": "https://github.com/anomalyco/bot-builder",
                "X-Title": "bot-builder",
            },
            default_model_id="",
            fallback_models=[],
        ),
        "opencode": ProviderConfig(
            name="opencode",
            base_url="https://opencode.ai/zen/v1",
            api_key_env="OPENCODE_API_KEY",
            catalog_url="https://opencode.ai/zen/v1/models",
            default_model_id="space-bunny-free",
            fallback_models=[
                ("space-bunny-free", "Space Bunny Free"),
                ("big-pickle", "Big Pickle"),
                ("exo-free", "Exo Free"),
                ("fledge-alpha-free", "Fledge Alpha Free"),
                ("longcat-2.5-preview-free", "LongCat 2.5 Preview Free"),
                ("mimo-v2.6-flash-free", "MiMo-V2.6-Flash Free"),
            ],
        ),
        "deepseek": ProviderConfig(
            name="deepseek",
            base_url="https://api.deepseek.com/v1",
            api_key_env="DEEPSEEK_API_KEY",
            catalog_url=None,
            default_model_id="deepseek-chat",
            fallback_models=[
                ("deepseek-chat", "DeepSeek Chat"),
                ("deepseek-reasoner", "DeepSeek Reasoner"),
            ],
        ),
    }


class RetryPolicy(BaseModel):
    """Retries are delegated to Temporal for activities, and to the provider client for HTTP-level
    blips. This policy is the default used when building both."""

    max_attempts: int = Field(default=3, ge=1, le=10)
    initial_interval_seconds: float = Field(default=1.0, gt=0, le=60)
    backoff_coefficient: float = Field(default=2.0, ge=1.0, le=10)
    max_interval_seconds: float = Field(default=30.0, gt=0, le=600)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # --- service identity ---
    app_name: str = "bot-builder-backend"
    environment: Literal["local", "test", "staging", "production"] = "local"
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"

    # --- infrastructure ---
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/botbuilder"
    db_pool_size: int = Field(default=5, ge=1, le=50)
    db_max_overflow: int = Field(default=5, ge=0, le=50)
    data_dir: str = "./data"

    temporal_host: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "bot-builder"
    temporal_build_task_queue: str = "bot-builder-build"
    temporal_api_key: SecretStr | None = None
    temporal_tls: bool = False

    # --- auth ---
    jwt_secret: SecretStr = SecretStr("dev-only-insecure-secret-change-me")
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = Field(default=3600, ge=60)
    refresh_token_ttl_seconds: int = Field(default=60 * 60 * 24 * 30, ge=600)
    default_plan: str = "Team Pro"
    default_runs_limit: int = 5000
    default_tokens_limit_million: float = 50.0

    # --- models ---
    providers: dict[str, ProviderConfig] = Field(default_factory=_provider_defaults)
    default_provider: ProviderName = "opencode"
    default_model_id: str = "space-bunny-free"
    default_temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    default_top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    default_max_output_tokens: int = Field(default=2048, ge=16, le=131072)
    model_timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    model_retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    model_catalog_cache_seconds: float = Field(default=900.0, gt=0)

    # --- agent ---
    agent_max_steps: int = Field(default=8, ge=1, le=50)
    agent_run_timeout_seconds: float = Field(default=180.0, gt=0)
    agent_max_repairs: int = Field(default=2, ge=0, le=5)

    # --- run event stream (SSE) ---
    #: How often `GET /runs/{id}/stream` re-reads the durable event table. There is no broker to
    #: subscribe to (Rule 2/27): the terminal event is written by the worker, so this bounds how
    #: long a client waits to learn the run finished.
    event_poll_interval_seconds: float = Field(default=0.4, gt=0, le=30)
    #: Backstop so a stream that never sees a terminal event still closes.
    event_stream_max_seconds: float = Field(default=900.0, gt=0, le=86400)

    # --- sandbox (State 10) ---
    sandbox_image: str = "python:3.12-slim"
    sandbox_network: str = "none"
    sandbox_cpus: str = "1.0"
    sandbox_memory: str = "256m"
    sandbox_pids_limit: int = 100
    sandbox_timeout_seconds: float = 30.0

    @field_validator("providers")
    @classmethod
    def _known_providers(cls, value: dict[str, ProviderConfig]) -> dict[str, ProviderConfig]:
        allowed = {"openrouter", "opencode", "deepseek"}
        unknown = set(value) - allowed
        if unknown:
            raise ValueError(f"unknown providers configured: {sorted(unknown)}")
        return value

    def provider(self, name: str) -> ProviderConfig:
        try:
            return self.providers[name]
        except KeyError as exc:
            raise KeyError(f"provider {name!r} is not configured") from exc

    def default_model_id_for(self, provider: str) -> str:
        cfg = self.provider(provider)
        return self.default_model_id if provider == self.default_provider else (cfg.default_model_id or "")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
