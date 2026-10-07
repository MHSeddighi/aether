"""Model catalogues.

Free-model availability is dynamic (Rule 7), so nothing hard-codes a list: each catalogue reads the
provider's own `/models` endpoint and falls back to the *configured* list when the endpoint is
unreachable or the provider has no catalogue at all (DeepSeek). Results are cached for a short TTL.
"""

from __future__ import annotations

import time
from typing import Protocol

import httpx

from app.domain.models import CatalogModel, Provider, humanize_model_id
from app.infrastructure.config import ProviderConfig
from app.infrastructure.logging_config import get_logger

logger = get_logger(__name__)


class ModelCatalog(Protocol):
    async def models(self, *, force_refresh: bool = False) -> list[CatalogModel]: ...


class HttpModelCatalog:
    """Reads a provider's catalogue over HTTP and degrades to its configured fallback list."""

    def __init__(
        self,
        provider: ProviderConfig,
        *,
        client: httpx.AsyncClient | None = None,
        cache_seconds: float = 900.0,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._provider = provider
        self._cache_seconds = cache_seconds
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None
        self._cached: list[CatalogModel] | None = None
        self._cached_at: float = 0.0

    @property
    def name(self) -> str:
        return str(self._provider.name)

    async def models(self, *, force_refresh: bool = False) -> list[CatalogModel]:
        if not force_refresh and self._cached is not None and self._is_fresh():
            return self._cached

        entries: list[CatalogModel] = []
        if self._provider.catalog_url:
            try:
                payload = await self._fetch(self._provider.catalog_url)
                entries = self._parse(payload)
            except Exception:
                logger.warning(
                    "model catalogue unavailable, using configured fallback",
                    extra={"provider": self.name},
                    exc_info=True,
                )
        if not entries:
            entries = self._fallback()

        self._cached = entries
        self._cached_at = time.monotonic()
        return entries

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _fetch(self, url: str) -> dict:
        headers = {"Accept": "application/json"}
        api_key = self._provider.resolved_api_key()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        headers.update(self._provider.extra_headers)
        response = await self._client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    def _parse(self, payload: dict) -> list[CatalogModel]:
        items = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            return []
        provider = Provider(self._provider.name)
        models: list[CatalogModel] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or item.get("name") or "").strip()
            if not model_id:
                continue
            context = item.get("context_length") or item.get("limit", {}).get("context")
            models.append(
                CatalogModel(
                    provider=provider,
                    model_id=model_id,
                    label=str(item.get("name") or "").strip() or humanize_model_id(model_id),
                    free=_is_free(item),
                    context_window=int(context) if isinstance(context, int) else None,
                )
            )
        return models

    def _fallback(self) -> list[CatalogModel]:
        provider = Provider(self._provider.name)
        return [
            CatalogModel(
                provider=provider,
                model_id=model_id,
                label=label or humanize_model_id(model_id),
                free=model_id.endswith(("-free", ":free")) or "free" in model_id,
            )
            for model_id, label in self._provider.fallback_models
        ]

    def _is_fresh(self) -> bool:
        return (time.monotonic() - self._cached_at) < self._cache_seconds


def _is_free(item: dict) -> bool:
    pricing = item.get("pricing")
    if isinstance(pricing, dict):
        prompt = str(pricing.get("prompt", "")).strip()
        completion = str(pricing.get("completion", "")).strip()
        if prompt and completion:
            return float(prompt) == 0.0 and float(completion) == 0.0
    model_id = str(item.get("id", "")).lower()
    return model_id.endswith(":free") or model_id.endswith("-free")


class StaticModelCatalog:
    """For providers without a catalogue endpoint (DeepSeek) and for tests."""

    def __init__(self, provider: ProviderConfig) -> None:
        self._provider = provider

    async def models(self, *, force_refresh: bool = False) -> list[CatalogModel]:  # noqa: ARG002
        provider = Provider(self._provider.name)
        return [
            CatalogModel(
                provider=provider,
                model_id=model_id,
                label=label,
                free="free" in model_id,
            )
            for model_id, label in self._provider.fallback_models
        ]


def build_catalog(provider: ProviderConfig, *, cache_seconds: float = 900.0) -> ModelCatalog:
    if provider.catalog_url:
        return HttpModelCatalog(provider, cache_seconds=cache_seconds)
    return StaticModelCatalog(provider)
