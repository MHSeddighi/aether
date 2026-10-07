# Implementation progress

Long-running-agent working notes. Update after every session, keep it short and factual.

---

## Session 1 — 2026-10-07 (States 0, 1, 2, 3, 4, 5, 7)

### Current state
Seven states implemented, tested and committed; each is a separate commit.

| State | Status | Tests |
|---|---|---|
| 0 frontend inspection + contract | done | `docs/api-contract.md` |
| 1 backend foundation | done | `tests/unit/test_foundation.py` (17) |
| 2 domain + PostgreSQL | done | `test_domain.py` (52), `test_repository_mapping.py` (9), migration verified against real Postgres |
| 3 Temporal foundation | done | `test_temporal_errors.py` (32) + **13 workflow tests against a real Temporal server** |
| 4 model gateway | done | `test_model_gateway.py` (51) + **5 live provider checks** |
| 5 LangGraph agent | done | `test_agent_graph.py` (25) |
| 7 tool gateway | done | `test_tool_gateway.py` (36) |

`uv run pytest -q` → **249 passed, 25 skipped** (skips need Postgres / opt-in live provider).
`uv run ruff check .` and `uv run ruff format --check .` are clean.

### Implemented
- **Contract**: REST + SSE surface derived from `web/src/types/agent.ts`; frontend has no network
  code at all, so the backend mirrors its types exactly (`docs/api-contract.md`).
- **Domain**: bots (+immutable versions), tools (+immutable versions), knowledge with an explicit
  status machine, runs + event vocabulary, conversations/messages, accounts, failure taxonomy with
  retry/repair dispositions, `Deadline`, ids.
- **Persistence**: 14 tables in one hand-written Alembic migration; `bot_versions`/`tool_versions`
  are append-only *enforced by a Postgres trigger*; `run_events` gets gap-free sequence numbers
  under a row lock with `ON CONFLICT DO NOTHING`; repositories for all six aggregates.
- **Temporal**: client (pydantic converter), stable workflow ids, error translation into
  `ApplicationError(non_retryable=…)`, `RunAgentWorkflow` (load → start → execute → persist, with
  classified failure/cancellation paths), six activities, worker entrypoint with agent/build roles.
- **Model gateway**: `ModelClient` port split into `ModelCompletion`/`ModelStreaming`; one
  `OpenAICompatibleModelClient` covers openrouter/opencode/deepseek via configuration; fenced-JSON
  and `reasoning_content` normalisation; SDK errors mapped onto the taxonomy; keyless support via
  `AnonymousTransport`; dynamic catalogues with TTL cache and configured fallbacks; fake client.
- **Agent**: LangGraph `plan → act → finalize`, per-run runner selection (deterministic bots never
  reach the gateway), streaming deltas as non-persisted events, step budget, deadline checks,
  tool failures as observations, security failures fatal.
- **Tool Gateway**: input schema → permissions (fail closed) → expired-deadline guard → timeout
  clamped to remaining budget → handler under `asyncio.timeout` → output schema → truncation;
  idempotency cache keyed by `(run_id, tool_call_id)`; builtin handlers (`python_math` AST
  allow-list, `http_request`, `knowledge_search`).

### Session 2 — 2026-10-07 (Docker fixed, full stack verified)

Docker was pulling nothing because every registry answers this network's IPv6 with **HTTP 403**
(Docker surfaces 403 as `RBAC: access denied`), while the host has global IPv6 addresses, so the
daemon always chose the broken path. `"ipv6": false` in `daemon.json` only affects *container*
networking. Fixed without root by pulling through IPv4-only registries and retagging
(`scripts/pull-images.sh`), documented in `docs/running-locally.md` together with the permanent
root-level fixes.

What that unlocked, and what it found:

* Full stack running: `postgres` + `temporal` + `api` + `worker-agent` (+ `worker-build` idle).
  `/readyz` → `{"status":"ok","checks":{"postgres":true,"temporal":true}}`, agent worker connected to
  `temporal:7233`.
