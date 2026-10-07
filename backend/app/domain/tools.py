"""Tool aggregate: catalog entry (mutable) plus immutable versions carrying the schemas the
Tool Gateway enforces (Rule 30)."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.failures import FailureReason, ValidationFailure

BUILTIN = "builtin"
HTTP = "http"
DOCKER = "docker"
KNOWN_HANDLERS = frozenset({BUILTIN, HTTP, DOCKER})


class ConnectionState(StrEnum):
    CONNECTED = "Connected"
    DISCONNECTED = "Disconnected"
    NEEDS_SETUP = "Needs setup"
    ERROR = "Error"


class ToolCategory(StrEnum):
    SEARCH = "search"
    COMPUTE = "compute"
    DATA = "data"
    API = "api"
    MCP = "mcp"


class ToolPermission(StrEnum):
    """Minimum permission vocabulary. The gateway denies anything not granted (Rule 30)."""

    NONE = "none"
    NETWORK = "network"
    FILESYSTEM_READ = "filesystem_read"
    FILESYSTEM_WRITE = "filesystem_write"
    SANDBOX_EXECUTION = "sandbox_execution"
    DATABASE_READ = "database_read"


class ToolVersion(BaseModel):
    model_config = ConfigDict(frozen=True)

    tool_id: str
    version_id: str
    version: int
    created_at: datetime
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    handler: str = BUILTIN
    handler_config: dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: float = Field(default=20.0, gt=0, le=300)
    permissions: tuple[ToolPermission, ...] = ()

    @field_validator("handler")
    @classmethod
    def _known_handler(cls, value: str) -> str:
        if value not in KNOWN_HANDLERS:
            raise ValueError(f"handler must be one of {sorted(KNOWN_HANDLERS)}")
        return value

    @model_validator(mode="after")
    def _http_handler_has_endpoint(self) -> ToolVersion:
        if self.handler == HTTP and not self.handler_config.get("url"):
            raise ValueError("http tools require handler_config.url")
        return self

    @model_validator(mode="after")
    def _network_permission_for_http(self) -> ToolVersion:
        if self.handler == HTTP and ToolPermission.NETWORK not in self.permissions:
            raise ValueError("http tools must declare the network permission")
        return self


class Tool(BaseModel):
    tool_id: str
    workspace_id: str
    name: str = Field(min_length=1, max_length=200)
    name_fa: str | None = None
    purpose: str = ""
    purpose_fa: str | None = None
    icon: str = "Link"
    connection_state: ConnectionState = ConnectionState.CONNECTED
    category: ToolCategory = ToolCategory.API
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)
    version: int = 1
    versions: list[ToolVersion] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def active_version(self) -> ToolVersion | None:
        return self.versions[0] if self.versions else None

    def next_version_number(self) -> int:
        return max([self.version, *(v.version for v in self.versions)], default=0) + 1


def tool_to_dict(tool: Tool) -> dict[str, Any]:
    """Serialise to `web/src/types/agent.ts#ToolItem`."""
    active = tool.active_version()
    return {
        "id": tool.tool_id,
        "name": tool.name,
        "nameFa": tool.name_fa or tool.name,
        "purpose": tool.purpose,
        "purposeFa": tool.purpose_fa or tool.purpose,
        "icon": tool.icon,
        "connectionState": str(tool.connection_state),
        "category": str(tool.category),
        "enabled": tool.enabled,
        "config": tool.config,
        "version": tool.version,
        "timeoutSeconds": active.timeout_seconds if active else None,
        "permissions": [str(p) for p in active.permissions] if active else [],
    }


def require_known_permissions(
    requested: tuple[ToolPermission, ...],
) -> tuple[ToolPermission, ...]:
    unknown = set(requested) - set(ToolPermission)
    if unknown:
        raise ValidationFailure(
            FailureReason.UNSAFE_ARGUMENTS,
            f"unknown tool permissions: {sorted(str(p) for p in unknown)}",
            details={"permissions": [str(p) for p in unknown]},
        )
    return requested
