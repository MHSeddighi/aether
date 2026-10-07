# Implementation progress

Long-running-agent working notes. Update after every session, keep it short and factual.

---

## Session 1 — 2026-10-07

### Current state
States 0, 1 and 2 are complete and committed. States 3+ are not started.
`backend/` boots (`uvicorn app.main:app`), 88 unit tests pass, lint and format clean.
Integration tests exist but are **skipped** in this environment (see Known issues).

### Implemented

**State 0 — frontend inspection (contract)**
- `docs/api-contract.md`: full REST + SSE contract derived from `web/src/types/agent.ts` and the
  lifecycles in `web/src/context/WorkspaceContext.tsx`. Finding of note: the frontend has **zero**
  network code — every "agent" behaviour is `setTimeout` + hardcoded strings.
- `docs/architecture.md`: boundaries, ports, durability rules, failure taxonomy.
- Decisions taken with the user: backend-first (no frontend edits), backend owns `model_id` and
  derives the display label, full JWT auth with users/workspaces, all three provider adapters
  implemented with `opencode/space-bunny-free` as the test model.

**State 1 — foundation**
- `backend/` uv project: FastAPI, SQLAlchemy 2 + asyncpg, Alembic, Temporal, LangGraph, OpenAI SDK,
  PyJWT, argon2, sse-starlette. `uv.lock` committed.
- `Settings` (pydantic-settings) with providers as **configuration**: base URLs, optional
  `api_key_env`, catalogue URLs, fallback model lists. Default `opencode/space-bunny-free`.
- JSON logging on stdlib logging, request-id middleware, typed error envelope, `/healthz` + `/readyz`
  with dependency checks registered by the owning component.
- `Dockerfile` + `docker-compose.yml` (Postgres + Temporal + api + two workers only).

**State 2 — domain and database**
- Domain: `models` (ModelConfig/catalog/labels), `bots`, `tools`, `knowledge`, `runs`, `conversations`,
  `accounts`, `failures`, `deadline`, `ids`. No infrastructure imports.
- Tables: workspaces, users, bots, bot_versions, tools, tool_versions, knowledge_sources, files,
  conversations, messages, runs, run_events, artifacts.
- `bot_versions` and `tool_versions` are append-only **enforced by a Postgres trigger**
  (`reject_version_mutation`), not just by application discipline.
- Repositories for all six aggregates, with the mapping layer unit-tested detached from a database.
- `run_events` allocates `seq` under a row lock and appends with `ON CONFLICT DO NOTHING`, so
  concurrent activities cannot duplicate or skip a sequence number.

### Tests run
```
uv run pytest -q                                  # 88 passed, 20 skipped
uv run pytest tests/unit/test_domain.py           # labels, invariants, transitions, deadlines, failures
uv run pytest tests/unit/test_repository_mapping.py
uv run ruff check . && uv run ruff format --check .
```
Schema validation without Docker: `alembic upgrade head --sql` / `downgrade 0001_initial:base --sql`
were applied to a real Postgres engine (PGlite 0.5.8, PG 18.3 WASM) and verified:
14 tables created, `bot_versions` UPDATE **and** DELETE rejected by the trigger,
`uq_run_events_run_id_seq` enforced, idempotent event insert affected 0 rows, JSONB round trip OK,
downgrade dropped all tables.

### Known issues / environment limits
- **Docker registry access is denied in this sandbox** (`postgres:16-alpine` and
  `temporalio/auto-setup` both fail with RBAC access denied), and there is no root, so no local
  Postgres or Temporal can be installed. Consequence: `tests/integration/*` cannot execute here and
  Temporal workflows cannot be exercised end-to-end yet.
- PGlite (a real Postgres in WASM) speaks the wire protocol fine to node `pg` but **not** to
  `asyncpg` (it hangs during startup), so it cannot back the app's integration tests directly.
- `DEEPSEEK_API_KEY` was removed from `~/.bashrc` (backup `~/.bashrc.bak.20261007181139`) at the
  user's request; the DeepSeek adapter is still implemented, just unconfigured.
- No `OPENROUTER_API_KEY` configured yet (one key exists inside OpenCode's own auth store, which the
  backend does not read).

### Architecture decisions
1. Model identity is `provider` + `model_id`; `model` is derived by `humanize_model_id`. No provider
   logic in graph nodes.
2. One `OpenAICompatibleModelClient` covers OpenRouter, OpenCode Zen and DeepSeek; differences
   (headers, keyless access, fenced JSON, `reasoning_content`) are normalised inside the adapter.
3. Domain invariants raise `ValueError` (surfacing as pydantic `ValidationError`); the API layer
   converts those into the classified `ValidationFailure` used by the failure taxonomy.
4. `BotVersion.model_spec` holds the full execution snapshot so a historical run is reproducible.
5. Events: only meaningful events are persisted; `agent.delta` is streamed live only.
6. Frontend keeps exact literals (`'Connected'`, `'Ready'`, `chat-today-1`, …) so it needs no mapping
   layer when it is wired up later.

### Next task
**State 3 — Temporal foundation.** Client + worker bootstrap, task queues, `RunAgentWorkflow` with
`LoadBotVersion` / `ExecuteAgent` / `PersistRunResult` activities, error classification mapped to
`non_retryable`, and the deterministic (`bot_type='simple'`) path that needs no model. Workflow tests
must be written to run under `temporalio.testing.WorkflowEnvironment` and will be skipped here until
a Temporal server is reachable.
