"""Gateway factory: turns configuration into a `ModelClient` / `ModelCatalog`.

This is the only place that knows a provider is "just an OpenAI-compatible endpoint with different
headers and a key", which is what keeps provider logic out of the LangGraph nodes (Rule 6).
"""

from __future__ import annotations

from app.domain.models import ModelConfig, Provider, RetryConfig
from app.infrastructure.config import Settings
from app.infrastructure.logging_config import get_logger
from app.infrastructure.models.base import ModelClient
from app.infrastructure.models.catalog import ModelCatalog, build_catalog
from app.infrastructure.models.fake import FakeModelClient
from app.infrastructure.models.openai_compatible import OpenAICompatibleModelClient

logger = get_logger(__name__)


def build_model_client(settings: Settings, config: ModelConfig) -> ModelClient:
    """Client for one captured model configuration (Rule 36: the run's own config decides)."""
    if config.provider is Provider.DETERMINISTIC:
        raise ValueError("deterministic bots do not use the model gateway")
    provider = settings.provider(str(config.provider))
    client = OpenAICompatibleModelClient(provider)
    logger.info(
        "model client built",
        extra={
            "provider": str(config.provider),
            "model": config.model_id,
            "authenticated": provider.resolved_api_key() is not None,
        },
    )
    return client


def build_default_model_client(settings: Settings) -> ModelClient:
    return build_model_client(settings, default_model_config(settings))


def build_catalog_for(settings: Settings, provider_name: str) -> ModelCatalog:
    return build_catalog(settings.provider(provider_name), cache_seconds=settings.model_catalog_cache_seconds)


def build_fake_client(**kwargs) -> FakeModelClient:
    return FakeModelClient(**kwargs)


def default_model_config(settings: Settings) -> ModelConfig:
    """The workspace default, assembled from configuration (never hard-coded in the graph)."""
    return ModelConfig(
        provider=Provider(settings.default_provider),
        model_id=settings.default_model_id,
        temperature=settings.default_temperature,
        top_p=settings.default_top_p,
        max_output_tokens=settings.default_max_output_tokens,
        timeout_seconds=settings.model_timeout_seconds,
        # Settings and the domain model are separate types on purpose; convert at the boundary.
        retry=RetryConfig.model_validate(settings.model_retry_policy.model_dump()),
    )


def model_config_from_bot(settings: Settings, provider: str, model_id: str, **overrides) -> ModelConfig:
    base = default_model_config(settings)
    return base.model_copy(
        update={
            "provider": Provider(provider),
            "model_id": model_id,
            **{k: v for k, v in overrides.items() if v is not None},
        },
        deep=True,
    )
