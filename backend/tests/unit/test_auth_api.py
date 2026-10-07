"""State 8 — the auth surface with the real dependency graph.

Unlike `test_api.py` these tests do *not* override `get_current_user`: the point is that the token
check, the user lookup and the workspace scoping are genuinely enforced on every protected route.
"""

from __future__ import annotations

import pytest
from app.api.app import create_app
from app.api.deps import (
    get_auth_service,
    get_bot_service,
    get_run_service,
)
from app.application.auth_service import AuthService
from app.application.bot_service import BotService
from app.application.run_service import RunService
from app.domain.accounts import User
from app.infrastructure.auth.passwords import hash_password, verify_password
from app.infrastructure.auth.tokens import TokenService
from app.infrastructure.config import Settings
from fastapi.testclient import TestClient

from tests.fakes import (
    FakeAccountRepository,
    FakeBotRepository,
    FakeRunRepository,
    FakeRunStarter,
)

SECRET = "auth-api-test-secret-long-enough-for-hmac-sha256"
PREFIX = "/api/v1"

SETTINGS = Settings(
    _env_file=None,
    environment="test",
    log_level="WARNING",
    jwt_secret=SECRET,
    database_url="postgresql+asyncpg://unused/unused",
)


@pytest.fixture
def accounts() -> FakeAccountRepository:
    return FakeAccountRepository()


