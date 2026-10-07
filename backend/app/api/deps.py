"""Per-request dependencies.

Two rules keep the routes honest:

* **One session per request.** `get_session` yields inside `Database.session()`, so a use case's
  writes commit together and a failure rolls the whole request back.
* **Services are constructed here, injected everywhere.** A route never builds a repository, never
  connects to Temporal and never sees settings; it receives a use case. That is what lets the API
  tests swap in fakes, and it is why `deps.py` is the only place that knows about wiring.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AuthenticationRequired
from app.application.auth_service import AuthService
from app.application.bot_service import BotService
from app.application.conversation_service import ConversationService
from app.application.knowledge_service import KnowledgeService, LocalBlobStore
from app.application.model_service import ModelService
from app.application.run_service import RunService
from app.application.tool_service import ToolService
from app.domain.accounts import User
from app.infrastructure.auth.passwords import verify_password
from app.infrastructure.auth.tokens import TokenClaims, TokenError, TokenService
from app.infrastructure.config import Settings
from app.infrastructure.database.repositories.account_repository import AccountRepository
from app.infrastructure.database.repositories.bot_repository import BotRepository
from app.infrastructure.database.repositories.conversation_repository import ConversationRepository
from app.infrastructure.database.repositories.knowledge_repository import KnowledgeRepository
from app.infrastructure.database.repositories.run_repository import RunRepository
from app.infrastructure.database.repositories.tool_repository import ToolRepository
from app.infrastructure.models.gateway import build_catalog_for, default_model_config

# --- infrastructure -----------------------------------------------------


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Transactional scope for the whole request; commits on success, rolls back on error."""
    database = request.app.state.database
    async with database.session() as session:
        yield session


def get_token_service(settings: Annotated[Settings, Depends(get_settings)]) -> TokenService:
    return TokenService(settings)


# --- authentication -----------------------------------------------------


def get_auth_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthService:
    return AuthService(
        AccountRepository(session),
        tokens,
        verify_password=verify_password,
        default_plan=settings.default_plan,
        default_runs_limit=settings.default_runs_limit,
        default_tokens_limit_million=settings.default_tokens_limit_million,
    )


def _bearer(authorization: str | None) -> str:
    if not authorization:
        raise AuthenticationRequired("missing Authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthenticationRequired("expected an 'Authorization: Bearer <token>' header")
    return token.strip()


def get_token_service_claims(
    tokens: Annotated[TokenService, Depends(get_token_service)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> TokenClaims:
    """Verify the presented bearer token.

    Every way a token can fail — missing header, wrong scheme, forged, expired, wrong type — leaves
    here as the same exception, so the client learns only that its credential is not acceptable.
    """
    try:
        return tokens.verify(_bearer(authorization), expected="access")
    except TokenError as exc:
        raise AuthenticationRequired(str(exc)) from exc


async def get_current_user(
    auth: Annotated[AuthService, Depends(get_auth_service)],
    claims: Annotated[TokenClaims, Depends(get_token_service_claims)],
) -> User:
    """The authenticated user.

    The token carries the workspace, but the user row is re-read so a deactivated, deleted or moved
    account cannot keep acting on a still-valid token. Anything that prevents resolving an identity
    for the presented token is an authentication failure, not a server fault: the caller is not
    authorised, whatever the reason.
    """
    from app.application.auth_service import CredentialsRejected
    from app.domain.failures import ValidationFailure

    try:
        response = await auth.session(claims.user_id)
    except (CredentialsRejected, ValidationFailure) as exc:
        raise AuthenticationRequired("the session is no longer valid") from exc
    if response.user.workspace_id != claims.workspace_id:
        # Workspace reassignment invalidates previously issued tokens.
        raise AuthenticationRequired("the session is no longer valid")
    return response.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def current_workspace(user: CurrentUser) -> str:
    """Every row in the system is workspace scoped, so this is the scoping key for all routes."""
    return user.workspace_id


WorkspaceId = Annotated[str, Depends(current_workspace)]


# --- repositories -------------------------------------------------------


def get_account_repository(session: Annotated[AsyncSession, Depends(get_session)]) -> AccountRepository:
    return AccountRepository(session)


def get_bot_repository(session: Annotated[AsyncSession, Depends(get_session)]) -> BotRepository:
    return BotRepository(session)


def get_run_repository(session: Annotated[AsyncSession, Depends(get_session)]) -> RunRepository:
    return RunRepository(session)


def get_conversation_repository(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ConversationRepository:
    return ConversationRepository(session)


def get_tool_repository(session: Annotated[AsyncSession, Depends(get_session)]) -> ToolRepository:
    return ToolRepository(session)


def get_knowledge_repository(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KnowledgeRepository:
    return KnowledgeRepository(session)


def get_knowledge_service(
    knowledge: Annotated[KnowledgeRepository, Depends(get_knowledge_repository)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> KnowledgeService:
    """The blob store is process-local and rooted at the configured data volume."""
    return KnowledgeService(knowledge, LocalBlobStore(Path(settings.data_dir)))


# --- use cases ----------------------------------------------------------


def get_bot_service(bots: Annotated[BotRepository, Depends(get_bot_repository)]) -> BotService:
    return BotService(bots)


def get_tool_service(tools: Annotated[ToolRepository, Depends(get_tool_repository)]) -> ToolService:
    return ToolService(tools)


def get_conversation_service(
    conversations: Annotated[ConversationRepository, Depends(get_conversation_repository)],
) -> ConversationService:
    return ConversationService(conversations)


async def get_run_service(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    runs: Annotated[RunRepository, Depends(get_run_repository)],
    bots: Annotated[BotRepository, Depends(get_bot_repository)],
    conversations: Annotated[ConversationRepository, Depends(get_conversation_repository)],
) -> RunService:
    """Build the run use case with the process's Temporal-backed `RunStarter`.

    The client is fetched from the lazily-connected holder rather than reconnected, so starting a run
    costs one RPC, not one handshake. `app.state.run_starter` lets a test inject a fake (Rule 38).
    """
    from app.infrastructure.temporal.starter import TemporalRunStarter

    starter = getattr(request.app.state, "run_starter", None)
    if starter is None:
        starter = TemporalRunStarter(
            await request.app.state.temporal.get(), task_queue=settings.temporal_task_queue
        )
    return RunService(
        runs,
        BotService(bots),
        starter,
        conversations,
        default_timeout_seconds=settings.agent_run_timeout_seconds,
    )


def get_model_service(settings: Annotated[Settings, Depends(get_settings)]) -> ModelService:
    return ModelService(
        build_catalog_for,
        default_model_config(settings),
        provider_names=tuple(settings.providers),
    )


BotServiceDep = Annotated[BotService, Depends(get_bot_service)]
ToolServiceDep = Annotated[ToolService, Depends(get_tool_service)]
ConversationServiceDep = Annotated[ConversationService, Depends(get_conversation_service)]
KnowledgeServiceDep = Annotated[KnowledgeService, Depends(get_knowledge_service)]
RunServiceDep = Annotated[RunService, Depends(get_run_service)]
ModelServiceDep = Annotated[ModelService, Depends(get_model_service)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
