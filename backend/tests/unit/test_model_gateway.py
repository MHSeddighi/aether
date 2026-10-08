"""State 4 — model gateway: payload rendering, normalisation, error translation, catalogues."""

from __future__ import annotations

import json

import httpx
import pytest
from app.domain.failures import FailureReason, ModelFailure
from app.domain.models import CatalogModel, ModelConfig, Provider
from app.domain.tools import ToolPermission
from app.infrastructure.config import ProviderConfig, Settings
from app.infrastructure.models.base import (
    GenerationRequest,
    ModelClient,
    ModelTool,
    ToolCall,
    assistant_message,
    system_message,
    tool_result_message,
    user_message,
)
from app.infrastructure.models.catalog import HttpModelCatalog, StaticModelCatalog, build_catalog
from app.infrastructure.models.fake import FakeModelClient, ScriptedResponse
from app.infrastructure.models.gateway import (
    build_model_client,
    default_model_config,
    model_config_from_bot,
)
from app.infrastructure.models.openai_compatible import (
    AnonymousTransport,
    OpenAICompatibleModelClient,
    _normalise_text,
    translate_error,
)
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI, RateLimitError
from pydantic import ValidationError

ZEN = ProviderConfig(
    name="opencode",
    base_url="https://opencode.ai/zen/v1",
    api_key_env="OPENCODE_API_KEY",
    catalog_url="https://opencode.ai/zen/v1/models",
    default_model_id="space-bunny-free",
    fallback_models=[("space-bunny-free", "Space Bunny Free")],
    extra_headers={"X-Test": "1"},
)
OPENROUTER = ProviderConfig(
    name="openrouter",
    base_url="https://openrouter.ai/api/v1",
    api_key_env="OPENROUTER_API_KEY",
    catalog_url="https://openrouter.ai/api/v1/models",
    extra_headers={"HTTP-Referer": "https://example.test", "X-Title": "bot-builder"},
)
DEEPSEEK = ProviderConfig(
    name="deepseek",
    base_url="https://api.deepseek.com/v1",
    api_key_env="DEEPSEEK_API_KEY",
    default_model_id="deepseek-chat",
    fallback_models=[("deepseek-chat", "DeepSeek Chat")],
    json_schema_supported=False,
)

MODEL = ModelConfig(provider=Provider.OPENCODE, model_id="space-bunny-free", temperature=0.3)


def request_for(**overrides) -> GenerationRequest:
    payload = {
        "model": MODEL,
        "messages": (system_message("be helpful"), user_message("hello")),
    }
    payload.update(overrides)
    return GenerationRequest(**payload)


def make_client(provider: ProviderConfig = ZEN, handler=None) -> OpenAICompatibleModelClient:
    """Client whose transport is stubbed with `httpx.MockTransport`, so no network is used."""
    transport = httpx.MockTransport(handler or _json_response({"choices": []}))
    http_client = httpx.AsyncClient(transport=transport)
    return OpenAICompatibleModelClient(provider, http_client=http_client)


def _json_response(payload: dict, status_code: int = 200) -> object:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(status_code, json=payload)

    return handler


def completion_payload(**overrides) -> dict:
    payload = {
        "id": "cmpl_1",
        "model": "space-bunny-free",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "Hello there"},
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 5},
    }
    payload.update(overrides)
    return payload


