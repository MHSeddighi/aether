"""Registration, login, refresh and session lookup.

Password hashing and token minting are injected as callables, so this use case has no idea whether
tokens are JWTs, opaque handles or something else (Dependency Inversion).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.application.ports import AccountRepositoryPort
from app.domain.accounts import User, Workspace
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.ids import new_id
from app.infrastructure.auth.passwords import hash_password
from app.infrastructure.auth.tokens import TokenError, TokenService

MIN_PASSWORD_LENGTH = 8


@dataclass(frozen=True, slots=True)
class TokenPairResponse:
    """What `/auth/*` returns: tokens plus the identity they belong to."""

    tokens: dict[str, Any]
    user: User
    workspace: Workspace

    def to_dict(self) -> dict[str, Any]:
        """Login/register shape: tokens plus identity."""
        return {**self.tokens, "user": self.user.to_dict(), "workspace": self.workspace.to_dict()}

    def to_identity_dict(self) -> dict[str, Any]:
        """`/auth/me` shape: identity only. No tokens are minted for an already-authenticated call."""
        return {"user": self.user.to_dict(), "workspace": self.workspace.to_dict()}


class CredentialsRejected(Exception):
    """Wrong email or wrong password. Deliberately one exception for both, so the API cannot leak
    which of the two was wrong (and so timing does not differ either)."""


class AuthService:
    def __init__(
        self,
        accounts: AccountRepositoryPort,
        tokens: TokenService,
        *,
        verify_password: Callable[[str, str], bool],
        hash_password: Callable[[str], str] = hash_password,
        default_workspace_name: str = "My Workspace",
        default_plan: str = "Team Pro",
        default_runs_limit: int = 5000,
        default_tokens_limit_million: float = 50.0,
    ) -> None:
        self._accounts = accounts
        self._tokens = tokens
        self._verify = verify_password
        self._hash = hash_password
        self._default_workspace_name = default_workspace_name
        self._default_plan = default_plan
        self._default_runs_limit = default_runs_limit
        self._default_tokens_limit_million = default_tokens_limit_million

    # --- use cases --------------------------------------------------------

    async def register(
        self, *, email: str, name: str, password: str, workspace_name: str | None = None
    ) -> TokenPairResponse:
        email = _normalise_email(email)
        _require_password_strength(password)
        if not name.strip():
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT, "name must not be blank", details={"field": "name"}
            )

        existing = await self._accounts.get_user_by_email(email)
        if existing is not None:
            # Reported as a conflict, not silently accepted: the caller needs to log in instead.
            raise EmailConflict(email)

        workspace = await self._accounts.create_workspace(
            Workspace(
                workspace_id=new_id("ws"),
                name=(workspace_name or self._default_workspace_name).strip() or self._default_workspace_name,
                plan=self._default_plan,
                runs_limit=self._default_runs_limit,
                tokens_limit_million=self._default_tokens_limit_million,
            )
        )
        user = await self._accounts.create_user(
            User(
                user_id=new_id("usr"),
                email=email,
                name=name.strip(),
                workspace_id=workspace.workspace_id,
                password_hash=self._hash(password),
            )
        )
        return await self._session_response(user)

    async def login(self, *, email: str, password: str) -> TokenPairResponse:
        user = await self._accounts.get_user_by_email(_normalise_email(email))
        if user is None or not self._verify(password, user.password_hash):
            raise CredentialsRejected("invalid email or password")
        if not user.is_active:
            raise CredentialsRejected("this account is disabled")
        return await self._session_response(user)

    async def refresh(self, refresh_token: str) -> TokenPairResponse:
        try:
            claims = self._tokens.verify(refresh_token, expected="refresh")
        except TokenError as exc:
            raise CredentialsRejected(str(exc)) from exc
        user = await self._accounts.get_user(claims.user_id)
        # The workspace claim is re-read from the row: a token must not outlive a user's membership.
        if user is None or user.workspace_id != claims.workspace_id or not user.is_active:
            raise CredentialsRejected("the session is no longer valid")
        return await self._session_response(user)

    async def session(self, user_id: str) -> TokenPairResponse:
        """Used by `/auth/me`: returns the identity behind an access token."""
        user = await self._accounts.get_user(user_id)
        if user is None:
            raise CredentialsRejected("unknown user")
        return await self._session_response(user, with_tokens=False)

    # --- helpers ----------------------------------------------------------

    async def _session_response(self, user: User, *, with_tokens: bool = True) -> TokenPairResponse:
        workspace = await self._accounts.get_workspace(user.workspace_id)
        if workspace is None:
            # A user without a workspace cannot be authorised, so this is a data-integrity fault.
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"workspace {user.workspace_id!r} is missing for user {user.user_id!r}",
                details={"user_id": user.user_id},
            )
        tokens = self._tokens.issue_pair(user).to_dict() if with_tokens else {}
        return TokenPairResponse(tokens=tokens, user=user, workspace=workspace)


class EmailConflict(Exception):
    """Registration email already exists. The API maps this to 409."""

    def __init__(self, email: str) -> None:
        super().__init__(f"email {email!r} is already registered")
        self.email = email


def _normalise_email(email: str) -> str:
    value = (email or "").strip().lower()
    if "@" not in value or value.startswith("@") or value.endswith("@"):
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "a valid email address is required",
            details={"field": "email"},
        )
    return value


def _require_password_strength(password: str) -> None:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"password must be at least {MIN_PASSWORD_LENGTH} characters",
            details={"field": "password", "min_length": MIN_PASSWORD_LENGTH},
        )
