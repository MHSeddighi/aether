"""Bot aggregate.

Rules that the product depends on:

* a bot has immutable versions; the latest version number is the only mutable part of the aggregate;
* a run always targets a specific `bot_version_id` (Rule 36);
* `bot_type='simple'` bots are deterministic: rules, no model, no tools, no knowledge
  (the frontend relies on this: `WorkspaceContext.tsx:790`).
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.models import (
    DETERMINISTIC_MODEL_ID,
    ModelConfig,
    Provider,
    deterministic_config,
    humanize_model_id,
)

MINOR_VERSION_STEP = 1


class BotType(StrEnum):
    AGENT = "agent"
    SIMPLE = "simple"


class BotStatus(StrEnum):
    ACTIVE = "active"
    DRAFT = "draft"
    ARCHIVED = "archived"


class DeterministicRule(BaseModel):
    model_config = ConfigDict(frozen=True)

    trigger: str = Field(min_length=1, max_length=200)
    response: str = Field(min_length=1, max_length=8000)

    @field_validator("trigger")
    @classmethod
    def _trigger_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("trigger must not be blank")
        return value.strip()


class BotMetrics(BaseModel):
    """Aggregated counters; the frontend renders these directly."""

    total_runs: int = 0
    avg_latency_ms: int = 0
    tokens_consumed: int = 0
    success_rate_percent: float = 100.0


class BotBillingUsage(BaseModel):
    monthly_estimated_cost: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    cost_per_thousand_requests: float = 0.0
    rpm_quota: int = 0
    tpm_quota: int = 0
    monthly_budget_cap: float = 0.0


class BotVersion(BaseModel):
    """Immutable snapshot. `version_id` is stable; `version` is the human label."""

    model_config = ConfigDict(frozen=True)

    bot_id: str
    version_id: str
    version: str
    created_at: datetime
    notes: str = ""
    model_spec: ModelConfig
    instructions: str
    instructions_fa: str | None = None
    tool_ids: tuple[str, ...] = ()
    knowledge_ids: tuple[str, ...] = ()
    deterministic_rules: tuple[DeterministicRule, ...] = ()

    @property
    def label(self) -> str:
        return self.model_spec.label


class Bot(BaseModel):
    """The mutable aggregate root: identity, presentation, and the current version pointer."""

    bot_id: str
    workspace_id: str
    name: str = Field(min_length=1, max_length=200)
    name_fa: str | None = None
    description: str = ""
    description_fa: str | None = None
    avatar_icon: str = "Bot"
    avatar_bg: str = "bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]"
    bot_type: BotType = BotType.AGENT
    provider: Provider = Provider.DETERMINISTIC
    model_id: str = DETERMINISTIC_MODEL_ID
    instructions: str = ""
    instructions_fa: str | None = None
    tool_ids: list[str] = Field(default_factory=list)
    knowledge_ids: list[str] = Field(default_factory=list)
    deterministic_rules: list[DeterministicRule] = Field(default_factory=list)
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    max_output_tokens: int = Field(default=2048, ge=16, le=131072)
    status: BotStatus = BotStatus.ACTIVE
    enabled: bool = True
    version: str = "1.0.0"
    versions: list[BotVersion] = Field(default_factory=list)
    metrics: BotMetrics = Field(default_factory=BotMetrics)
    billing_usage: BotBillingUsage | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_used_at: datetime | None = None

    @model_validator(mode="after")
    def _type_specific_invariants(self) -> Self:
        if self.bot_type is BotType.SIMPLE:
            if not self.deterministic_rules:
                raise ValueError("simple bots require at least one deterministic rule")
            if self.tool_ids or self.knowledge_ids:
                raise ValueError("simple bots cannot use tools or knowledge")
            if self.temperature != 0:
                raise ValueError("simple bots must run at temperature 0")
        return self

    # --- derived values -------------------------------------------------

    @property
    def model(self) -> str:
        """The `model` display string the frontend renders, derived (never stored)."""
        if self.bot_type is BotType.SIMPLE:
            return deterministic_config().label
        return humanize_model_id(self.model_id)

    def model_snapshot(self) -> ModelConfig:
        if self.bot_type is BotType.SIMPLE:
            return deterministic_config()
        return ModelConfig(
            provider=self.provider,
            model_id=self.model_id,
            temperature=self.temperature,
            top_p=self.top_p,
            max_output_tokens=self.max_output_tokens,
        )

    def latest_version(self) -> BotVersion | None:
        return self.versions[0] if self.versions else None

    def match_rule(self, text: str) -> DeterministicRule | None:
        lowered = text.lower()
        for rule in self.deterministic_rules:
            if rule.trigger.lower() in lowered:
                return rule
        return None

    def next_version_label(self) -> str:
        return bump_minor(self.version)


def bump_minor(version: str, step: int = MINOR_VERSION_STEP) -> str:
    """`1.2.0` + step 1 -> `1.3.0`; unparsable labels fall back to appending `.1`."""
    parts = version.split(".")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        major, minor, patch = (int(part) for part in parts)
        return f"{major}.{minor + step}.{patch}"
    return f"{version}.{step}"


class BotMetricsAccumulator:
    """Running totals folded into `BotMetrics` when a run finishes.

    Kept as a tiny value object instead of SQL aggregation so the arithmetic is unit-testable and
    identical for the API path and the workflow path.
    """

    __slots__ = ("_latency_total_ms", "_runs", "_successes", "_tokens", "_workspace")

    def __init__(self, existing: BotMetrics | None = None) -> None:
        base = existing or BotMetrics()
        self._workspace = 1
        self._runs = base.total_runs
        self._successes = round(base.success_rate_percent / 100 * base.total_runs)
        self._latency_total_ms = base.avg_latency_ms * base.total_runs
        self._tokens = base.tokens_consumed

    def record(self, *, latency_ms: int, tokens: int, succeeded: bool) -> None:
        self._runs += 1
        self._latency_total_ms += max(latency_ms, 0)
        self._tokens += max(tokens, 0)
        if succeeded:
            self._successes += 1

    def result(self) -> BotMetrics:
        total = max(self._runs, 1)
        return BotMetrics(
            total_runs=self._runs,
            avg_latency_ms=int(self._latency_total_ms / total),
            tokens_consumed=self._tokens,
            success_rate_percent=round(self._successes / total * 100, 2),
        )


def bot_to_dict(bot: Bot) -> dict[str, Any]:
    """Serialise to the exact camelCase shape of `web/src/types/agent.ts#BotItem`."""
    return {
        "id": bot.bot_id,
        "name": bot.name,
        "nameFa": bot.name_fa or bot.name,
        "botType": str(bot.bot_type),
        "description": bot.description,
        "descriptionFa": bot.description_fa or bot.description,
        "avatarIcon": bot.avatar_icon,
        "avatarBg": bot.avatar_bg,
        "model": bot.model,
        "provider": str(bot.provider),
        "modelId": bot.model_id,
        "instructions": bot.instructions,
        "instructionsFa": bot.instructions_fa or bot.instructions,
        "toolIds": list(bot.tool_ids),
        "knowledgeIds": list(bot.knowledge_ids),
        "deterministicRules": [r.model_dump() for r in bot.deterministic_rules],
        "temperature": bot.temperature,
        "topP": bot.top_p,
        "maxOutputTokens": bot.max_output_tokens,
        "status": str(bot.status),
        "enabled": bot.enabled,
        "version": bot.version,
        "versions": [
            {
                "version": v.version,
                "versionId": v.version_id,
                "updatedAt": _relative(v.created_at),
                "notes": v.notes,
                "model": v.model_spec.label,
                "provider": str(v.model_spec.provider),
                "modelId": v.model_spec.model_id,
                "temperature": v.model_spec.temperature,
            }
            for v in bot.versions
        ],
        "metrics": bot.metrics.model_dump(),
        "billingUsage": bot.billing_usage.model_dump() if bot.billing_usage else None,
        "lastUsed": _relative(bot.last_used_at) if bot.last_used_at else "Never",
    }


def _relative(moment: datetime) -> str:
    """Human-readable timestamps, matching the frontend's existing style ('2h ago')."""
    delta = datetime.now(UTC) - moment
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "Just now"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    if seconds < 86400 * 7:
        return f"{seconds // 86400}d ago"
    return moment.strftime("%Y-%m-%d")