class TestPayloadRendering:
    def test_messages_are_rendered_in_openai_shape(self) -> None:
        client = make_client()
        payload = client._build_payload(request_for(), stream=False)
        assert payload["model"] == "space-bunny-free"
        assert payload["messages"] == [
            {"role": "system", "content": "be helpful"},
            {"role": "user", "content": "hello"},
        ]
        assert payload["temperature"] == 0.3
        assert payload["max_tokens"] == 2048

    def test_tool_calls_are_rendered_with_json_arguments(self) -> None:
        call = ToolCall(id="call_1", name="web_search", arguments={"query": "weather"})
        client = make_client()
        payload = client._build_payload(
            request_for(messages=(user_message("hi"), assistant_message("", (call,)))),
            stream=False,
        )
        rendered = payload["messages"][1]["tool_calls"][0]
        assert rendered["function"]["name"] == "web_search"
        assert json.loads(rendered["function"]["arguments"]) == {"query": "weather"}

    def test_tool_results_reference_their_call(self) -> None:
        client = make_client()
        payload = client._build_payload(
            request_for(messages=(tool_result_message("call_1", "web_search", "{}"),)), stream=False
        )
        assert payload["messages"][0]["tool_call_id"] == "call_1"
        assert payload["messages"][0]["name"] == "web_search"

    def test_tools_and_schema_are_included_when_present(self) -> None:
        client = make_client()
        payload = client._build_payload(
            request_for(
                tools=(
                    ModelTool(
                        name="web_search",
                        description="search",
                        input_schema={"type": "object"},
                        permissions=(ToolPermission.NETWORK,),
                    ),
                ),
                response_schema={"title": "BotProposal", "type": "object"},
            ),
            stream=False,
        )
        assert payload["tools"][0]["function"]["name"] == "web_search"
        assert payload["tool_choice"] == "auto"
        assert payload["response_format"]["type"] == "json_schema"
        assert payload["response_format"]["json_schema"]["name"] == "BotProposal"

    def test_provider_without_json_schema_falls_back_to_json_object(self) -> None:
        """DeepSeek rejects `json_schema`; the adapter degrades to `json_object` and Pydantic still
        validates the parsed payload downstream."""
        client = make_client(DEEPSEEK)
        payload = client._build_payload(
            request_for(response_schema={"title": "BotProposal", "type": "object"}),
            stream=False,
        )
        assert payload["response_format"] == {"type": "json_object"}

    def test_streaming_requests_usage(self) -> None:
        assert make_client()._build_payload(request_for(), stream=True)["stream_options"] == {
            "include_usage": True
        }

    def test_overrides_take_precedence_over_the_model_config(self) -> None:
        payload = make_client()._build_payload(
            request_for(temperature=0.9, max_output_tokens=128), stream=False
        )
        assert payload["temperature"] == 0.9
        assert payload["max_tokens"] == 128


class TestCompletionNormalisation:
    async def test_completion_maps_provider_fields(self) -> None:
        client = make_client(handler=_json_response(completion_payload()))
        completion = await client.complete(request_for())
        assert completion.text == "Hello there"
        assert completion.input_tokens == 12
        assert completion.output_tokens == 5
        assert completion.finish_reason == "stop"
        assert completion.reasoning is None

    async def test_fenced_json_is_unwrapped(self) -> None:
        payload = completion_payload()
        payload["choices"][0]["message"]["content"] = '```json\n{"name": "Testy"}\n```'
        client = make_client(handler=_json_response(payload))
        completion = await client.complete(request_for())
        assert json.loads(completion.text) == {"name": "Testy"}

    async def test_reasoning_content_is_kept_out_of_the_answer(self) -> None:
        payload = completion_payload()
        payload["choices"][0]["message"]["reasoning_content"] = "internal thinking"
        client = make_client(handler=_json_response(payload))
        completion = await client.complete(request_for())
        assert completion.reasoning == "internal thinking"
        assert completion.text == "Hello there"
        assert "internal thinking" not in completion.text

    async def test_tool_calls_are_parsed_and_bad_json_degrades(self) -> None:
        payload = completion_payload()
        payload["choices"][0]["finish_reason"] = "tool_calls"
        payload["choices"][0]["message"]["tool_calls"] = [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "web_search", "arguments": '{"query": "tehran"}'},
            },
            {"id": "call_2", "type": "function", "function": {"name": "broken", "arguments": "{not json"}},
        ]
        client = make_client(handler=_json_response(payload))
        completion = await client.complete(request_for())
        assert completion.tool_calls[0].arguments == {"query": "tehran"}
        assert completion.tool_calls[1].arguments == {}

    def test_text_normalisation_rules(self) -> None:
        assert _normalise_text(None) == ""
        assert _normalise_text("  hi  ") == "hi"
        assert _normalise_text("```\nplain\n```") == "plain"
        assert _normalise_text("```JSON\n{}\n```") == "{}"


