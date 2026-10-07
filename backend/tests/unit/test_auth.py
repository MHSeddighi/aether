"""State 8 — authentication.

These tests pin the two properties the whole workspace-scoping scheme rests on: a token cannot be
forged or repurposed, and a rejected credential reveals nothing about which part was wrong.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from app.domain.accounts import User, Workspace
from app.infrastructure.auth.passwords import hash_password, verify_password
from app.infrastructure.auth.tokens import CLAIM_EXPIRES, TokenError, TokenService
from app.infrastructure.config import Settings

#: RFC 7518 asks for at least 32 bytes of HMAC key; short secrets also make pyjwt warn.
SECRET = "unit-test-secret-that-is-long-enough-for-hmac-sha256"


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, jwt_secret=SECRET, access_token_ttl_seconds=900)


@pytest.fixture
def tokens(settings: Settings) -> TokenService:
    return TokenService(settings)


@pytest.fixture
def user() -> User:
    return User(
        user_id="usr_1",
        email="owner@example.com",
        name="Owner",
        workspace_id="ws_1",
        password_hash=hash_password("correct horse battery"),
    )


class TestPasswords:
    def test_hash_is_verifiable_and_salted(self) -> None:
        first = hash_password("swordfish-123")
        second = hash_password("swordfish-123")
        assert first != second, "identical passwords must not produce identical hashes"
        assert verify_password("swordfish-123", first)
        assert not verify_password("wrong", first)

    def test_malformed_hash_is_a_failed_verification_not_a_crash(self) -> None:
        assert verify_password("anything", "not-a-real-argon2-hash") is False

    def test_empty_password_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="must not be empty"):
            hash_password("")


class TestTokenService:
    def test_pair_carries_both_types_and_lifetimes(self, tokens: TokenService, user: User) -> None:
        pair = tokens.issue_pair(user)
        assert pair.access.token_type == "access"
        assert pair.refresh.token_type == "refresh"
        assert pair.access.expires_at < pair.refresh.expires_at
        payload = pair.to_dict()
        assert payload["token_type"] == "bearer"
        assert 0 < payload["expires_in"] <= settings_ttl(tokens, "access")

    def test_claims_carry_user_and_workspace(self, tokens: TokenService, user: User) -> None:
        claims = tokens.verify(tokens.issue(user, "access").token, expected="access")
        assert claims.user_id == user.user_id
        assert claims.workspace_id == user.workspace_id

    def test_a_refresh_token_cannot_be_used_as_an_access_token(
        self, tokens: TokenService, user: User
    ) -> None:
        """Without this check a stolen refresh token is as good as an access token for its whole
        30-day lifetime."""
        refresh = tokens.issue(user, "refresh").token
        with pytest.raises(TokenError, match="expected a access token"):
            tokens.verify(refresh, expected="access")

    def test_expired_token_is_rejected(self, user: User) -> None:
        service = TokenService(Settings(_env_file=None, jwt_secret=SECRET))
        token = jwt.encode(
            {
                "sub": user.user_id,
                "workspace_id": user.workspace_id,
                "type": "access",
                "exp": int((datetime.now(UTC) - timedelta(minutes=1)).timestamp()),
                "iss": "bot-builder",
            },
            SECRET,
            algorithm="HS256",
        )
        with pytest.raises(TokenError, match="expired"):
            service.verify(token, expected="access")

    def test_token_signed_with_another_secret_is_rejected(self, tokens: TokenService, user: User) -> None:
        foreign = TokenService(Settings(_env_file=None, jwt_secret="x" * 40))
        with pytest.raises(TokenError, match="invalid token"):
            tokens.verify(foreign.issue(user, "access").token, expected="access")

    def test_none_algorithm_token_is_rejected(self, tokens: TokenService, user: User) -> None:
        """The classic JWT bypass: `alg: none` must never verify."""
        unsigned = jwt.encode(
            {
                "sub": user.user_id,
                "workspace_id": user.workspace_id,
                "type": "access",
                "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
                "iss": "bot-builder",
            },
            key="",
            algorithm="none",
        )
        with pytest.raises(TokenError, match="invalid token"):
            tokens.verify(unsigned, expected="access")

    def test_token_without_workspace_is_rejected(self, tokens: TokenService) -> None:
        """The workspace claim is what scopes every query; a token without it is unusable."""
        token = jwt.encode(
            {
                "sub": "usr_1",
                "type": "access",
                "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
                "iss": "bot-builder",
            },
            SECRET,
            algorithm="HS256",
        )
        with pytest.raises(TokenError, match="no workspace"):
            tokens.verify(token, expected="access")

    def test_expired_claim_must_be_present(self, tokens: TokenService) -> None:
        token = jwt.encode(
            {"sub": "usr_1", "workspace_id": "ws_1", "type": "access", "iss": "bot-builder"},
            SECRET,
            algorithm="HS256",
        )
        with pytest.raises(TokenError, match="invalid token"):
            tokens.verify(token, expected="access")

    def test_garbage_is_rejected_not_decoded(self, tokens: TokenService) -> None:
        with pytest.raises(TokenError):
            tokens.verify("not.a.jwt", expected="access")
        with pytest.raises(TokenError, match="missing token"):
            tokens.verify("", expected="access")

    def test_workspace_in_another_secret_cannot_be_forged_by_tampering(self, tokens, user) -> None:
        token = tokens.issue(user, "access").token
        header, payload, signature = token.split(".")
        tampered = f"{header}.{payload[:-2]}XY.{signature}"
        with pytest.raises(TokenError, match="invalid token"):
            tokens.verify(tampered, expected="access")


class TestSettings:
    def test_unsupported_algorithm_is_refused_at_construction(self) -> None:
        with pytest.raises(ValueError, match="unsupported jwt algorithm"):
            TokenService(Settings(_env_file=None, jwt_algorithm="HS512"))

    def test_workspace_defaults_are_configurable(self) -> None:
        settings = Settings(
            _env_file=None, default_plan="Starter", default_runs_limit=10, default_tokens_limit_million=1.5
        )
        assert settings.default_plan == "Starter"


def settings_ttl(tokens: TokenService, token_type: str) -> int:
    lifetime = tokens.issue(
        User(
            user_id="u",
            email="u@e.com",
            name="U",
            workspace_id="w",
            password_hash="x",
        ),
        token_type,  # type: ignore[arg-type]
    )
    delta = lifetime.expires_at - datetime.now(UTC)
    return int(delta.total_seconds()) + 2


def test_workspace_shape_matches_frontend() -> None:
    workspace = Workspace(workspace_id="ws_1", name="Acme", plan="Team Pro")
    assert workspace.to_dict() == {
        "id": "ws_1",
        "name": "Acme",
        "plan": "Team Pro",
        "runsUsed": 0,
        "runsLimit": 5000,
        "tokensUsedMillion": 0.0,
        "tokensLimitMillion": 50.0,
    }


def test_claim_names_are_stable() -> None:
    """Renaming a claim would silently invalidate every issued token."""
    assert CLAIM_EXPIRES == "exp"
