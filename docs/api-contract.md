# State 0 — Frontend inspection and backend contract

Date: 2026-10-07
Scope: `web/` (Vite + React 19 + Tailwind v4, Google AI Studio template).

## 1. What the frontend actually is today

> **Update (session 5):** the frontend is now wired to this backend. `web/src/lib/api.ts` is the
> typed client, `web/src/lib/sse.ts` reads the run stream, and `web/src/context/WorkspaceContext.tsx`
> is server-backed. `web/src/data/mockData.ts` has been deleted and the only browser-local state left
> is presentation settings plus the auth tokens. The notes below are the original State 0 finding and
> are kept for provenance.

- **No network layer at all (State 0).** `grep -rn "fetch(|axios|EventSource|WebSocket|VITE_" web/src` → zero
  matches. All persistence is `localStorage` via `web/src/lib/storage.ts`, all "agent" behaviour is
  `setTimeout` + hardcoded strings in `web/src/context/WorkspaceContext.tsx`.
- Hash router only (`web/src/lib/router.ts`), sections: `chat | bots | tools | knowledge | settings`
  plus `#/login`.
- Auth is local-only: `signIn(email, name)` with no password, session object in localStorage
  (`WorkspaceContext.tsx:1003`).
- Model references are display strings only (`'Gemini 2.5 Flash'`, `'Deterministic (No Model)'` in
  `web/src/data/mockData.ts`).

**Consequence:** there is no existing HTTP/SSE contract to reverse-engineer. The backend contract is
derived from the frontend's *domain types and lifecycles* (`web/src/types/agent.ts` and the context
actions), not from network calls. `web/` is not modified in this project; a thin fetch/SSE data layer
is a separate, explicit later step.

## 2. Frontend domain types the backend must satisfy

| TS type | Shape highlights | Backend table |
|---|---|---|
| `BotItem` | `id, name, nameFa, botType('agent'|'simple'), deterministicRules[{trigger,response}], description, avatarIcon, avatarBg, model, instructions, toolIds[], knowledgeIds[], temperature, topP, maxOutputTokens, status('active'|'draft'|'archived'), enabled, version, versions[BotVersion], metrics{totalRuns,avgLatencyMs,tokensConsumed,successRatePercent}, billingUsage?, lastUsed` | `bots` + immutable `bot_versions` |
| `BotVersion` | `version, updatedAt, notes, model, temperature` | `bot_versions` rows |
| `ToolItem` | `id, name, purpose, icon, connectionState('Connected'|'Disconnected'|'Needs setup'|'Error'), category('search'|'compute'|'data'|'api'|'mcp'), enabled, config?` | `tools` + `tool_versions` |
| `KnowledgeItem` | `id, name, type('pdf'|'csv'|'json'|'doc'|'text'), fileCount, sizeFormatted, status('Uploading'|'Processing'|'Indexing'|'Ready'|'Failed'), progressPercent, chunksCount, updatedAt` | `knowledge_sources` + `files` |
| `ChatConversation` | `id, title, botId, category('today'|'yesterday'|'previous7Days'|'older'), updatedAt, messages[], isPinned?, mode('agent-bot'|'simple-bot'|'bot-building'|'tool-building')` | `conversations` + `messages` |
| `ChatMessage` | `id, sender('user'|'bot'), content, timestamp, isStreaming?, botProposal?, toolProposal?, toolActivity[{name,status,detail}], knowledgeRetrieval{count,sources}, attachments[{name,sizeFormatted,type}], feedback('good'|'bad')` | `messages` (JSONB payload) + `run_events` for streaming |
| `WorkspaceAccount` | `id, name, plan, runsUsed, runsLimit, tokensUsedMillion, tokensLimitMillion` | `workspaces` (usage counters) |
| `BotProposal` / `ToolProposal` | `proposedBot/proposedTool, isConfirmed?, codeSnippet?` | agent output schemas (`BotProposal`, `ToolProposal`) |

## 3. Lifecycles observed in the UI

1. **Chat run** — `sendMessage(content, attachments)` → optimistic user message → placeholder bot
   message with `isStreaming: true` → bot reply + `toolActivity[]` + `knowledgeRetrieval` →
   `isStreaming: false`. `stopStreaming()` aborts (`WorkspaceContext.tsx:749`).
   `regenerateLastMessage()` resends the last user message. Per-message `feedback: good|bad`.
2. **Bot lifecycle** — conversation-driven creation (`confirmAndDeployBot`, `WorkspaceContext.tsx:452`)
   or direct creation (`createAndOpenSimpleBot`, `:364`) → `status/enabled` toggles →
   `agentRefineBot` produces a **new version** and prepends it to `versions[]` (`:869`) →
   studio tabs `playground | overview | billing | code`, playground sub-tabs `build | tune`.
3. **Build lifecycle** — `codeSnippet` (Python/genai sample), curl sample
   (`BotsWorkspace.tsx:384`), deterministic rules table. There is no real build in the frontend, so
   the backend build contract is derived from the required workflow (`BuildBotWorkflow`).
4. **Knowledge lifecycle** — multi-file `<input type="file">` (`KnowledgeWorkspace.tsx:122`) →
   item appears immediately with `status:'Uploading', progressPercent:20` → backend drives
   `Processing → Indexing → Ready|Failed` with progress.
5. **Cancellation** — chat stop button, plus bot/tool enable toggles (soft-cancel of future runs).
6. **Loading/error states** — `TechLoadingAnimation` (generic spinner), no error surfaces; backend
   therefore must expose typed errors with stable `code` strings.

## 4. Model configuration decision

Backend owns the model identity; `model` label is **derived** from `provider` + `model_id`:

```
provider  ∈ {openrouter, opencode, deepseek, deterministic}
model_id  ∈ provider catalogue (config, never hard-coded in graph nodes)
label     = catalogue metadata name, else humanized(model_id)   # 'space-bunny-free' -> 'Space Bunny Free'
```

`botType: 'simple'` (deterministic rules) never touches the model gateway.

## 5. REST + SSE contract (v1)

All routes under `/api/v1`. Auth: `Authorization: Bearer <jwt>`; every row is `workspace_id` scoped.

### Auth
| Method | Path | Body / Result |
|---|---|---|
| POST | `/auth/register` | `{email, name, password, workspace_name?}` → `{access_token, refresh_token, token_type, user, workspace}` |
| POST | `/auth/login` | `{email, password}` → same |
| POST | `/auth/refresh` | `{refresh_token}` → new access token |
| GET | `/auth/me` | `{user, workspace}` |

### Bots
| Method | Path | Notes |
|---|---|---|
| GET | `/bots` | list, camelCase, exactly `BotItem[]` shape |
| POST | `/bots` | create; returns bot with `version:'1.0.0'` and `versions[0]` |
| GET | `/bots/{bot_id}` | `BotItem` |
| PATCH | `/bots/{bot_id}` | mutates draft row **and appends a new immutable version** |
| DELETE | `/bots/{bot_id}` | soft delete → `status:'archived'` |
| GET | `/bots/{bot_id}/versions` | newest first |
| POST | `/bots/{bot_id}/builds` | 202 `{build_id}` → `BuildBotWorkflow` |
| GET | `/builds/{build_id}` | build state + checkpoints |
| GET | `/builds/{build_id}/stream` | SSE |

Bot write payload mirrors `BotItem`, plus `provider` + `model_id` (the `model` string in responses is
derived and ignored on input).

### Tools
`GET/POST /tools`, `GET/PATCH/DELETE /tools/{tool_id}`, `GET /tools/{tool_id}/versions`.
Tool write accepts `connectionState`, `category`, `enabled`, `config`, plus
`input_schema`, `output_schema`, `timeout_seconds`, `permissions`, `handler` (`builtin|http`).

### Knowledge
| Method | Path | Notes |
|---|---|---|
| POST | `/knowledge` | `multipart/form-data` files[] → 202 `{items: KnowledgeItem[]}` with `status:'Uploading'` |
| GET | `/knowledge` | list |
| GET | `/knowledge/{id}` | item |
| PATCH | `/knowledge/{id}` | display name |
| DELETE | `/knowledge/{id}` | remove source + blobs |

Status/progress is advanced by `IndexKnowledgeWorkflow` (Temporal), polled by the frontend or
observed over `GET /knowledge/{id}/stream`.

### Conversations & runs
| Method | Path | Notes |
|---|---|---|
| GET | `/conversations` | `ChatConversation[]` without messages (metadata only) |
| POST | `/conversations` | `{title?, bot_id, mode?}` |
| GET | `/conversations/{id}` | full `ChatConversation` including `messages[]` |
| PATCH | `/conversations/{id}` | `{title?, is_pinned?}` |
| DELETE | `/conversations/{id}` | |
| POST | `/conversations/{id}/messages` | `{content, attachments?[]}` → 202 `{run_id, user_message, assistant_message}`; assistant message starts with `isStreaming:true` |
| POST | `/messages/{message_id}/feedback` | `{feedback}` |

### Runs (durable execution)
| Method | Path | Notes |
|---|---|---|
| POST | `/runs` | `{bot_id, input, conversation_id?, message_id?, attachments?[]}` → 202 `{run_id, status:'queued'}`; starts `RunAgentWorkflow` |
| GET | `/runs/{run_id}` | run state incl. captured `provider`/`model_id`/config, timings, failure classification |
| POST | `/runs/{run_id}/cancel` | 202 → workflow cancellation; run becomes `cancelled` |
| GET | `/runs/{run_id}/events?after_seq=N` | historical `RunEvent[]` |
| GET | `/runs/{run_id}/stream` | SSE; honours `Last-Event-ID` header and `?after_seq=` |

### Events (application contract, not a framework)
```
run.started        agent.started        agent.step.started    agent.delta
agent.completed    tool.started         tool.completed        tool.failed
validation.failed  repair.attempted     message.completed     run.completed
run.failed         run.cancelled
```
Each persisted event: `{seq:int, id, run_id, type, ts, data:dict}`. Token-level `agent.delta` is
streamed live but **not** persisted; every other event is persisted (Rule 27).

### Models & settings
`GET /models` → `[{provider, model_id, label, context_window?, free:bool}]` from the configured
provider catalogues. `GET/PATCH /settings/model` → workspace default `{provider, model_id,
temperature, max_output_tokens, timeout_seconds, retry:{max_attempts, initial_interval_seconds}}`.

### Health
`GET /healthz` (liveness, no deps) and `GET /readyz` (Postgres + Temporal connectivity).

## 6. Failure states exposed by the API

Run status: `queued | running | succeeded | failed | cancelled | timed_out`.
`failed` always carries `failure_kind` (`model | validation | tool | security | internal`) plus
`retryable:bool` and `message` — never a bare `FAILED` (Rule 19/20).

## 7. Out of scope for the backend contract

- `category`/`updatedAt`/`timestamp`/`lastUsed` are human-readable strings in the frontend
  (`'Just now'`, `'2h ago'`). The backend returns ISO-8601 UTC timestamps plus a `*_display` helper
  only where the field is already a display string (`metrics`, `lastUsed`) — those stay strings.
- No MCP server implementation; `category:'mcp'` tools are registered as `http`/`builtin` handlers.