class TestStreaming:
    async def test_stream_yields_normalised_deltas(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            del request
            lines = [
                {"choices": [{"index": 0, "delta": {"content": "Hel"}}]},
                {"choices": [{"index": 0, "delta": {"content": "lo"}}]},
                {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
            ]
            body = "".join(f"data: {json.dumps(line)}\n\n" for line in lines) + "data: [DONE]\n\n"
            return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

        client = make_client(handler=handler)
        chunks = [chunk async for chunk in client.stream(request_for())]
        assert [c.text for c in chunks] == ["Hel", "lo", ""]
        assert chunks[-1].finish_reason == "stop"

    async def test_stream_failure_is_classified(self) -> None:
        client = make_client(handler=_json_response({"error": "boom"}, status_code=503))
        with pytest.raises(ModelFailure) as excinfo:
            [chunk async for chunk in client.stream(request_for())]
        assert excinfo.value.reason is FailureReason.MODEL_PROVIDER_ERROR
        assert excinfo.value.retryable


class TestErrorTranslation:
    @pytest.mark.parametrize(
        ("status", "reason", "retryable"),
        [
            (429, FailureReason.MODEL_RATE_LIMITED, True),
            (500, FailureReason.MODEL_PROVIDER_ERROR, True),
            (503, FailureReason.MODEL_PROVIDER_ERROR, True),
            (401, FailureReason.MODEL_AUTH, False),
            (403, FailureReason.MODEL_AUTH, False),
            (400, FailureReason.MODEL_BAD_REQUEST, False),
            (404, FailureReason.MODEL_BAD_REQUEST, False),
            (422, FailureReason.MODEL_BAD_REQUEST, False),
        ],
    )
    def test_status_codes_map_to_reasons(self, status: int, reason, retryable: bool) -> None:
        error = APIStatusError(
            f"status {status}",
            response=httpx.Response(status, request=httpx.Request("POST", "http://x")),
            body=None,
        )
        failure = translate_error(error, "openrouter", "model")
        assert failure.reason is reason
        assert failure.retryable is retryable

    def test_timeouts_map_to_a_retryable_model_timeout(self) -> None:
        failure = translate_error(APITimeoutError(request=httpx.Request("POST", "http://x")), "zen", "m")
        assert failure.reason is FailureReason.MODEL_TIMEOUT
        assert failure.retryable

    def test_rate_limit_error_type_maps_to_rate_limited(self) -> None:
        error = RateLimitError(
            "slow down",
            response=httpx.Response(429, request=httpx.Request("POST", "http://x")),
            body=None,
        )
        assert translate_error(error, "zen", "m").reason is FailureReason.MODEL_RATE_LIMITED

    def test_connection_errors_map_to_a_retryable_provider_error(self) -> None:
        error = APIConnectionError(request=httpx.Request("POST", "http://x"))
        failure = translate_error(error, "zen", "m")
        assert failure.reason is FailureReason.MODEL_PROVIDER_ERROR
        assert "cannot reach" in failure.message

    def test_already_classified_failures_pass_through(self) -> None:
        original = ModelFailure(FailureReason.MODEL_AUTH, "nope")
        assert translate_error(original, "zen", "m") is original

    def test_failure_details_carry_provider_and_model(self) -> None:
        error = APIStatusError(
            "boom", response=httpx.Response(500, request=httpx.Request("POST", "http://x")), body=None
        )
        assert translate_error(error, "openrouter", "space-bunny-free").details == {
            "provider": "openrouter",
            "model": "space-bunny-free",
            "error": "APIStatusError",
            "status": 500,
        }


class TestCatalog:
    async def test_openrouter_catalogue_marks_free_models(self) -> None:
        payload = {
            "data": [
                {
                    "id": "deepseek/deepseek-chat:free",
                    "name": "DeepSeek Chat (free)",
                    "pricing": {"prompt": "0", "completion": "0"},
                    "context_length": 128000,
                },
                {"id": "vendor/paid", "name": "Paid", "pricing": {"prompt": "0.000002", "completion": "0"}},
            ]
        }
        catalogue = HttpModelCatalog(
            OPENROUTER, client=httpx.AsyncClient(transport=httpx.MockTransport(_json_response(payload)))
        )
        models = await catalogue.models()
        free = {m.model_id: m for m in models}
        assert free["deepseek/deepseek-chat:free"].free is True
        assert free["deepseek/deepseek-chat:free"].label == "DeepSeek Chat (free)"
        assert free["deepseek/deepseek-chat:free"].context_window == 128000
        assert free["vendor/paid"].free is False

    async def test_catalogue_falls_back_to_configuration_when_unreachable(self) -> None:
        def boom(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no network", request=request)

        catalogue = HttpModelCatalog(ZEN, client=httpx.AsyncClient(transport=httpx.MockTransport(boom)))
        models = await catalogue.models()
        assert [m.model_id for m in models] == ["space-bunny-free"]
        assert models[0].free is True
        assert models[0].provider is Provider.OPENCODE

    async def test_catalogue_results_are_cached(self) -> None:
        calls: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            del request
            calls.append(1)
            return httpx.Response(200, json={"data": [{"id": "space-bunny-free"}]})

        catalogue = HttpModelCatalog(ZEN, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        await catalogue.models()
        await catalogue.models()
        assert len(calls) == 1
        await catalogue.models(force_refresh=True)
        assert len(calls) == 2

    async def test_deepseek_has_no_catalogue_and_uses_its_config(self) -> None:
        models = await StaticModelCatalog(DEEPSEEK).models()
        assert [m.model_id for m in models] == ["deepseek-chat"]
        assert isinstance(build_catalog(DEEPSEEK), StaticModelCatalog)
        assert isinstance(build_catalog(ZEN), HttpModelCatalog)

    async def test_malformed_catalogue_payload_is_ignored(self) -> None:
        catalogue = HttpModelCatalog(
            ZEN, client=httpx.AsyncClient(transport=httpx.MockTransport(_json_response({"unexpected": True})))
        )
        assert [m.model_id for m in await catalogue.models()] == ["space-bunny-free"]


class TestGatewayFactory:
    def test_clients_are_built_from_configuration(self) -> None:
        settings = Settings(_env_file=None)
        client = build_model_client(settings, MODEL)
        assert isinstance(client, OpenAICompatibleModelClient)
        assert client.provider == "opencode"

    def test_default_config_follows_settings(self) -> None:
        settings = Settings(
            _env_file=None, default_provider="openrouter", default_model_id="z-ai/glm-4.5:free"
        )
        config = default_model_config(settings)
        assert config.provider is Provider.OPENROUTER
        assert config.model_id == "z-ai/glm-4.5:free"
        assert config.label == "Glm 4.5 Free", "vendor prefix and :free suffix are dropped"

    def test_bot_overrides_are_applied(self) -> None:
        settings = Settings(_env_file=None)
        config = model_config_from_bot(
            settings, "opencode", "big-pickle", temperature=0.7, max_output_tokens=512
        )
        assert config.model_id == "big-pickle"
        assert config.temperature == 0.7
        assert config.max_output_tokens == 512
        assert config.timeout_seconds == settings.model_timeout_seconds

    def test_deterministic_bots_cannot_reach_the_gateway(self) -> None:
        from app.domain.models import deterministic_config

        with pytest.raises(ValueError, match="deterministic bots do not use the model gateway"):
            build_model_client(Settings(_env_file=None), deterministic_config())


class TestFakeClient:
    async def test_fake_replays_scripted_responses(self) -> None:
        fake = FakeModelClient().queue("first").queue(ScriptedResponse(text="second"))
        assert (await fake.complete(request_for())).text == "first"
        assert (await fake.complete(request_for())).text == "second"
        assert (await fake.complete(request_for())).text == "second", "last response repeats"
        assert len(fake.requests) == 3

    async def test_fake_streams_deltas(self) -> None:
        fake = FakeModelClient().queue("hello world")
        fake.stream_deltas = [["hello", " world"]]
        chunks = [chunk async for chunk in fake.stream(request_for())]
        assert [c.text for c in chunks] == ["hello", " world", ""]

    async def test_fake_satisfies_the_model_client_protocol(self) -> None:
        assert isinstance(FakeModelClient(), ModelClient)

    async def test_fake_records_the_request_for_assertions(self) -> None:
        fake = FakeModelClient().queue("ok")
        await fake.complete(request_for(temperature=0.1))
        assert fake.last_request.temperature == 0.1


class TestPortDesign:
    def test_capability_interfaces_are_separate_and_small(self) -> None:
        from app.infrastructure.models.base import ModelCompletion, ModelStreaming

        assert hasattr(ModelCompletion, "complete")
        assert hasattr(ModelStreaming, "stream")

    def test_model_config_rejects_nonsense_model_ids(self) -> None:
        with pytest.raises(ValidationError):
            ModelConfig(provider=Provider.OPENCODE, model_id="../etc/passwd")

    def test_catalog_model_validates_the_provider(self) -> None:
        assert (
            CatalogModel(
                provider=Provider.OPENCODE, model_id="space-bunny-free", label="Space Bunny Free"
            ).free
            is False
        )


class TestProviderConfiguration:
    def test_each_provider_has_a_distinct_endpoint(self, settings: Settings) -> None:
        urls = {name: settings.provider(name).base_url for name in ("openrouter", "opencode", "deepseek")}
        assert urls == {
            "openrouter": "https://openrouter.ai/api/v1",
            "opencode": "https://opencode.ai/zen/v1",
            "deepseek": "https://api.deepseek.com/v1",
        }

    def test_openrouter_carries_attribution_headers(self, settings: Settings) -> None:
        assert settings.provider("openrouter").extra_headers["X-Title"] == "bot-builder"

    def test_zen_and_deepseek_need_no_key_to_be_configured(self, settings: Settings) -> None:
        assert settings.provider("opencode").api_key_env == "OPENCODE_API_KEY"
        assert settings.provider("deepseek").api_key_env == "DEEPSEEK_API_KEY"

    def test_keys_come_from_the_environment_only(self, settings: Settings, monkeypatch) -> None:
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
        client = OpenAICompatibleModelClient(settings.provider("deepseek"))
        assert isinstance(client, OpenAICompatibleModelClient)
        assert settings.provider("deepseek").resolved_api_key() == "sk-test"


class TestSdkWiring:
    def test_client_uses_the_configured_base_url(self) -> None:
        client = OpenAICompatibleModelClient(ZEN)
        assert str(client._client.base_url).startswith("https://opencode.ai/zen/v1")

    def test_client_works_without_an_api_key(self, monkeypatch) -> None:
        """Zen serves free models anonymously: a placeholder key must be stripped before the wire."""

        monkeypatch.delenv("OPENCODE_API_KEY", raising=False)
        client = OpenAICompatibleModelClient(ZEN)
        assert client._client.api_key == "no-key-required"

        transport = client._client._client._transport if hasattr(client._client, "_client") else None
        assert isinstance(transport, AnonymousTransport), "keyless providers must strip the header"

    def test_client_sends_provider_headers_and_extra_headers(self, monkeypatch) -> None:
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
        client = OpenAICompatibleModelClient(OPENROUTER)
        headers = {**client._client.auth_headers, **client._client.default_headers}
        assert headers.get("Authorization") == "Bearer sk-or-test"
        assert headers.get("X-Title") == "bot-builder"

    def test_sdk_retries_are_disabled_so_the_taxonomy_governs(self) -> None:
        assert OpenAICompatibleModelClient(ZEN)._client.max_retries == 0

    def test_client_is_constructible_with_an_injected_sdk_client(self) -> None:
        sdk = AsyncOpenAI(api_key="x", base_url="http://localhost")
        assert OpenAICompatibleModelClient(ZEN, client=sdk)._client is sdk
