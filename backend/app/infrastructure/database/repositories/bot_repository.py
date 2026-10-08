"""Bot persistence, including the immutable-version append (Rule 36)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.bots import (
    Bot,
    BotBillingUsage,
    BotMetrics,
    BotStatus,
    BotType,
    BotVariable,
    BotVersion,
    DeterministicRule,
)
from app.domain.models import ModelConfig, Provider
from app.infrastructure.database.tables import BotRow, BotVersionRow


def snapshot_of(bot: Bot) -> dict[str, Any]:
    """The complete execution snapshot stored with every version."""
    return {
        "model_spec": bot.model_snapshot().model_dump(mode="json"),
        "instructions": bot.instructions,
        "instructions_fa": bot.instructions_fa,
        "tool_ids": list(bot.tool_ids),
        "knowledge_ids": list(bot.knowledge_ids),
        "deterministic_rules": [rule.model_dump() for rule in bot.deterministic_rules],
        "variables": [variable.model_dump() for variable in bot.variables],
        "bot_type": str(bot.bot_type),
    }


def version_from_snapshot(row: BotVersionRow) -> BotVersion:
    snapshot = row.snapshot
    return BotVersion(
        bot_id=row.bot_id,
        version_id=row.version_id,
        version=row.version,
        created_at=row.created_at,
        notes=row.notes,
        model_spec=ModelConfig.model_validate(snapshot["model_spec"]),
        instructions=snapshot.get("instructions", ""),
        instructions_fa=snapshot.get("instructions_fa"),
        tool_ids=tuple(snapshot.get("tool_ids", [])),
        knowledge_ids=tuple(snapshot.get("knowledge_ids", [])),
        deterministic_rules=tuple(
            DeterministicRule.model_validate(rule) for rule in snapshot.get("deterministic_rules", [])
        ),
        variables=tuple(BotVariable.model_validate(v) for v in snapshot.get("variables", [])),
    )


def to_domain(row: BotRow, versions: list[BotVersionRow] | None = None) -> Bot:
    return Bot(
        bot_id=row.id,
        workspace_id=row.workspace_id,
        name=row.name,
        name_fa=row.name_fa,
        description=row.description,
        description_fa=row.description_fa,
        avatar_icon=row.avatar_icon,
        avatar_bg=row.avatar_bg,
        bot_type=BotType(row.bot_type),
        provider=Provider(row.provider),
        model_id=row.model_id,
        instructions=row.instructions,
        instructions_fa=row.instructions_fa,
        tool_ids=list(row.tool_ids or []),
        knowledge_ids=list(row.knowledge_ids or []),
        deterministic_rules=[DeterministicRule.model_validate(r) for r in row.deterministic_rules or []],
        variables=[BotVariable.model_validate(v) for v in row.variables or []],
        temperature=row.temperature,
        top_p=row.top_p,
        max_output_tokens=row.max_output_tokens,
        status=BotStatus(row.status),
        enabled=row.enabled,
        version=row.version,
        versions=[version_from_snapshot(v) for v in (versions or [])],
        metrics=BotMetrics.model_validate(row.metrics or {}),
        billing_usage=BotBillingUsage.model_validate(row.billing_usage) if row.billing_usage else None,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_used_at=row.last_used_at,
    )


def _rule_payload(rule: DeterministicRule | dict) -> dict:
    """Serialise one deterministic rule.

    Persistence accepts a plain dict as well as a `DeterministicRule`: an aggregate
    assembled outside the service layer carries request-shaped values, and failing
    here would surface as an opaque 500 on a routine save.
    """
    if isinstance(rule, dict):
        return DeterministicRule.model_validate(rule).model_dump()
    return rule.model_dump()


def _variable_payload(variable: BotVariable | dict) -> dict:
    """Serialise one bot variable, accepting a plain dict for the same reason `_rule_payload` does."""
    if isinstance(variable, dict):
        return BotVariable.model_validate(variable).model_dump()
    return variable.model_dump()


def apply_to_row(row: BotRow, bot: Bot) -> BotRow:
    row.name = bot.name
    row.name_fa = bot.name_fa
    row.description = bot.description
    row.description_fa = bot.description_fa
    row.avatar_icon = bot.avatar_icon
    row.avatar_bg = bot.avatar_bg
    row.bot_type = str(bot.bot_type)
    row.provider = str(bot.provider)
    row.model_id = bot.model_id
    row.instructions = bot.instructions
    row.instructions_fa = bot.instructions_fa
    row.tool_ids = list(bot.tool_ids)
    row.knowledge_ids = list(bot.knowledge_ids)
    row.deterministic_rules = [_rule_payload(rule) for rule in bot.deterministic_rules]
    row.variables = [_variable_payload(variable) for variable in bot.variables]
    row.temperature = bot.temperature
    row.top_p = bot.top_p
    row.max_output_tokens = bot.max_output_tokens
    row.status = str(bot.status)
    row.enabled = bot.enabled
    row.version = bot.version
    row.metrics = bot.metrics.model_dump()
    row.billing_usage = bot.billing_usage.model_dump() if bot.billing_usage else None
    return row


class BotRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, bot: Bot, *, version: BotVersion, notes: str = "Initial version") -> Bot:
        row = BotRow(
            id=bot.bot_id,
            workspace_id=bot.workspace_id,
            name=bot.name,
            name_fa=bot.name_fa,
            description=bot.description,
            description_fa=bot.description_fa,
            avatar_icon=bot.avatar_icon,
            avatar_bg=bot.avatar_bg,
            bot_type=str(bot.bot_type),
            provider=str(bot.provider),
            model_id=bot.model_id,
            instructions=bot.instructions,
            instructions_fa=bot.instructions_fa,
            tool_ids=list(bot.tool_ids),
            knowledge_ids=list(bot.knowledge_ids),
            deterministic_rules=[_rule_payload(rule) for rule in bot.deterministic_rules],
            variables=[_variable_payload(variable) for variable in bot.variables],
            temperature=bot.temperature,
            top_p=bot.top_p,
            max_output_tokens=bot.max_output_tokens,
            status=str(bot.status),
            enabled=bot.enabled,
            version=bot.version,
            metrics=bot.metrics.model_dump(),
            billing_usage=bot.billing_usage.model_dump() if bot.billing_usage else None,
            last_used_at=bot.last_used_at,
            created_at=bot.created_at,
        )
        self._session.add(row)
        self._session.add(
            BotVersionRow(
                version_id=version.version_id,
                bot_id=bot.bot_id,
                workspace_id=bot.workspace_id,
                version=version.version,
                notes=notes,
                snapshot=snapshot_of(bot),
                created_at=version.created_at,
            )
        )
        await self._session.flush()
        bot.versions = [version]
        return bot

    async def get(self, bot_id: str, workspace_id: str) -> Bot | None:
        row = await self._row(bot_id, workspace_id)
        return to_domain(row, row.versions) if row else None

    async def list(self, workspace_id: str, *, limit: int = 200) -> list[Bot]:
        result = await self._session.execute(
            select(BotRow)
            .options(selectinload(BotRow.versions))
            .where(BotRow.workspace_id == workspace_id)
            .order_by(BotRow.updated_at.desc())
            .limit(limit)
        )
        return [to_domain(row, row.versions) for row in result.scalars().all()]

    async def update(self, bot: Bot, *, version: BotVersion | None, notes: str) -> Bot:
        """Mutate the aggregate row *and*, when the behaviour changed, append a new version.

        `version=None` means "nothing about the behaviour changed" (a rename, a new
        description, a new avatar). Versions are immutable snapshots and `(bot_id,
        version)` is unique, so re-inserting the current label would fail — a
        presentation-only save must not create history.
        """
        row = await self._row(bot.bot_id, bot.workspace_id)
        if row is None:
            raise LookupError(f"bot {bot.bot_id!r} not found in workspace {bot.workspace_id!r}")
        previous = [version_from_snapshot(v) for v in row.versions]
        apply_to_row(row, bot)
        if version is not None:
            self._session.add(
                BotVersionRow(
                    version_id=version.version_id,
                    bot_id=bot.bot_id,
                    workspace_id=bot.workspace_id,
                    version=version.version,
                    notes=notes,
                    snapshot=snapshot_of(bot),
                    created_at=version.created_at,
                )
            )
        await self._session.flush()
        bot.versions = [version, *previous] if version is not None else previous
        return bot

    async def versions(self, bot_id: str, workspace_id: str) -> list[BotVersion]:
        result = await self._session.execute(
            select(BotVersionRow)
            .where(BotVersionRow.bot_id == bot_id, BotVersionRow.workspace_id == workspace_id)
            .order_by(BotVersionRow.created_at.desc())
        )
        return [version_from_snapshot(row) for row in result.scalars().all()]

    async def version(self, version_id: str) -> BotVersion | None:
        row = await self._get_version_row(version_id)
        return version_from_snapshot(row) if row else None

    async def find_builder(self, workspace_id: str) -> Bot | None:
        row = await self._session.scalar(
            select(BotRow)
            .options(selectinload(BotRow.versions))
            .where(BotRow.workspace_id == workspace_id, BotRow.is_builder.is_(True))
            .limit(1)
        )
        return to_domain(row, row.versions) if row else None

    async def add_builder(self, bot: Bot, *, version: BotVersion) -> Bot:
        """Persist a builder host. Separate from `add` so only this path can set the marker."""
        created = await self.add(bot, version=version)
        row = await self._row(bot.bot_id, bot.workspace_id)
        if row is not None:
            row.is_builder = True
        return created

    async def touch_usage(self, bot_id: str, *, last_used_at: datetime, metrics: BotMetrics) -> None:
        row = await self._session.get(BotRow, bot_id)
        if row is not None:
            row.last_used_at = last_used_at
            row.metrics = metrics.model_dump()

    async def _row(self, bot_id: str, workspace_id: str) -> BotRow | None:
        result = await self._session.execute(
            select(BotRow)
            .options(selectinload(BotRow.versions))
            .where(BotRow.id == bot_id, BotRow.workspace_id == workspace_id)
        )
        return result.scalar_one_or_none()

    async def _get_version_row(self, version_id: str) -> BotVersionRow:
        result = await self._session.execute(
            select(BotVersionRow).where(BotVersionRow.version_id == version_id)
        )
        return result.scalar_one()
