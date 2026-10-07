"""Auth routes: register, login, refresh, me.

Every response is `{access_token, refresh_token, token_type, expires_in, user, workspace}` — the
identity travels with the tokens so the frontend can render the account panel without a second call.
"""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import AuthServiceDep, CurrentUser
from app.api.errors import ConflictError, UnauthorizedError
from app.api.schemas import LoginRequest, RefreshRequest, RegisterRequest
from app.application.auth_service import CredentialsRejected, EmailConflict

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, auth: AuthServiceDep) -> dict:
    """Create the workspace, the user and the first token pair in one transaction."""
    try:
        response = await auth.register(
            email=payload.email,
            name=payload.name,
            password=payload.password,
            workspace_name=payload.workspace_name,
        )
    except EmailConflict as exc:
        raise ConflictError(str(exc), details={"field": "email"}) from exc
    return response.to_dict()


@router.post("/login")
async def login(payload: LoginRequest, auth: AuthServiceDep) -> dict:
    try:
        response = await auth.login(email=payload.email, password=payload.password)
    except CredentialsRejected as exc:
        raise UnauthorizedError(str(exc)) from exc
    return response.to_dict()


@router.post("/refresh")
async def refresh(payload: RefreshRequest, auth: AuthServiceDep) -> dict:
    try:
        response = await auth.refresh(payload.refresh_token)
    except CredentialsRejected as exc:
        raise UnauthorizedError(str(exc)) from exc
    return response.to_dict()


@router.get("/me")
async def me(user: CurrentUser, auth: AuthServiceDep) -> dict:
    """The identity behind the presented access token, without minting new tokens."""
    response = await auth.session(user.user_id)
    return response.to_identity_dict()


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout() -> None:
    """Stateless JWTs cannot be revoked server-side; the client discards its tokens.

    Present so the frontend has one obvious call to make when it wants to end a session.
    """
    return
