"""Access/refresh token minting and verification.

One place owns the token format, so nothing else needs to know claim names or lifetimes. The
`workspace_id` claim is what makes every query in the API workspace-scoped without a second lookup
(Rule 42 decision: full JWT auth with workspace scoping).

`pyjwt` does the signing, the algorithm allow-list and the expiry check; there is nothing here worth
reimplementing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt

from app.domain.accounts import User
from app.infrastructure.config import Settings
from app.infrastructure.logging_config import get_logger

logger = get_logger(__name__)

TokenType = Literal["access", "refresh"]

#: Only these algorithms are ever accepted, whatever the token says about itself.
ALLOWED_ALGORITHMS = ("HS256",)

CLAIM_SUBJECT = "sub"
CLAIM_WORKSPACE = "workspace_id"
CLAIM_TYPE = "type"
CLAIM_ISSUED_AT = "iat"
CLAIM_EXPIRES = "exp"
CLAIM_JWT_ID = "jti"

ISSUER = "bot-builder"


class TokenError(Exception):
    """Any reason a presented token is unusable. One class: the API maps it to a single 401."""


@dataclass(frozen=True, slots=True)
class IssuedToken:
    token: str
    expires_at: datetime
    token_type: TokenType


@dataclass(frozen=True, slots=True)
class TokenPair:
    access: IssuedToken
    refresh: IssuedToken

    def to_dict(self) -> dict[str, Any]:
        return {
            "access_token": self.access.token,
            "refresh_token": self.refresh.token,
            "token_type": "bearer",
            "expires_in": max(int((self.access.expires_at - datetime.now(UTC)).total_seconds()), 0),
            "refresh_expires_in": max(int((self.refresh.expires_at - datetime.now(UTC)).total_seconds()), 0),
        }


@dataclass(frozen=True, slots=True)
class TokenClaims:
    """What the API actually needs from a verified token."""

    user_id: str
    workspace_id: str
    token_type: TokenType


class TokenService:
    """Mints and verifies tokens. Stateless: verification needs no database round trip."""

    def __init__(self, settings: Settings) -> None:
        self._secret = settings.jwt_secret.get_secret_value()
        self._algorithm = settings.jwt_algorithm
        if self._algorithm not in ALLOWED_ALGORITHMS:
            raise ValueError(f"unsupported jwt algorithm {self._algorithm!r}")
        self._access_ttl = settings.access_token_ttl_seconds
        self._refresh_ttl = settings.refresh_token_ttl_seconds

    def issue_pair(self, user: User) -> TokenPair:
        """Both tokens at once, so a client can refresh without a second round trip."""
        return TokenPair(
            access=self.issue(user, "access"),
            refresh=self.issue(user, "refresh"),
        )

    def issue(self, user: User, token_type: TokenType) -> IssuedToken:
        from app.domain.ids import new_id

        ttl = self._access_ttl if token_type == "access" else self._refresh_ttl
        issued_at = datetime.now(UTC)
        expires_at = issued_at + timedelta(seconds=ttl)
        payload = {
            CLAIM_SUBJECT: user.user_id,
            CLAIM_WORKSPACE: user.workspace_id,
            CLAIM_TYPE: token_type,
            CLAIM_ISSUED_AT: int(issued_at.timestamp()),
            CLAIM_EXPIRES: int(expires_at.timestamp()),
            CLAIM_JWT_ID: new_id("jti"),
            "iss": ISSUER,
        }
        token = jwt.encode(payload, self._secret, algorithm=self._algorithm)
        return IssuedToken(token=token, expires_at=expires_at, token_type=token_type)

    def verify(self, token: str, *, expected: TokenType | None = None) -> TokenClaims:
        """Decode and validate. Raises `TokenError` for every failure mode.

        `expected` prevents a refresh token from being replayed as an access token, which would
        otherwise double the token's effective lifetime.
        """
        if not token:
            raise TokenError("missing token")
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=list(ALLOWED_ALGORITHMS),
                issuer=ISSUER,
                options={"require": [CLAIM_SUBJECT, CLAIM_EXPIRES, CLAIM_TYPE]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenError("token has expired") from exc
        except jwt.InvalidTokenError as exc:
            raise TokenError(f"invalid token: {exc}") from exc

        token_type = payload.get(CLAIM_TYPE)
        if token_type not in ("access", "refresh"):
            raise TokenError(f"unsupported token type {token_type!r}")
        if expected is not None and token_type != expected:
            raise TokenError(f"expected a {expected} token, got {token_type}")

        subject = payload.get(CLAIM_SUBJECT)
        workspace_id = payload.get(CLAIM_WORKSPACE)
        if not isinstance(subject, str) or not subject:
            raise TokenError("token has no subject")
        if not isinstance(workspace_id, str) or not workspace_id:
            # Without this claim the API could not scope queries, so the token is useless.
            raise TokenError("token has no workspace")
        return TokenClaims(user_id=subject, workspace_id=workspace_id, token_type=token_type)
