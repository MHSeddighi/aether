#!/usr/bin/env bash
# One-shot local setup: infrastructure, migrations, tests.
#
#   ./scripts/init.sh up        # start Postgres + Temporal + api + workers
#   ./scripts/init.sh migrate   # apply Alembic migrations
#   ./scripts/init.sh test      # unit tests, then integration tests if Postgres is reachable
#   ./scripts/init.sh down      # stop everything (keeps volumes)
#   ./scripts/init.sh reset     # stop and delete volumes
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
cd "$BACKEND_DIR"

[ -f .env ] || cp .env.example .env

TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql+asyncpg://postgres:postgres@localhost:55432/botbuilder_test}"

case "${1:-up}" in
  up)
    "$SCRIPT_DIR/pull-images.sh"   # no-op when the images are already present
    docker compose up -d --build
    echo "api        -> http://localhost:8000/docs"
    echo "postgres   -> localhost:${POSTGRES_HOST_PORT:-55432}"
    echo "temporal   -> localhost:${TEMPORAL_HOST_PORT:-7233}"
    echo
    echo "Now run: $0 migrate"
    ;;
  migrate)
    docker compose up -d postgres temporal
    echo "waiting for postgres..."
    until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
    uv run alembic upgrade head
    # The test database is separate so integration tests never touch dev data.
    docker compose exec -T postgres createdb -U postgres botbuilder_test 2>/dev/null || true
    ;;
  test)
    uv run ruff check .
    uv run ruff format --check .
    uv run pytest -m "not integration"
    if [ -n "${RUN_INTEGRATION:-}" ]; then
      TEST_DATABASE_URL="$TEST_DATABASE_URL" uv run pytest -m integration
    else
      echo "skipping integration tests (set RUN_INTEGRATION=1 after '$0 migrate')"
    fi
    ;;
  down)
    docker compose down
    ;;
  reset)
    docker compose down -v
    ;;
  *)
    echo "usage: $0 {up|migrate|test|down|reset}" >&2
    exit 2
    ;;
esac
