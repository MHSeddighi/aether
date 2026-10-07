"""builds + build_checkpoints tables

Revision ID: 0002_builds
Revises: 0001_initial
Create Date: 2026-10-07

Durable build state for BuildBotWorkflow (Rule 13/31). Two tables:

* `builds` — one row per build request: the bot version it targets, its status, and the captured
  model configuration so a historical build can be reproduced (Rule 36).
* `build_checkpoints` — one row per (build_id, step) so a resumed build knows exactly which step it
  completed, and a crashed build leaves a readable trail.

The (build_id, step) uniqueness is what makes checkpoint writes idempotent: a retried activity
upserts instead of appending a duplicate row.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002_builds"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

ID = sa.String(length=64)
TZ = sa.DateTime(timezone=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "builds",
        sa.Column("id", ID, primary_key=True, nullable=False),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("bot_id", ID, nullable=False),
        sa.Column("bot_version_id", ID, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("specification", sa.Text(), nullable=False, server_default=""),
        sa.Column("model_config", JSONB, nullable=False, server_default="{}"),
        sa.Column("failure", JSONB),
        sa.Column("image_tag", sa.String(600)),
        sa.Column("created_at", TZ, nullable=False),
        sa.Column("finished_at", TZ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_builds_workspace_id", "builds", ["workspace_id"])
    op.create_index("ix_builds_bot_id", "builds", ["bot_id"])
    op.create_index("ix_builds_workspace_created", "builds", ["workspace_id", "created_at"])

    op.create_table(
        "build_checkpoints",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("build_id", ID, nullable=False),
        sa.Column("step", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("output", JSONB, nullable=False, server_default="{}"),
        sa.Column("error", JSONB),
        sa.Column("created_at", TZ, nullable=False),
        sa.ForeignKeyConstraint(["build_id"], ["builds.id"], ondelete="CASCADE"),
        # One checkpoint per step: the upsert in persist_checkpoint depends on this.
        sa.UniqueConstraint("build_id", "step", name="uq_build_checkpoints_build_id_step"),
    )
    op.create_index("ix_build_checkpoints_build_id", "build_checkpoints", ["build_id"])
    op.create_index("ix_build_checkpoints_build_created", "build_checkpoints", ["build_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_build_checkpoints_build_created", table_name="build_checkpoints")
    op.drop_index("ix_build_checkpoints_build_id", table_name="build_checkpoints")
    op.drop_table("build_checkpoints")
    op.drop_index("ix_builds_workspace_created", table_name="builds")
    op.drop_index("ix_builds_bot_id", table_name="builds")
    op.drop_index("ix_builds_workspace_id", table_name="builds")
    op.drop_table("builds")