* **20 database integration tests now run for real** (they were skipped in session 1). They exposed:
  * **production bug** — `RunRepository.append_event` used `ON CONFLICT DO NOTHING (run_id, seq)`,
    so a replayed event with a fresh sequence number violated the `run_events` primary key instead of
    being a no-op. Now conflicts on *any* constraint are ignored and the stored `seq` is read back.
  * **production bug** — `/readyz` registered `_temporal_ping(settings)` (the coroutine) instead of a
    callable, so the probe silently reported "degraded" forever. `ReadinessRegistry.register` now
    rejects non-callables, with a test.
  * test-isolation: rows leaked between tests (now `TRUNCATE … RESTART IDENTITY CASCADE` per test);
    and a failed statement poisons a SQLAlchemy session, so tests now roll back explicitly.
* Compose ports made configurable (default Postgres `55432`) because 5432/5433 are occupied here.
* The app factory now registers its Postgres and Temporal readiness probes (States 1/3 completion).

**Full suite with real Postgres + real Temporal + live provider: 276 passed, 0 skipped.**

### Verified live (real provider, real server)
- `opencode/space-bunny-free` through the gateway: completion, tool calling, `json_schema`,
  streaming, catalogue — all pass.
- Temporal time-skipping test environment: 13 workflow tests (success, retryable timeout retried
  once, security failure not retried, load/persist failures, cancellation, workflow-id
  idempotency, activity timeout).
- Migration SQL applied to a real Postgres engine (PGlite, PG 18 WASM): 14 tables, trigger rejects
  UPDATE/DELETE on `bot_versions`, `uq_run_events_run_id_seq` enforced, idempotent insert = 0 rows,
  JSONB round trip, clean downgrade.

### Known issues / environment limits
- Docker Hub is unusable over IPv6 on this network; the local stack works through
  `scripts/pull-images.sh` + retags. Permanent fix needs root (see `docs/running-locally.md`).
- The State 10 Docker sandbox cannot be exercised beyond `docker run` smoke tests here (no registry
  access to pull a Python base image is now solved by the retags, but the sandbox tests still need
  State 10 code).
- `langgraph` should be pinned before release (see below).
- `DEEPSEEK_API_KEY` was removed from `~/.bashrc` (backup `~/.bashrc.bak.20261007181139`) per
  request; the DeepSeek adapter is implemented and configured by URL only, with no key.
- No `OPENROUTER_API_KEY` is configured anywhere in the backend (a key exists inside OpenCode's own
  credential store, which the backend deliberately does not read).
- `langgraph` is pinned loosely (`>=0.2.50`) and resolves to 1.2.x; the graph uses only
  `StateGraph`/`add_node`/`add_conditional_edges`, but the version should be pinned before release.

### Architecture decisions
1. Domain invariants raise `ValueError` (surfacing as pydantic `ValidationError`); the API layer
   converts them to classified `ValidationFailure`s. This keeps pydantic and the taxonomy honest.
2. Unclassified exceptions are **never** retried (`FailureReason.UNEXPECTED` is non-retryable): a
   bug is not a blip, and blind retries hide defects.
3. Cancellation detection walks the whole `__cause__` chain, because a cancelled activity usually
   arrives wrapped in an `ActivityError`.
