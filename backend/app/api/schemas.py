"""API schemas.

Two rules keep this layer thin:

* **Requests** are validated here, before anything reaches a use case. Snake_case on the wire
  (`bot_id`, not `botId`) because it is what pydantic produces from the domain models for free and
  it is what the contract documents (`docs/api-contract.md` §5).
* **Responses** are the *frontend* shapes, camelCase and all, produced by the `to_dict` helpers that
  already live next to their domain models. They are not re-declared here: a second declaration
  would be a second thing to drift.
"""

from __future__ import annotations

from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.domain.bots import Bot, BotStatus, BotType, DeterministicRule
from app.domain.conversations import Attachment, ConversationMode
from app.domain.models import DETERMINISTIC_MODEL_ID, Provider
from app.domain.tools import ConnectionState, ToolCategory, ToolPermission


class Request(BaseModel):
    """Base for request bodies: reject unknown fields instead of silently ignoring them."""

    model_config = ConfigDict(extra="forbid")


# --- auth ---------------------------------------------------------------


class RegisterRequest(Request):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=256)
    workspace_name: str | None = Field(default=None, max_length=200)


class LoginRequest(Request):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class RefreshRequest(Request):
    refresh_token: str = Field(min_length=1)


# --- bots ---------------------------------------------------------------


class BotFields(Request):
    """The optional half of a bot payload, shared by create and patch."""

    #: Accepted for round-tripping the frontend's `BotItem` and then ignored: model identity belongs
    #: to `provider` + `model_id` and the label is derived (Rule 4).
    model: str | None = None
    name_fa: str | None = None
    description: str = ""
    description_fa: str | None = None
    avatar_icon: str = "Bot"
    avatar_bg: str = "bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]"
    bot_type: BotType = BotType.AGENT
    provider: Provider | None = None
    model_id: str | None = None
    instructions: str = ""
    instructions_fa: str | None = None
    tool_ids: list[str] = Field(default_factory=list)
    knowledge_ids: list[str] = Field(default_factory=list)
    deterministic_rules: list[DeterministicRule] = Field(default_factory=list)
    temperature: float | None = None
    top_p: float | None = None
    max_output_tokens: int | None = None
    status: BotStatus | None = None
    enabled: bool | None = None

    #: Never applied: the backend owns model identity and derives this label.
    IGNORED: ClassVar[tuple[str, ...]] = ("model",)

    def _temperature_or_default(self, default: float) -> float:
        return default if self.temperature is None else self.temperature

    def _resolved_model(self, settings) -> tuple[Provider, str]:
        """Model identity comes from the request, never from the display label (Rule 4).

        A `simple` bot is deterministic by definition, so its provider is forced regardless of what
        the client sent.
        """
        if self.bot_type is BotType.SIMPLE:
            return Provider.DETERMINISTIC, DETERMINISTIC_MODEL_ID
        provider = Provider(self.provider or settings.default_provider)
        return provider, self.model_id or settings.default_model_id_for(str(provider))

    def to_draft(self, workspace_id: str, *, name: str) -> Bot:
        """Domain draft with the request's explicit `None`s replaced by the configured defaults."""
        from app.infrastructure.config import get_settings

        settings = get_settings()
        is_simple = self.bot_type is BotType.SIMPLE
        provider, model_id = self._resolved_model(settings)
        return Bot(
            bot_id="",
            workspace_id=workspace_id,
            name=name,
            name_fa=self.name_fa,
            description=self.description,
            description_fa=self.description_fa,
            avatar_icon=self.avatar_icon,
            avatar_bg=self.avatar_bg,
            bot_type=self.bot_type,
            provider=provider,
            model_id=model_id,
            instructions=self.instructions,
            instructions_fa=self.instructions_fa,
            tool_ids=list(self.tool_ids),
            knowledge_ids=list(self.knowledge_ids),
            deterministic_rules=list(self.deterministic_rules),
            temperature=(0.0 if is_simple else self._temperature_or_default(settings.default_temperature)),
            top_p=settings.default_top_p,
            max_output_tokens=(
                self.max_output_tokens
                if self.max_output_tokens is not None
                else settings.default_max_output_tokens
            ),
            status=self.status or BotStatus.ACTIVE,
            enabled=True if self.enabled is None else self.enabled,
        )

    def to_changes(self) -> dict[str, Any]:
        """Only the fields the caller actually sent, so a PATCH does not reset the others."""
        sent = self.model_dump(exclude_unset=True)
        return {key: value for key, value in sent.items() if key not in self.IGNORED}


