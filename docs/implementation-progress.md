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
