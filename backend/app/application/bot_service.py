"""Bot use cases.

The one rule worth restating: a write never mutates history. Every accepted change appends a new
immutable `BotVersion`, and the *latest* version is what a new run targets (Rule 36). The repository
enforces this in one transaction, so the service only has to build the version.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.application.ports import BotRepositoryPort
from app.domain.bots import Bot, BotStatus, BotVersion, bump_minor
from app.domain.failures import FailureReason, ValidationFailure
from app.domain.ids import new_id
from app.domain.models import Provider, ensure_valid_bot_model


class BotNotFound(Exception):
    """Missing *or* owned by another workspace. One exception so scoping cannot leak (Rule 42)."""

    def __init__(self, bot_id: str) -> None:
        super().__init__(f"bot {bot_id!r} was not found")
        self.bot_id = bot_id


class BotService:
    def __init__(self, bots: BotRepositoryPort) -> None:
        self._bots = bots

    async def list(self, workspace_id: str) -> list[Bot]:
        return await self._bots.list(workspace_id)

    async def get(self, workspace_id: str, bot_id: str) -> Bot:
        bot = await self._bots.get(bot_id, workspace_id)
        if bot is None:
            raise BotNotFound(bot_id)
        return bot

    async def create(self, workspace_id: str, draft: Bot) -> Bot:
        _validate(draft)
        bot = draft.model_copy(
            update={
                "bot_id": draft.bot_id or new_id("bot"),
                "workspace_id": workspace_id,
                "status": draft.status if draft.status is not BotStatus.ARCHIVED else BotStatus.DRAFT,
                "version": draft.version or "1.0.0",
            }
        )
        return await self._bots.add(bot, version=_version_for(bot, "Initial version"))

    async def update(self, workspace_id: str, bot_id: str, changes: dict, *, notes: str = "") -> Bot:
        """Apply `changes` and append an immutable version in the same transaction."""
        bot = await self.get(workspace_id, bot_id)
        requested = changes.get("status")
        if bot.status is BotStatus.ARCHIVED and requested is not BotStatus.ARCHIVED:
            # Archiving is soft: editing an archived bot revives it as a draft, because the frontend
            # has no separate "unarchive" affordance.
            changes = {**changes, "status": BotStatus.DRAFT}
        updated = _apply(bot, changes)
        _validate(updated)
        version = _version_for(updated, notes or f"Updated to {updated.version}")
        return await self._bots.update(updated, version=version, notes=notes)

    async def archive(self, workspace_id: str, bot_id: str) -> Bot:
        return await self.update(workspace_id, bot_id, {"status": BotStatus.ARCHIVED}, notes="Archived")

    async def versions(self, workspace_id: str, bot_id: str) -> list[BotVersion]:
        await self.get(workspace_id, bot_id)  # ownership check even when no versions exist
        return await self._bots.versions(bot_id, workspace_id)

    async def latest_version_id(self, workspace_id: str, bot_id: str) -> BotVersion:
        """The version a new run must target. A bot always has at least one."""
        bot = await self.get(workspace_id, bot_id)
        latest = bot.latest_version()
        if latest is None:
            raise ValidationFailure(
                FailureReason.OUTPUT_CONSTRAINT,
                f"bot {bot_id!r} has no version to run",
                details={"bot_id": bot_id},
            )
        return latest


def _version_for(bot: Bot, notes: str) -> BotVersion:
    return BotVersion(
        bot_id=bot.bot_id,
        version_id=new_id("botver"),
        version=bot.version,
        created_at=datetime.now(UTC),
        notes=notes,
        model_spec=bot.model_snapshot(),
        instructions=bot.instructions,
        instructions_fa=bot.instructions_fa,
        tool_ids=tuple(bot.tool_ids),
        knowledge_ids=tuple(bot.knowledge_ids),
        deterministic_rules=tuple(bot.deterministic_rules),
    )


def _apply(bot: Bot, changes: dict) -> Bot:
    """Apply a partial update, bumping the version label whenever behaviour changes."""
    behaviour_fields = {
        "provider",
        "model_id",
        "temperature",
        "top_p",
        "max_output_tokens",
        "instructions",
        "instructions_fa",
        "tool_ids",
        "knowledge_ids",
        "deterministic_rules",
        "bot_type",
    }
    unknown = set(changes) - set(Bot.model_fields)
    if unknown:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"unknown bot fields: {sorted(unknown)}",
            details={"fields": sorted(unknown)},
        )
    next_version = bump_minor(bot.version) if behaviour_fields & set(changes) else bot.version
    return bot.model_copy(update={**changes, "version": next_version, "updated_at": datetime.now(UTC)})


def _validate(bot: Bot) -> None:
    """Domain invariants already run in `Bot`'s own validator; this adds the cross-field checks."""
    ensure_valid_bot_model(Provider(bot.provider), bot.model_id)
    if bot.bot_type == "simple" and bot.provider != "deterministic":
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "simple bots are deterministic and must use the deterministic provider",
            details={"provider": str(bot.provider), "bot_type": str(bot.bot_type)},
        )
    if bot.bot_type == "agent" and bot.provider == "deterministic":
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            "agent bots need a real model provider; use bot_type 'simple' for deterministic bots",
            details={"provider": str(bot.provider), "bot_type": str(bot.bot_type)},
        )