class BotCreateRequest(BotFields):
    name: str = Field(min_length=1, max_length=200)

    def to_draft(self, workspace_id: str) -> Bot:
        return super().to_draft(workspace_id, name=self.name)


class BotPatchRequest(BotFields):
    """Every field optional: a patch changes what it mentions and nothing else.

    A single request model for create and patch cannot work: a patch must not have to resend `name`,
    and a create must not have to omit it.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)


# --- tools --------------------------------------------------------------


class ToolWriteRequest(Request):
    name: str = Field(min_length=1, max_length=200)
    name_fa: str | None = None
    purpose: str = ""
    purpose_fa: str | None = None
    icon: str = "Link"
    connection_state: ConnectionState = ConnectionState.CONNECTED
    category: ToolCategory = ToolCategory.API
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)
    # Execution contract (only used on create, or when it changes).
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    handler: Literal["builtin", "http", "docker"] = "builtin"
    handler_config: dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: float = Field(default=20.0, gt=0, le=300)
    permissions: list[ToolPermission] = Field(default_factory=list)

    def to_draft(self, workspace_id: str):
        from app.domain.ids import new_id
        from app.domain.tools import Tool

        return Tool(
            tool_id=new_id("tool"),
            workspace_id=workspace_id,
            name=self.name,
            name_fa=self.name_fa,
            purpose=self.purpose,
            purpose_fa=self.purpose_fa,
            icon=self.icon,
            connection_state=self.connection_state,
            category=self.category,
            enabled=self.enabled,
            config=self.config,
        )

    def to_version(self, tool_id: str, version_number: int):
        from datetime import UTC, datetime

        from app.domain.ids import new_id
        from app.domain.tools import ToolVersion

        return ToolVersion(
            tool_id=tool_id,
            version_id=new_id("toolver"),
            version=version_number,
            created_at=datetime.now(UTC),
            input_schema=self.input_schema,
            output_schema=self.output_schema,
            handler=self.handler,
            handler_config=self.handler_config,
            timeout_seconds=self.timeout_seconds,
            permissions=tuple(self.permissions),
        )

    def contract_fields(self) -> dict[str, Any]:
        return {
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "handler": self.handler,
            "handler_config": self.handler_config,
            "timeout_seconds": self.timeout_seconds,
            "permissions": list(self.permissions),
        }


class ToolPatchRequest(Request):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    purpose: str | None = None
    icon: str | None = None
    connection_state: ConnectionState | None = None
    category: ToolCategory | None = None
    enabled: bool | None = None
    config: dict[str, Any] | None = None
    timeout_seconds: float | None = Field(default=None, gt=0, le=300)
    permissions: list[ToolPermission] | None = None
    input_schema: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None
    handler: Literal["builtin", "http", "docker"] | None = None
    handler_config: dict[str, Any] | None = None

    def to_changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, exclude_unset=True)


# --- knowledge ----------------------------------------------------------


class KnowledgeRenameRequest(Request):
    name: str = Field(min_length=1, max_length=300)


# --- conversations ------------------------------------------------------


class ConversationCreateRequest(Request):
    bot_id: str
    title: str | None = Field(default=None, max_length=300)
    mode: ConversationMode | None = None


class ConversationPatchRequest(Request):
    title: str | None = Field(default=None, max_length=300)
    is_pinned: bool | None = None


class SendMessageRequest(Request):
    content: str = ""
    attachments: list[Attachment] = Field(default_factory=list)


class FeedbackRequest(Request):
    feedback: Literal["good", "bad"]


# --- builds --------------------------------------------------------------


class BuildRequest(Request):
    """What to build. Empty means "build the current version as-is"."""

    specification: str = Field(default="", max_length=8000)


class BuildStateResponse(Request):
    """Shape of `GET /builds/{id}` (documented so the OpenAPI schema is honest)."""

    build_id: str
    workspace_id: str
    bot_id: str
    bot_version_id: str
    status: str
    specification: str
    image_tag: str | None = None
    failure: dict | None = None
    created_at: str | None = None
    finished_at: str | None = None
    checkpoints: list[dict] = Field(default_factory=list)


# --- runs ---------------------------------------------------------------


class RunCreateRequest(Request):
    bot_id: str
    input: str = Field(min_length=1)
    conversation_id: str | None = None
    assistant_message_id: str | None = None


class ModelSettingsRequest(Request):
    """`PATCH /settings/model`. Stored per workspace so a team can pin its own default."""

    provider: Provider
    model_id: str = Field(min_length=1, max_length=128)
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    max_output_tokens: int = Field(default=2048, ge=16, le=131072)


PositiveInt = Annotated[int, Field(gt=0)]
