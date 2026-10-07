"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-07

Application state only. Temporal owns execution; nothing here is a task queue (Rule 35).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

ID = sa.String(length=64)
TZ = sa.DateTime(timezone=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("plan", sa.String(64), nullable=False),
        sa.Column("runs_used", sa.Integer(), nullable=False),
        sa.Column("runs_limit", sa.Integer(), nullable=False),
        sa.Column("tokens_used_million", sa.Float(), nullable=False),
        sa.Column("tokens_limit_million", sa.Float(), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "users",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_workspace_id", "users", ["workspace_id"])

    op.create_table(
        "bots",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_fa", sa.String(200)),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("description_fa", sa.Text()),
        sa.Column("avatar_icon", sa.String(16), nullable=False),
        sa.Column("avatar_bg", sa.String(200), nullable=False),
        sa.Column("bot_type", sa.String(16), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model_id", sa.String(128), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("instructions_fa", sa.Text()),
        sa.Column("tool_ids", JSONB, nullable=False),
        sa.Column("knowledge_ids", JSONB, nullable=False),
        sa.Column("deterministic_rules", JSONB, nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("top_p", sa.Float(), nullable=False),
        sa.Column("max_output_tokens", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("metrics", JSONB, nullable=False),
        sa.Column("billing_usage", JSONB),
        sa.Column("last_used_at", TZ),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.CheckConstraint("temperature >= 0 AND temperature <= 2", name="ck_bots_temperature_range"),
    )
    op.create_index("ix_bots_workspace_id", "bots", ["workspace_id"])
    op.create_index("ix_bots_workspace_status", "bots", ["workspace_id", "status"])

    op.create_table(
        "bot_versions",
        sa.Column("version_id", ID, primary_key=True, nullable=False),
        sa.Column("bot_id", ID, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.ForeignKeyConstraint(["bot_id"], ["bots.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("bot_id", "version", name="uq_bot_versions_bot_id_version"),
    )
    op.create_index("ix_bot_versions_bot_id", "bot_versions", ["bot_id"])
    op.create_index("ix_bot_versions_workspace_id", "bot_versions", ["workspace_id"])

    op.create_table(
        "tools",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_fa", sa.String(200)),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("purpose_fa", sa.Text()),
        sa.Column("icon", sa.String(32), nullable=False),
        sa.Column("connection_state", sa.String(32), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("config", JSONB, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_tools_workspace_id", "tools", ["workspace_id"])
    op.create_index("ix_tools_workspace_category", "tools", ["workspace_id", "category"])

    op.create_table(
        "tool_versions",
        sa.Column("version_id", ID, primary_key=True, nullable=False),
        sa.Column("tool_id", ID, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("input_schema", JSONB, nullable=False),
        sa.Column("output_schema", JSONB, nullable=False),
        sa.Column("handler", sa.String(16), nullable=False),
        sa.Column("handler_config", JSONB, nullable=False),
        sa.Column("timeout_seconds", sa.Float(), nullable=False),
        sa.Column("permissions", JSONB, nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tool_id", "version", name="uq_tool_versions_tool_id_version"),
    )
    op.create_index("ix_tool_versions_tool_id", "tool_versions", ["tool_id"])
    op.create_index("ix_tool_versions_workspace_id", "tool_versions", ["workspace_id"])

    op.create_table(
        "knowledge_sources",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("name_fa", sa.String(300)),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("progress_percent", sa.Integer(), nullable=False),
        sa.Column("chunks_count", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_knowledge_sources_workspace_id", "knowledge_sources", ["workspace_id"])
    op.create_index("ix_knowledge_sources_workspace_status", "knowledge_sources", ["workspace_id", "status"])

    op.create_table(
        "files",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("source_id", ID, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("filename", sa.String(300), nullable=False),
        sa.Column("content_type", sa.String(150), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("storage_path", sa.String(600), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["knowledge_sources.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_files_source_id", "files", ["source_id"])
    op.create_index("ix_files_workspace_id", "files", ["workspace_id"])

    op.create_table(
        "conversations",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("bot_id", ID, nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("mode", sa.String(24), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_conversations_bot_id", "conversations", ["bot_id"])
    op.create_index("ix_conversations_workspace_id", "conversations", ["workspace_id"])
    op.create_index("ix_conversations_workspace_updated", "conversations", ["workspace_id", "updated_at"])

    op.create_table(
        "messages",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("conversation_id", ID, nullable=False),
        sa.Column("run_id", ID),
        sa.Column("sender", sa.String(8), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_streaming", sa.Boolean(), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_run_id", "messages", ["run_id"])
    op.create_index("ix_messages_conversation_created", "messages", ["conversation_id", "created_at"])

    op.create_table(
        "runs",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("bot_id", ID, nullable=False),
        sa.Column("bot_version_id", ID, nullable=False),
        sa.Column("bot_version", sa.String(32), nullable=False),
        sa.Column("model_config", JSONB, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column("conversation_id", ID),
        sa.Column("assistant_message_id", ID),
        sa.Column("workflow_id", sa.String(64)),
        sa.Column("failure", JSONB),
        sa.Column("output", sa.Text()),
        sa.Column("tool_activities", JSONB, nullable=False),
        sa.Column("knowledge_sources", JSONB, nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=False),
        sa.Column("tokens_out", sa.Integer(), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=False),
        sa.Column("repairs", sa.Integer(), nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("started_at", TZ),
        sa.Column("finished_at", TZ),
        sa.Column("deadline_at", TZ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_runs_workspace_id", "runs", ["workspace_id"])
    op.create_index("ix_runs_conversation_id", "runs", ["conversation_id"])
    op.create_index("ix_runs_workspace_created", "runs", ["workspace_id", "created_at"])
    op.create_index("ix_runs_bot_created", "runs", ["bot_id", "created_at"])

    op.create_table(
        "run_events",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("run_id", ID, nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("data", JSONB, nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("run_id", "seq", name="uq_run_events_run_id_seq"),
    )
    op.create_index("ix_run_events_run_seq", "run_events", ["run_id", "seq"])

    op.create_table(
        "artifacts",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("bot_id", ID),
        sa.Column("build_id", ID),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("uri", sa.String(600), nullable=False),
        sa.Column("checksum_sha256", sa.String(64)),
        sa.Column("metadata", JSONB, nullable=False),
        sa.Column("created_at", TZ, nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_artifacts_workspace_id", "artifacts", ["workspace_id"])
    op.create_index("ix_artifacts_build_id", "artifacts", ["build_id"])
    op.create_index("ix_artifacts_workspace_created", "artifacts", ["workspace_id", "created_at"])

    _create_immutability_guards()


def _create_immutability_guards() -> None:
    """Bot and tool versions are append-only, enforced by the database (Rule 36/30).

    A trigger is used rather than application discipline so a buggy migration or a direct psql
    session cannot rewrite history.
    """
    op.execute(
        """
        CREATE OR REPLACE FUNCTION reject_version_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% rows are immutable (attempted %)', TG_TABLE_NAME, TG_OP
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    for table in ("bot_versions", "tool_versions"):
        op.execute(
            f"""
            CREATE TRIGGER {table}_immutable
                BEFORE UPDATE OR DELETE ON {table}
                FOR EACH ROW EXECUTE FUNCTION reject_version_mutation();
            """
        )


def downgrade() -> None:
    for table in ("tool_versions", "bot_versions"):
        op.execute(f"DROP TRIGGER IF EXISTS {table}_immutable ON {table};")
    op.execute("DROP FUNCTION IF EXISTS reject_version_mutation();")
    for table in (
        "artifacts",
        "run_events",
        "runs",
        "messages",
        "conversations",
        "files",
        "knowledge_sources",
        "tool_versions",
        "tools",
        "bot_versions",
        "bots",
        "users",
        "workspaces",
    ):
        op.drop_table(table)
