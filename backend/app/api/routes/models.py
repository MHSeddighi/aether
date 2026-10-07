"""Model catalogue route.

`GET /models` reads the configured provider catalogues and returns `provider, model_id, label, free,
context_window`. There is no hard-coded list anywhere (Rule 7): whatever the providers serve today is
what the settings screen shows, and an unreachable provider falls back to its configured list.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser, ModelServiceDep

router = APIRouter(prefix="/models", tags=["models"])

# The `_` parameter is `CurrentUser` on purpose: the catalogue is provider-wide, but the route still
# requires authentication like every other resource.


@router.get("")
async def list_models(service: ModelServiceDep, _: CurrentUser) -> list[dict]:
    models = await service.catalogue()
    return [
        {
            "provider": str(model.provider),
            "model_id": model.model_id,
            "label": model.label,
            "free": model.free,
            "context_window": model.context_window,
        }
        for model in models
    ]


@router.get("/default")
async def default_model(service: ModelServiceDep, _: CurrentUser) -> dict:
    """The configured default (provider + model id), so a client can preselect it."""
    config = service.default_model_config()
    return {
        "provider": str(config.provider),
        "model_id": config.model_id,
        "label": config.label,
        "temperature": config.temperature,
        "top_p": config.top_p,
        "max_output_tokens": config.max_output_tokens,
        "timeout_seconds": config.timeout_seconds,
        "retry": config.retry.model_dump(),
    }
