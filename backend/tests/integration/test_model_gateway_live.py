"""Live smoke test of the model gateway.

Opt-in: it calls a real provider. Point it at any configured provider with
`LIVE_PROVIDER=opencode|openrouter|deepseek` and `LIVE_MODEL=<model id>`:

    uv run python -m scripts.live_model_check

Skipped by default so `pytest` never spends money or hits rate limits.
"""

from __future__ import annotations

import os

import pytest
from app.domain.models import ModelConfig, Provider
from app.infrastructure.config import Settings
from app.infrastructure.models.base import GenerationRequest, ModelTool, user_message
from app.infrastructure.models.gateway import build_model_client

pytestmark = pytest.mark.integration

LIVE_PROVIDER = os.getenv("LIVE_PROVIDER")
LIVE_MODEL = os.getenv("LIVE_MODEL")


@pytest.fixture
def live_client():
    if not LIVE_PROVIDER or not LIVE_MODEL:
        pytest.skip("set LIVE_PROVIDER and LIVE_MODEL to run live provider checks")
    settings = Settings()
    config = ModelConfig(provider=Provider(LIVE_PROVIDER), model_id=LIVE_MODEL)
    return build_model_client(settings, config), config


async def test_live_completion(live_client) -> None:
    client, config = live_client
    completion = await client.complete(
        GenerationRequest(model=config, messages=(user_message("Reply with exactly: PONG"),))
    )
    assert completion.text.strip()
    assert completion.input_tokens > 0


async def test_live_tool_call(live_client) -> None:
    client, config = live_client
    request = GenerationRequest(
        model=config,
        messages=(user_message("What is the weather in Tehran? Use the tool."),),
        tools=(
            ModelTool(
                name="get_weather",
                description="Get the weather for a city",
                input_schema={
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
            ),
        ),
    )
    completion = await client.complete(request)
    assert completion.tool_calls, f"expected a tool call, got: {completion.text[:200]}"
    assert completion.tool_calls[0].name == "get_weather"
    assert "city" in completion.tool_calls[0].arguments


async def test_live_json_schema(live_client) -> None:
    """Fenced JSON is normalised away, so this must parse as strict JSON (Rule 21)."""
    client, config = live_client
    import json

    from app.domain.models import humanize_model_id  # noqa: F401  (documents the label path)

    completion = await client.complete(
        GenerationRequest(
            model=config,
            messages=(
                user_message(
                    'Return a JSON object for a bot named "Testy" with description "d" and temperature 0.2.'
                ),
            ),
            response_schema={
                "title": "BotProposal",
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "temperature": {"type": "number"},
                },
                "required": ["name", "description", "temperature"],
            },
        )
    )
    payload = json.loads(completion.text)
    assert payload["name"] == "Testy"


async def test_live_stream(live_client) -> None:
    client, config = live_client
    chunks = [
        chunk
        async for chunk in client.stream(
            GenerationRequest(model=config, messages=(user_message("Count: 1 2 3"),))
        )
    ]
    assert any(chunk.text for chunk in chunks)


async def test_live_catalogue() -> None:
    if not LIVE_PROVIDER:
        pytest.skip("set LIVE_PROVIDER to run the live catalogue check")
    from app.infrastructure.models.gateway import build_catalog_for

    settings = Settings()
    catalogue = build_catalog_for(settings, LIVE_PROVIDER)
    models = await catalogue.models(force_refresh=True)
    assert models, "catalogue returned no models"