4. The durable `cancelled` run status is written by the *canceller* (State 8's `RunService.cancel`)
   before asking Temporal to stop, because Temporal closes a cancelled workflow immediately and
   abandons the workflow-side cleanup activity. `RunRepository.finish` is idempotent, so the two
   paths never conflict. The workflow keeps its cleanup as a fallback for external cancellations.
5. The activity container holds **factories**, not instances: a run builds its model client from its
   own captured config (Rule 36), and the tool gateway is shared per worker process.
6. Providers are configuration only: base URL, key env var, extra headers, catalogue URL and
   fallback model list. No model id appears in graph nodes, tests or prompts.
7. `ToolSpec` is a complete execution contract (schemas + handler + timeout + permissions), so the
   gateway needs no database access and the graph needs no tool registry.

### Next task
**State 8 — Run API + cancellation + JWT auth.** (unchanged; the stack it needs is now running) Order of work:
1. `app/infrastructure/auth/jwt.py`: access/refresh tokens (HS256, `sub`, `workspace_id`, `exp`),
   argon2 password hashing.
2. `app/application/{auth_service,bot_service,run_service,conversation_service}.py`: thin use cases
   over the repositories. `RunService.start` must: load the bot, refuse disabled/archived bots,
   snapshot `bot_version_id` + model config onto the run, insert the run, and start
   `RunAgentWorkflow` with `workflow_id = run:<run_id>`; treat `WorkflowAlreadyStartedError` as
   idempotent success. `RunService.cancel` persists `cancelled` + `run.cancelled` event **first**,
   then requests cancellation.
3. `app/api/routes/{auth,bots,runs,conversations,models}.py` + `app/api/deps.py` for the auth and
   session dependencies; register them in `_register_routers` and create the `Database` on the app.
4. Tests: service-level unit tests with in-memory fake repositories (no Postgres needed) plus
   `tests/integration/test_api.py` gated on `TEST_DATABASE_URL`. Keep the frontend shapes exactly as
   documented in `docs/api-contract.md` (camelCase, `BotItem`/`ToolItem`/`KnowledgeItem`/
   `ChatConversation` literals).
5. Then **State 9** (`GET /runs/{id}/events`, `GET /runs/{id}/stream` with `Last-Event-ID`), then
   **State 6**'s bounded repair for bot proposals, then **State 10** (build workflow + sandbox,
   unverifiable in this sandbox but implementable), 11, 12, 13.

### Useful commands
```bash
cd backend
../scripts/pull-images.sh                         # once, if Docker Hub is IPv6-blocked
docker compose up -d && docker compose ps          # postgres(55432) + temporal(7233) + api + workers
curl -s localhost:8000/readyz                      # postgres + temporal both true

uv run pytest -q                                   # 276 tests with everything above running
TEMPORAL_TEST_SERVER=1 uv run pytest tests/integration/test_workflow.py
LIVE_PROVIDER=opencode LIVE_MODEL=space-bunny-free uv run pytest tests/integration/test_model_gateway_live.py
```

---

## Session 3 — 2026-10-07 (States 8, 9) — from git history, not previously written up

- **State 8** (`0d17666`): JWT auth (HS256 access/refresh, argon2), application services over the
  repositories, the full REST surface, workspace scoping, configurable model catalogue.
- **State 9** (`4347293`): resumable SSE over the durable `run_events` table — `GET /runs/{id}/events`
  for history and `GET /runs/{id}/stream` (via `sse-starlette`) honouring `Last-Event-ID` and
  `?after_seq=`; token deltas are live-only.

## Session 4 — 2026-10-08 (States 6, 10, 11, 12, 13; 0-5,7,8,9 verified)

### Current state
All 14 states are implemented and green. `feature-list.json` reports every state and feature
`passing`.

| State | Status | Evidence |
|---|---|---|
| 0-5, 7 | verified | their existing tests still pass |
| 6 validation + repair | done | `tests/unit/test_repair.py` |
| 8 run API + cancellation | verified | `tests/unit/test_services.py`, `tests/integration/test_api.py` |
| 9 SSE | verified | `tests/unit/test_event_stream.py`, `tests/integration/test_api.py` |
| 10 build workflow + sandbox + knowledge indexing | done | `tests/integration/test_build_workflow.py` (10), `tests/integration/test_index_knowledge.py` (5), `tests/unit/test_sandbox.py` |
| 11 evaluation layer | done | `tests/unit/test_evaluation.py` |
| 12 end-to-end | done | `tests/integration/test_end_to_end.py` (4) |
| 13 architecture cleanup | done | `tests/unit/test_architecture.py` |

