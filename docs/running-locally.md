# Running the stack locally (Postgres + Temporal + API + workers)

## TL;DR

```bash
cd backend
scripts/pull-images.sh     # only needed when Docker Hub is unreachable (IPv6 problem, see below)
docker compose up -d
docker compose ps
curl -s localhost:8000/readyz      # {"status":"ok","checks":{"postgres":true,"temporal":true}}
```

Ports are overridable because 5432/5433 are already taken on some machines:

```bash
POSTGRES_HOST_PORT=55432 TEMPORAL_HOST_PORT=17233 docker compose up -d
```

The defaults are `55432` (Postgres) and `7233` (Temporal), overridable through `.env`.

## What runs where

| service | image | purpose |
|---|---|---|
| `postgres` | `postgres:16-alpine` | application + Temporal state (two databases: `botbuilder`, Temporal's own) |
| `temporal` | `temporalio/auto-setup:1.27.2` | durable execution; auto-setup creates its `temporal`/`temporal_visibility` DBs and schemas |
| `api` | built from `backend/Dockerfile` | runs `alembic upgrade head`, then uvicorn with `--reload` |
| `worker-agent` | same image | polls `bot-builder` task queue, runs `RunAgentWorkflow` |
| `worker-build` | same image | polls `bot-builder-build` (activities arrive in State 10) |

No Redis, no RabbitMQ, no Celery, no Kubernetes: Temporal is the only queue (Rule 2).

## Why the image-pull script exists

Symptom on this machine:

```
Error response from daemon: pull access denied for postgres, repository does not exist
or may require 'docker login': denied: RBAC: access denied
```

That message is Docker's wording for an **HTTP 403** from the registry. Measured here:

| request | result |
|---|---|
| `curl -4 https://registry-1.docker.io/v2/` | `401` (normal auth challenge — reachable) |
| `curl -6 https://registry-1.docker.io/v2/` | `403` (blocked) |
| `curl -4/-6 https://auth.docker.io/v2/` | `404` / `403` |
| `curl -6 https://mirror.gcr.io/v2/`, `https://registry.k8s.io/v2/` | `403` as well |

The host *has* global IPv6 addresses, and the network blocks IPv6 at the application layer, so the
daemon's IPv6-preferred connection is answered with 403 — and because the TCP+TLS handshake
succeeded, Go's Happy Eyeballs fallback never kicks in.

`"ipv6": false` in `/etc/docker/daemon.json` does **not** fix this: it only disables IPv6 inside
containers. Registry address selection happens in the daemon process.

`scripts/pull-images.sh` therefore pulls from registries that publish only A records and retags to
the canonical names:

* `public.ecr.aws/docker/library/postgres:16-alpine` → `postgres:16-alpine`
* `dockerproxy.net/temporalio/auto-setup:1.27.2` → `temporalio/auto-setup:1.27.2`
* `public.ecr.aws/docker/library/python:3.12-slim` → `python:3.12-slim`

## Permanent fixes (require root)

```bash
# 1. IPv4-only mirror for the daemon (simplest, no host networking change)
sudo sh -c 'echo "{\"registry-mirrors\": [\"https://mirror.gcr.io\"]}" > /etc/docker/daemon.json'
sudo systemctl restart docker

# 2. Or remove IPv6 from the host entirely
sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.default.disable_ipv6=1
sudo systemctl restart docker
```

Either one makes plain `docker compose up` work without the mirror script.

## Tests

```bash
cd backend

# unit only (no infrastructure)
uv run pytest -q

# workflow tests against Temporal's time-skipping test environment
TEMPORAL_TEST_SERVER=1 uv run pytest tests/integration/test_workflow.py

# database tests against the compose Postgres
export TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:55432/botbuilder_test
docker compose exec -T postgres createdb -U postgres botbuilder_test
uv run pytest tests/integration/test_database.py

# live provider calls (free model, no key required for OpenCode Zen)
LIVE_PROVIDER=opencode LIVE_MODEL=space-bunny-free uv run pytest tests/integration/test_model_gateway_live.py

# everything
LIVE_PROVIDER=opencode LIVE_MODEL=space-bunny-free TEMPORAL_TEST_SERVER=1 \
  uv run pytest -q      # 276 passed
```

## Notes

* `tests/integration/test_database.py` applies the real Alembic migrations once per session and
  truncates between tests, so it exercises the migration and the immutability triggers.
* The `botbuilder` database is for the running stack; integration tests use `botbuilder_test` so they
  never touch it.
* If Docker Hub is reachable, delete the mirror retags: `docker compose pull` works normally.
