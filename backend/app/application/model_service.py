"""Model catalogue and default-configuration use cases.

Free-model availability is dynamic (Rule 7), so nothing here knows a model id: the answer comes from
whatever catalogue the provider serves, with the configured fallback list used when it cannot be
reached. Swapping `DEFAULT_PROVIDER`/`DEFAULT_MODEL_ID` in the environment changes the product's
default without a code change.
"""

from __future__ import annotations

from collections.abc import Callable

from app.domain.models import CatalogModel, ModelConfig
from app.infrastructure.logging_config import get_logger

logger = get_logger(__name__)

CatalogBuilder = Callable[[str], object]  # provider name -> ModelCatalog


class ModelService:
    def __init__(
        self,
        build_catalog: CatalogBuilder,
        default_config: ModelConfig,
        provider_names: tuple[str, ...] = ("openrouter", "opencode", "deepseek"),
    ) -> None:
        self._build_catalog = build_catalog
        self._default = default_config
        self._provider_names = provider_names

    async def catalogue(self) -> list[CatalogModel]:
        """Every configured provider's catalogue.

        A provider that cannot be reached — or whose catalogue cannot even be constructed — is
        skipped, not fatal: the settings page must still render the providers that work.
        """
        models: list[CatalogModel] = []
        for name in self._provider_names:
            try:
                catalog = self._build_catalog(name)
                models.extend(await catalog.models())  # type: ignore[attr-defined]
            except Exception:
                logger.warning("model catalogue failed", extra={"provider": name}, exc_info=True)
        return models

    def default_model_config(self) -> ModelConfig:
        return self._default