**Full suite with real Postgres (55432) + real Temporal test server: 550 passed, 5 skipped** (skips
need an opt-in live provider). `uv run ruff check .` and `ruff format --check .` are clean.

### Implemented this session
- **State 6**: bounded self-repair (`app/agents/repair.py`, max 2) and `ProposalGenerator`
  (`app/agents/proposal.py`) — schema validation then business constraints, deterministic
  (temperature 0); the LangGraph `propose` node is selected from the conversation mode.
- **State 10**: `BuildBotWorkflow` with a durable checkpoint after each expensive/irreversible step;
  the Docker sandbox (`--network=none`, read-only, cap-drop, pids/memory/cpu limits, hard timeout);
  build service/repository/routes and the Temporal starters. `IndexKnowledgeWorkflow` is now actually
  **started on upload** via `TemporalKnowledgeStarter` (stable id `kb:<source_id>`).
- **State 11**: `app/evaluation` — four focused evaluators (Output, Failure, Security, Regression)
  over the real agent + Tool Gateway with fakes, plus `FailingModelClient`.
- **State 12**: a real end-to-end test through API → Temporal → agent → fake model → Postgres → SSE.
- **State 13**: removed dead code (`now_utc`, `now`, `remove_image`, `new_idempotency_key`,
  `failed_tool_activity`, `build_database`, `is_deterministic`, the unused `KnowledgeService` infra
  import) and added `tests/unit/test_architecture.py` to enforce dependency direction.

### Bugs found and fixed (all were invisible to the fake-starter tests)
1. **`agent.completed` was not in `RunEventType`** — every *real* agent run failed while persisting
   its completion event. Only the end-to-end test could catch this. (Fixed in `app/domain/runs.py`.)
2. **Build workflow checkpointed failures against the step `"unknown"`**, which `BuildStep` rejects —
   the failure path itself was broken.
3. **Build workflow treated the loaded spec as a model**, but `load_build_spec` returns a dict — the
   happy path would have raised `AttributeError`.
4. **Index workflow passed an `AgentError` object into an activity payload** (not JSON-serialisable),
   so knowledge failures silently never persisted and sources stuck in `Indexing`.
5. **Index/workflow `_advance` did not accept the `error` argument** its `_fail` path passed.
6. **Security gap**: the graph executed model tool calls for tools the bot had **not declared** — a
   prompt-injection escape. Undeclared calls now fail closed with `SecurityFailure(UNAUTHORIZED_TOOL)`
   (`app/agents/graph.py`).
7. The previous session's `tests/integration/test_build_workflow.py` did not even import (undefined
   `workflow_method_shim`); replaced with a real time-skipping test that registers stubs under the
   production activity names.

### Architecture decisions this session
- Knowledge indexing is ownership-split like runs/builds: the use case starts the workflow; the
  workflow only advances status through activities.
- Sandbox failure classes reuse the taxonomy (`ToolFailure`/`DeadlineExceededFailure`), so a build
  failure is never a bare `FAILED`.
- The evaluation layer drives production code rather than re-implementing it; only the model provider
  is faked.

### Known issues / next task
- **No static typechecker is configured.** `ruff` + the new architecture test are the gate. Running
  `mypy` exposes a pre-existing smell: many repository/service methods are named `list`, which shadows
  the builtin `list` in annotations (e.g. `def list(...) -> list[X]`). Fixing it means renaming those
  methods to `list_all` across ports, repositories, services, routes and tests. Deliberately deferred:
  it is a mechanical, cross-cutting rename and should be its own change.
- The Docker sandbox is unit-tested at the policy boundary; it was `docker run` smoke-tested in
  session 2 but a real image build is not exercised in CI on this network (Docker Hub IPv6 issue).
- `langgraph` should still be pinned before release.
- A frontend data layer (fetch/SSE) remains a separate, explicit later step; `web/` is untouched.

