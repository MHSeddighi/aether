"""bots.variables + bots.is_builder columns

Revision ID: 0003_bot_variables
Revises: 0002_builds
Create Date: 2026-10-08

Bot variables are the `{{name}}` constants a bot declares and the runner substitutes into its
instructions at execution time. They live in a JSONB column next to `deterministic_rules` because
they are part of the immutable execution snapshot a `bot_versions` row stores — a historical run
has to reproduce exactly, so the variables that shaped its prompt belong in the version snapshot
alongside the instructions they are referenced from (Rule 36).

The column is `NOT NULL DEFAULT '[]'` so existing rows read back as "no variables" without a data
migration, and so the domain model never has to defend against `NULL`.

`bots.is_builder` marks the single per-workspace host bot that a builder conversation runs against
before the bot it is building exists. It is infrastructure bookkeeping rather than behaviour, so it
is intentionally absent from the `Bot` aggregate and never serialised to the frontend.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_bot_variables"
down_revision = "0002_builds"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column(
        "bots",
        sa.Column("variables", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "bots",
        sa.Column("is_builder", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_bots_is_builder", "bots", ["is_builder"])


def downgrade() -> None:
    op.drop_index("ix_bots_is_builder", table_name="bots")
    op.drop_column("bots", "is_builder")
    op.drop_column("bots", "variables")
