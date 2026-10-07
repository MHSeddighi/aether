"""Accounts: users and workspaces (Rule 42 decision — full JWT auth with workspace scoping)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field


class Workspace(BaseModel):
    workspace_id: str
    name: str = Field(min_length=1, max_length=200)
    plan: str = "Team Pro"
    runs_used: int = 0
    runs_limit: int = 5000
    tokens_used_million: float = 0.0
    tokens_limit_million: float = 50.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Shape of `web/src/types/agent.ts#WorkspaceAccount`."""
        return {
            "id": self.workspace_id,
            "name": self.name,
            "plan": self.plan,
            "runsUsed": self.runs_used,
            "runsLimit": self.runs_limit,
            "tokensUsedMillion": round(self.tokens_used_million, 3),
            "tokensLimitMillion": self.tokens_limit_million,
        }


class User(BaseModel):
    user_id: str
    email: str
    name: str
    workspace_id: str
    password_hash: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.user_id, "email": self.email, "name": self.name}