### Useful commands (session 4)
```bash
cd backend
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:55432/botbuilder_test \
  TEMPORAL_TEST_SERVER=1 uv run pytest -q          # 550 passed, 5 skipped
uv run ruff check . && uv run ruff format --check .
```


## Session 5 — 2026-10-08 (frontend ↔ backend integration)

### Current state
The React frontend is now wired to the backend; `web/src/data/mockData.ts` is deleted and the only
browser-local state is presentation settings plus the JWT pair. Verified with a real headless-browser
E2E against the running stack: **18/18 checks pass**.

### Implemented
- **`web/src/lib/api.ts`** — one typed client: auth (register/login/refresh/me/logout), bots, tools,
  knowledge (multipart), conversations/messages/feedback, runs, models. Single-flight token refresh
  on 401; the backend error envelope is normalised into `ApiError`.
- **`web/src/lib/sse.ts`** — run streaming over `fetch` (EventSource cannot send an auth header),
  assembling `id`/`event`/`data` frames from the durable event stream.
- **`WorkspaceContext`** rewritten to be server-backed: boot validates the token via `/auth/me` and
  loads the workspace; sign-in/up mint tokens; `sendMessage` creates the conversation, posts the
  turn, and streams `agent.delta` into the assistant bubble; `stopStreaming` cancels the run;
  knowledge uploads poll until the indexing workflow reaches a terminal status. A brand-new workspace
  gets one seeded "Assistant" bot so chat works immediately.
- **Auth screen** now does real async sign-in/up with error and busy states.
- **Knowledge screen** uploads real bytes instead of fabricating `Ready` rows.
- **Vite** proxies `/api` to `:8000` (override with `VITE_API_PROXY_TARGET`).
- **`scripts/e2e/run.mjs`** — the browser E2E harness (sign-up → streamed reply → bots → knowledge →
  multi-turn → reload → no runtime errors).

### Bugs found and fixed during integration
1. **Multi-turn was broken.** `RunService._history` emitted the message contract's `"bot"` sender,
   but the agent's `ConversationTurn` only accepts `"user"`/`"assistant"` — so the *second* message in
   every conversation failed validation. The old unit test asserted the wrong value; corrected it to
   `("assistant", ...)` as the regression.
2. **Model failures lost their classification across the activity boundary** — a 429 reached the
   workflow as `unexpected` and was retried blindly. `execute_agent` now raises
   `to_activity_error(exc)`, so a rate limit is `retryable` and classified.
3. **Failed runs never finalised the assistant message**, so the error the user saw during streaming
   vanished on reload. `fail_run` now writes the failure into the assistant bubble.
4. **Knowledge indexing could not read uploads** — `worker-agent` had no `data` volume while the API
   wrote the blobs there. Added `data:/data` to both workers in `docker-compose.yml`.
5. **Invalid HTML**: the bot card was a `<button>` containing the `M3Switch` `<button>`, which React
   reports as a nested-button error. The card header is now an accessible `div[role=button]`.
6. The proposal payload stored on a message was snake_case while the UI expects camelCase; added
   `BotProposal`/`ToolProposal.to_frontend_payload`.

### Verification
- `npm run lint` (tsc) and `npm run build` clean; `web/src/data/mockData.ts` removed.
- Backend: **550 passed, 5 skipped** with real Postgres + Temporal; `ruff` clean.
- `node scripts/e2e/run.mjs` → **18/18**: sign-up, seeded bot, streamed chat reply persisted
  ("Hello, nice to meet you."), `run.completed` events, knowledge upload indexed to `Ready`,
  deterministic multi-turn regression, session survives reload, no console/page errors.

### Known issues / next task
- The free provider occasionally returns 429; the E2E retries that specific classified failure.
- The studio playground now starts a real run; unsaved editor changes are not yet run (runs use the
  saved version).
- Static typechecker still not configured for the backend (see session 4).
