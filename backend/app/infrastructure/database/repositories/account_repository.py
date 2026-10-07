"""Users and workspaces."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.accounts import User, Workspace
from app.infrastructure.database.tables import UserRow, WorkspaceRow


class EmailAlreadyRegistered(Exception):
    """Raised instead of leaking a raw IntegrityError to the API layer."""


def to_domain(row: UserRow) -> User:
    return User(
        user_id=row.id,
        email=row.email,
        name=row.name,
        workspace_id=row.workspace_id,
        password_hash=row.password_hash,
        is_active=row.is_active,
        created_at=row.created_at,
    )


def workspace_to_domain(row: WorkspaceRow) -> Workspace:
    return Workspace(
        workspace_id=row.id,
        name=row.name,
        plan=row.plan,
        runs_used=row.runs_used,
        runs_limit=row.runs_limit,
        tokens_used_million=row.tokens_used_million,
        tokens_limit_million=row.tokens_limit_million,
        created_at=row.created_at,
    )


class AccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_workspace(self, workspace: Workspace) -> Workspace:
        self._session.add(
            WorkspaceRow(
                id=workspace.workspace_id,
                name=workspace.name,
                plan=workspace.plan,
                runs_used=workspace.runs_used,
                runs_limit=workspace.runs_limit,
                tokens_used_million=workspace.tokens_used_million,
                tokens_limit_million=workspace.tokens_limit_million,
                created_at=workspace.created_at,
            )
        )
        await self._session.flush()
        return workspace

    async def create_user(self, user: User) -> User:
        self._session.add(
            UserRow(
                id=user.user_id,
                email=user.email.lower(),
                name=user.name,
                password_hash=user.password_hash,
                workspace_id=user.workspace_id,
                is_active=user.is_active,
                created_at=user.created_at,
            )
        )
        try:
            await self._session.flush()
        except IntegrityError as exc:
            raise EmailAlreadyRegistered(user.email) from exc
        return user

    async def get_user_by_email(self, email: str) -> User | None:
        result = await self._session.execute(select(UserRow).where(UserRow.email == email.lower()))
        row = result.scalar_one_or_none()
        return to_domain(row) if row else None

    async def get_user(self, user_id: str) -> User | None:
        row = await self._session.get(UserRow, user_id)
        return to_domain(row) if row else None

    async def get_workspace(self, workspace_id: str) -> Workspace | None:
        row = await self._session.get(WorkspaceRow, workspace_id)
        return workspace_to_domain(row) if row else None

    async def record_usage(self, workspace_id: str, *, runs: int = 0, tokens: int = 0) -> None:
        """Counters for the account panel in the frontend (`WorkspaceAccount`)."""
        row = await self._session.get(WorkspaceRow, workspace_id)
        if row is None:
            return
        row.runs_used += runs
        row.tokens_used_million += tokens / 1_000_000
