# Architecture

## Boundaries

```
web/ (React 19 + Vite; REST + SSE via web/src/lib/api.ts and sse.ts)
      │ REST + SSE
      ▼
FastAPI (app/api)                ── control plane, auth, validation, SSE
      │
      ├──► PostgreSQL (app/infrastructure/database)
      │        application/product state only — never a task queue
      │
      └──► Temporal (app/infrastructure/temporal)
                 │
        ┌────────┴─────────┐
        ▼                  ▼
  RunAgentWorkflow    IndexKnowledgeWorkflow / BuildBotWorkflow
   (agent worker)       (build worker)
        │
        ▼
  LangGraph graph (app/agents) ──► Model Gateway (app/infrastructure/models)
        │                              ├ openrouter
        ▼                              ├ opencode  (Zen)
  Tool Gateway (app/tools)            └ deepseek   (code shipped, key not configured)
        │
        ▼
  builtin tools / http tools / Docker sandbox (State 10)
```

## Layer rules

- `app/domain` — pure Pydantic models, enums, failure taxonomy. Imports nothing from FastAPI,
  SQLAlchemy, Temporal, or provider SDKs.
- `app/application` — use cases (`BotService`, `RunService`, `ToolService`, `KnowledgeService`,
  `BuildService`, `ModelCatalogService`). Depends on domain + injected ports.
- `app/infrastructure` — SQLAlchemy repositories, Temporal client/worker, model gateway providers,
  Docker sandbox, JWT, settings.
- `app/api` — routers + request/response schemas. Thin: parse → call use case → serialise.

## Ports that justify existing (real boundary + multiple implementations + test seam)

| Port | Implementations | Why it exists |
|---|---|---|
| `ModelClient` (`generate`, `stream`) | `OpenAICompatibleModelClient` (one class, per-provider config: base_url, headers, api-key optional), `FakeModelClient` | provider isolation; LangGraph must not know providers |
| `ModelCatalog` | `OpenRouterCatalog`, `OpenCodeCatalog`, `DeepSeekCatalog` | free catalogues are dynamic; never hard-code model ids |
| `ToolHandler` | `builtin` (python: in-process), `http`, `docker` (State 10) | untrusted code boundary |
| `UnitOfWork`/repositories | SQLAlchemy | testability; kept to the few aggregates that need it (no 15 repositories) |

Explicitly **not** ported: clock, uuid, logger.

## Durability rules

- Every long operation is a Temporal workflow; HTTP returns an id immediately (Rule 14).
- Every activity assumes at-least-once execution and is idempotent by `(run_id, step)` keys
  (Rule 18). Expensive/irreversible steps checkpoint *before* execution (Rule 13).
- Workflow code contains no external calls, only activities and deterministic logic (Rule 24).
- Deadlines propagate workflow → activity → agent → tool → HTTP timeout (Rule 17), computed by a
  single `Deadline` value object.

## Failure taxonomy (`app/domain/failures.py`)

```
ModelFailure(kind=timeout|rate_limited|provider_error|auth|bad_request, retryable)
ValidationFailure(kind=schema|constraint, repairable)   -> bounded repair, max 3
ToolFailure(kind=timeout|unavailable|invalid_output|permission_denied|not_found, retryable)
SecurityFailure(kind=unauthorized_tool|unsafe_arguments|sandbox_violation) -> never retried
CancelledError / DeadlineExceededError -> terminal
```
Temporal `ApplicationError(non_retryable=...)` is derived from the taxonomy, so permanent failures
are never blindly retried (Rule 20/26).

## Model gateway

- Providers are **configuration**, not code paths: `provider, base_url, api_key_env, headers`.
- One `OpenAICompatibleModelClient` covers all three providers (OpenAI-compatible wire protocol);
  Zen/OpenRouter differences (extra headers, keyless access, fenced JSON, `reasoning_content`) are
  normalised inside the adapter.
- `response_format=json_schema` is used where supported, and every response is *still* validated by
  Pydantic; fenced JSON is stripped before validation.
- Live probe (2026-10-07): `opencode` `space-bunny-free` works keyless at
  `https://opencode.ai/zen/v1/chat/completions`, supports tool calls, honours `json_schema`
  (model wraps output in ```json fences), and adds `reasoning_content`.

## Streaming

- Provider streaming → adapter → agent events → `RunEventService.persist` → SSE.
- FastAPI `StreamingResponse` + `sse-starlette` for the live stream; no custom broker.
- SSE frames are `id: <seq>` / `event: <type>` / `data: <json>`; reconnection via `Last-Event-ID`.
- Only meaningful events are persisted; `agent.delta` is ephemeral.

## Sandbox (State 10)

Generated code runs via `docker run` with `--network none`, `--cpus`, `--memory`, `--pids-limit`,
read-only rootfs, tmpfs `/tmp`, no socket, no host mounts, no secrets, wall-clock timeout.