@pytest.fixture
def app(accounts: FakeAccountRepository):
    app = create_app(SETTINGS)
    tokens = TokenService(SETTINGS)
    app.dependency_overrides.update(
        {
            get_auth_service: lambda: AuthService(accounts, tokens, verify_password=verify_password),
            get_bot_service: lambda: BotService(FakeBotRepository()),
            get_run_service: lambda: RunService(
                FakeRunRepository(), BotService(FakeBotRepository()), FakeRunStarter()
            ),
        }
    )
    # `get_current_user` reads the user row through AuthService, which is faked above.
    return app


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def register(client: TestClient, email: str = "owner@example.com") -> dict:
    response = client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "name": "Owner", "password": "swordfish-123"},
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestAuthRoutes:
    def test_register_returns_tokens_and_identity(self, client: TestClient) -> None:
        body = register(client)
        assert body["token_type"] == "bearer"
        assert body["access_token"] and body["refresh_token"]
        assert body["user"]["email"] == "owner@example.com"
        assert body["workspace"]["id"].startswith("ws_")

    def test_register_creates_a_workspace_with_the_configured_plan(self, client: TestClient) -> None:
        body = register(client)
        assert body["workspace"]["plan"] == SETTINGS.default_plan
        assert body["workspace"]["runsLimit"] == SETTINGS.default_runs_limit

    def test_duplicate_email_is_409(self, client: TestClient) -> None:
        register(client)
        response = client.post(
            f"{PREFIX}/auth/register",
            json={"email": "OWNER@example.com", "name": "Other", "password": "swordfish-123"},
        )
        assert response.status_code == 409
        assert response.json()["error"]["details"]["field"] == "email"

    def test_invalid_email_is_422(self, client: TestClient) -> None:
        response = client.post(
            f"{PREFIX}/auth/register",
            json={"email": "not-an-email", "name": "X", "password": "swordfish-123"},
        )
        assert response.status_code == 422

    def test_short_password_is_422(self, client: TestClient) -> None:
        response = client.post(
            f"{PREFIX}/auth/register", json={"email": "a@b.com", "name": "X", "password": "short"}
        )
        assert response.status_code == 422

    def test_login_accepts_the_registered_password(self, client: TestClient) -> None:
        register(client)
        response = client.post(
            f"{PREFIX}/auth/login", json={"email": "owner@example.com", "password": "swordfish-123"}
        )
        assert response.status_code == 200
        assert response.json()["access_token"]

    def test_wrong_password_is_401(self, client: TestClient) -> None:
        register(client)
        response = client.post(
            f"{PREFIX}/auth/login", json={"email": "owner@example.com", "password": "not-the-password"}
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_unknown_email_is_the_same_401(self, client: TestClient) -> None:
        register(client)
        unknown = client.post(
            f"{PREFIX}/auth/login", json={"email": "ghost@example.com", "password": "swordfish-123"}
        )
        wrong = client.post(
            f"{PREFIX}/auth/login", json={"email": "owner@example.com", "password": "wrong-password-1"}
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]

    def test_refresh_issues_a_usable_access_token(self, client: TestClient) -> None:
        body = register(client)
        refreshed = client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": body["refresh_token"]})
        assert refreshed.status_code == 200
        me = client.get(
            f"{PREFIX}/auth/me", headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"}
        )
        assert me.status_code == 200
        assert me.json()["user"]["email"] == "owner@example.com"

    def test_refresh_with_an_access_token_is_401(self, client: TestClient) -> None:
        body = register(client)
        response = client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": body["access_token"]})
        assert response.status_code == 401

    def test_refresh_with_garbage_is_401(self, client: TestClient) -> None:
        response = client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": "not-a-token"})
        assert response.status_code == 401

    def test_me_needs_a_token(self, client: TestClient) -> None:
        response = client.get(f"{PREFIX}/auth/me")
        assert response.status_code == 401
        assert response.headers.get("WWW-Authenticate") == "Bearer"

    def test_me_with_a_forged_token_is_401(self, client: TestClient) -> None:
        response = client.get(
            f"{PREFIX}/auth/me", headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x"}
        )
        assert response.status_code == 401

    def test_me_with_a_token_for_a_deleted_user_is_401(
        self, client: TestClient, accounts: FakeAccountRepository
    ) -> None:
        """A still-valid token must not keep acting once the account is gone."""
        body = register(client)
        accounts.users.clear()
        response = client.get(
            f"{PREFIX}/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
        )
        assert response.status_code == 401

    def test_me_mints_no_new_tokens(self, client: TestClient) -> None:
        body = register(client)
        response = client.get(
            f"{PREFIX}/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
        )
        assert "access_token" not in response.json()
        assert set(response.json()) == {"user", "workspace"}

    def test_logout_is_accepted(self, client: TestClient) -> None:
        body = register(client)
        response = client.post(
            f"{PREFIX}/auth/logout", headers={"Authorization": f"Bearer {body['access_token']}"}
        )
        assert response.status_code == 204


class TestProtectedRoutes:
    @pytest.mark.parametrize(
        "method,path",
        [
            ("get", "/bots"),
            ("post", "/bots"),
            ("get", "/tools"),
            ("get", "/knowledge"),
            ("get", "/conversations"),
            ("get", "/runs"),
            ("get", "/models"),
        ],
    )
    def test_every_route_requires_a_token(self, client: TestClient, method: str, path: str) -> None:
        response = getattr(client, method)(f"{PREFIX}{path}")
        assert response.status_code == 401, f"{method.upper()} {path} is reachable without a token"
        assert response.json()["error"]["code"] == "unauthorized"

    @pytest.mark.parametrize(
        "header",
        ["", "Bearer", "Bearer ", "Basic abc", "bearer-without-space"],
    )
    def test_malformed_authorization_headers_are_rejected(self, client: TestClient, header: str) -> None:
        response = client.get(f"{PREFIX}/bots", headers={"Authorization": header})
        assert response.status_code == 401

    def test_a_token_signed_with_another_secret_is_rejected(self, client: TestClient) -> None:
        foreign = TokenService(Settings(_env_file=None, jwt_secret="y" * 40))
        user = User(
            user_id="usr_1",
            email="x@y.com",
            name="X",
            workspace_id="ws_1",
            password_hash=hash_password("swordfish-123"),
        )
        response = client.get(
            f"{PREFIX}/bots", headers={"Authorization": f"Bearer {foreign.issue(user, 'access').token}"}
        )
        assert response.status_code == 401

    def test_health_endpoints_stay_open(self, client: TestClient) -> None:
        """Probes must answer even when the API is rejecting credentials."""
        assert client.get("/healthz").status_code == 200


class TestWorkspaceScoping:
    async def test_a_token_cannot_reach_another_workspaces_rows(self, app) -> None:
        """The token's workspace claim is the only scoping key, so a forged one must not widen access."""
        from app.domain.bots import Bot, BotVersion
        from app.domain.models import Provider

        repo = FakeBotRepository()
        app.dependency_overrides[get_bot_service] = lambda: BotService(repo)

        bot = Bot(
            bot_id="bot_secret",
            workspace_id="ws_other",
            name="Secret",
            provider=Provider.OPENCODE,
            model_id="m",
        )
        await repo.add(
            bot,
            version=BotVersion(
                bot_id=bot.bot_id,
                version_id="botver_secret",
                version="1.0.0",
                created_at=bot.created_at,
                model_spec=bot.model_snapshot(),
                instructions="",
            ),
        )

        user = User(
            user_id="usr_1",
            email="owner@example.com",
            name="Owner",
            workspace_id="ws_1",
            password_hash=hash_password("swordfish-123"),
        )
        accounts = FakeAccountRepository()
        from app.domain.accounts import Workspace

        await accounts.create_workspace(Workspace(workspace_id="ws_1", name="Acme"))
        await accounts.create_user(user)

        tokens = TokenService(SETTINGS)
        app.dependency_overrides[get_auth_service] = lambda: AuthService(
            accounts, tokens, verify_password=verify_password
        )

        with TestClient(app, raise_server_exceptions=False) as client:
            token = tokens.issue(user, "access").token
            headers = {"Authorization": f"Bearer {token}"}
            assert client.get(f"{PREFIX}/bots/bot_secret", headers=headers).status_code == 404
            assert client.get(f"{PREFIX}/bots", headers=headers).json() == []

    async def test_a_token_whose_workspace_moved_is_rejected(self, app) -> None:
        """Reassignment invalidates previously issued tokens instead of silently rescoping them."""
        from app.domain.accounts import Workspace

        accounts = FakeAccountRepository()
        await accounts.create_workspace(Workspace(workspace_id="ws_1", name="Acme"))
        user = User(
            user_id="usr_1",
            email="owner@example.com",
            name="Owner",
            workspace_id="ws_1",
            password_hash=hash_password("swordfish-123"),
        )
        await accounts.create_user(user)
        tokens = TokenService(SETTINGS)
        app.dependency_overrides[get_auth_service] = lambda: AuthService(
            accounts, tokens, verify_password=verify_password
        )
        # The membership moves after the token was issued.
        accounts.users["usr_1"] = user.model_copy(update={"workspace_id": "ws_2"})

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                f"{PREFIX}/bots",
                headers={"Authorization": f"Bearer {tokens.issue(user, 'access').token}"},
            )
            assert response.status_code == 401
