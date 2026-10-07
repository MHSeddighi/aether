"""SQLAlchemy tables.

Design notes:

* ids are strings (`bot_01J9...`) so they are opaque to the frontend and stable as idempotency keys;
* a bot's mutable columns live on `bots`, and every save appends an immutable `bot_versions` row that
  stores the *whole* execution snapshot (model config, instructions, tools, knowledge, rules) so a
  historical run can be reproduced exactly (Rule 36);
* `run_events` is append-only with a unique `(run_id, seq)` so SSE sequence numbers are gap-free and
  resumable (Rule 28).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.database.base import ID_LENGTH, Base, TimestampMixin


class WorkspaceRow(Base, TimestampMixin):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    plan: Mapped[str] = mapped_column(String(64), nullable=False, default="Team Pro")
    runs_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    runs_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=5000)
    tokens_used_million: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tokens_limit_million: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)


class UserRow(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    workspace: Mapped[WorkspaceRow] = relationship(lazy="joined")


class BotRow(Base, TimestampMixin):
    __tablename__ = "bots"
    __table_args__ = (
        Index("ix_bots_workspace_status", "workspace_id", "status"),
        CheckConstraint("temperature >= 0 AND temperature <= 2", name="temperature_range"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_fa: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description_fa: Mapped[str | None] = mapped_column(Text)
    avatar_icon: Mapped[str] = mapped_column(String(16), nullable=False, default="Bot")
    avatar_bg: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    bot_type: Mapped[str] = mapped_column(String(16), nullable=False, default="agent")
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="opencode")
    model_id: Mapped[str] = mapped_column(String(128), nullable=False, default="space-bunny-free")
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    instructions_fa: Mapped[str | None] = mapped_column(Text)
    tool_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    knowledge_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    deterministic_rules: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    top_p: Mapped[float] = mapped_column(Float, nullable=False, default=0.95)
    max_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=2048)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False, default="1.0.0")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    billing_usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    versions: Mapped[list[BotVersionRow]] = relationship(
        back_populates="bot", cascade="all, delete-orphan", order_by="BotVersionRow.created_at.desc()"
    )


class BotVersionRow(Base):
    """Immutable. A database trigger rejects UPDATE and DELETE (Rule 36)."""

    __tablename__ = "bot_versions"
    __table_args__ = (UniqueConstraint("bot_id", "version", name="uq_bot_versions_bot_id_version"),)

    version_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    bot_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    bot: Mapped[BotRow] = relationship(back_populates="versions")


class ToolRow(Base, TimestampMixin):
    __tablename__ = "tools"
    __table_args__ = (Index("ix_tools_workspace_category", "workspace_id", "category"),)

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_fa: Mapped[str | None] = mapped_column(String(200))
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="")
    purpose_fa: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(32), nullable=False, default="Link")
    connection_state: Mapped[str] = mapped_column(String(32), nullable=False, default="Connected")
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="api")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    versions: Mapped[list[ToolVersionRow]] = relationship(
        back_populates="tool", cascade="all, delete-orphan", order_by="ToolVersionRow.version.desc()"
    )


class ToolVersionRow(Base):
    """Immutable, like bot versions: schemas and permissions must not drift under a live tool."""

    __tablename__ = "tool_versions"
    __table_args__ = (UniqueConstraint("tool_id", "version", name="uq_tool_versions_tool_id_version"),)

    version_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    tool_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("tools.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    input_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    output_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    handler: Mapped[str] = mapped_column(String(16), nullable=False, default="builtin")
    handler_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    timeout_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=20.0)
    permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    tool: Mapped[ToolRow] = relationship(back_populates="versions")


class KnowledgeSourceRow(Base, TimestampMixin):
    __tablename__ = "knowledge_sources"
    __table_args__ = (Index("ix_knowledge_sources_workspace_status", "workspace_id", "status"),)

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    name_fa: Mapped[str | None] = mapped_column(String(300))
    type: Mapped[str] = mapped_column(String(16), nullable=False, default="text")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="Uploading")
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunks_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text)

    files: Mapped[list[FileRow]] = relationship(back_populates="source", cascade="all, delete-orphan")


class FileRow(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    source_id: Mapped[str] = mapped_column(
        String(ID_LENGTH),
        ForeignKey("knowledge_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    content_type: Mapped[str] = mapped_column(String(150), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(600), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    source: Mapped[KnowledgeSourceRow] = relationship(back_populates="files")


class ConversationRow(Base, TimestampMixin):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_workspace_updated", "workspace_id", "updated_at"),)

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bot_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="New Conversation")
    mode: Mapped[str] = mapped_column(String(24), nullable=False, default="agent-bot")
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    messages: Mapped[list[MessageRow]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="MessageRow.created_at",
    )


class MessageRow(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_conversation_created", "conversation_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(ID_LENGTH),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    run_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), index=True)
    sender: Mapped[str] = mapped_column(String(8), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_streaming: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: proposal / tool activity / knowledge retrieval / attachments / feedback (Rule 21: never
    #: arbitrary model JSON, always the validated domain projection).
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    conversation: Mapped[ConversationRow] = relationship(back_populates="messages")


class RunRow(Base):
    __tablename__ = "runs"
    __table_args__ = (
        Index("ix_runs_workspace_created", "workspace_id", "created_at"),
        Index("ix_runs_bot_created", "bot_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bot_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False)
    bot_version_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False)
    bot_version: Mapped[str] = mapped_column(String(32), nullable=False)
    model_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    input: Mapped[str] = mapped_column(Text, nullable=False, default="")
    conversation_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), index=True)
    assistant_message_id: Mapped[str | None] = mapped_column(String(ID_LENGTH))
    workflow_id: Mapped[str | None] = mapped_column(String(64))
    failure: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    output: Mapped[str | None] = mapped_column(Text)
    tool_activities: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    knowledge_sources: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    tokens_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    steps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    repairs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    events: Mapped[list[RunEventRow]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="RunEventRow.seq"
    )


class RunEventRow(Base):
    __tablename__ = "run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_run_events_run_id_seq"),
        Index("ix_run_events_run_seq", "run_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    run: Mapped[RunRow] = relationship(back_populates="events")


class ArtifactRow(Base):
    """Build output (State 10). Recorded before it is published so a retry can skip the work."""

    __tablename__ = "artifacts"
    __table_args__ = (Index("ix_artifacts_workspace_created", "workspace_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bot_id: Mapped[str | None] = mapped_column(String(ID_LENGTH))
    build_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    uri: Mapped[str] = mapped_column(String(600), nullable=False)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BuildRow(Base):
    """One build request (State 10). Carries the captured bot version and model config so a
    historical build can be reproduced (Rule 36)."""

    __tablename__ = "builds"
    __table_args__ = (Index("ix_builds_workspace_created", "workspace_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bot_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False, index=True)
    bot_version_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    specification: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    failure: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    image_tag: Mapped[str | None] = mapped_column(String(600))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BuildCheckpointRow(Base):
    """One durable checkpoint in the build pipeline (State 10, Rule 31).

    One row per (build_id, step) so a resumed build knows where it was and a retried activity
    upserts instead of appending a duplicate.
    """

    __tablename__ = "build_checkpoints"
    __table_args__ = (
        UniqueConstraint("build_id", "step", name="uq_build_checkpoints_build_id_step"),
        Index("ix_build_checkpoints_build_created", "build_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    build_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("builds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    output: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
