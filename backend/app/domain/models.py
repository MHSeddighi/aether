"""Model configuration and catalogue entries (Rule 6/7).

The backend owns model identity: a bot stores `provider` + `model_id`, and the human-readable
`model` string the frontend renders is *derived* from them.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.failures import FailureReason, ValidationFailure

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$")
_SEPARATOR_RE = re.compile(r"[-_]+")

DETERMINISTIC_LABEL = "Deterministic (No Model)"
DETERMINISTIC_MODEL_ID = "none"


class Provider(StrEnum):
    OPENROUTER = "openrouter"
    OPENCODE = "opencode"
    DEEPSEEK = "deepseek"
    DETERMINISTIC = "deterministic"

    @property
    def is_llm(self) -> bool:
        return self is not Provider.DETERMINISTIC


class RetryConfig(BaseModel):
    """Mirrors `RetryPolicy` from settings but is part of the captured run configuration."""

    model_config = ConfigDict(frozen=True)

    max_attempts: int = Field(ge=1, le=10)
    initial_interval_seconds: float = Field(gt=0, le=60)
    backoff_coefficient: float = Field(ge=1.0, le=10)
    max_interval_seconds: float = Field(gt=0, le=600)


class ModelConfig(BaseModel):
    """Immutable snapshot of everything needed to reproduce a run (Rule 36)."""

    model_config = ConfigDict(frozen=True)

    provider: Provider
    model_id: str
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    max_output_tokens: int = Field(default=2048, ge=16, le=131072)
    timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    retry: RetryConfig = Field(
        default_factory=lambda: RetryConfig(
            max_attempts=3,
            initial_interval_seconds=1.0,
            backoff_coefficient=2.0,
            max_interval_seconds=30.0,
        )
    )

    @field_validator("model_id")
    @classmethod
    def _valid_model_id(cls, value: str) -> str:
        if not _MODEL_ID_RE.match(value):
            raise ValueError("model_id contains unsupported characters")
        return value

    @model_validator(mode="after")
    def _deterministic_is_parameterless(self) -> ModelConfig:
        if self.provider is Provider.DETERMINISTIC:
            if self.model_id != DETERMINISTIC_MODEL_ID:
                raise ValueError(f"deterministic provider requires model_id {DETERMINISTIC_MODEL_ID!r}")
            if self.temperature != 0 or self.top_p != 1:
                raise ValueError("deterministic provider requires temperature=0 and top_p=1")
        return self

    @property
    def label(self) -> str:
        """Display label derived from provider + model_id (no stored display string to drift)."""
        if self.provider is Provider.DETERMINISTIC:
            return DETERMINISTIC_LABEL
        return humanize_model_id(self.model_id)

    def with_overrides(self, **changes: Any) -> ModelConfig:
        return self.model_copy(update=changes, deep=True)

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class CatalogModel(BaseModel):
    """One entry of a provider catalogue. Free-model lists are dynamic, so nothing is hard-coded."""

    model_config = ConfigDict(frozen=True)

    provider: Provider
    model_id: str
    label: str
    free: bool = False
    context_window: int | None = None

    @field_validator("model_id")
    @classmethod
    def _valid_model_id(cls, value: str) -> str:
        if not _MODEL_ID_RE.match(value):
            raise ValueError("model_id contains unsupported characters")
        return value


def humanize_model_id(model_id: str) -> str:
    """`space-bunny-free` -> `Space Bunny Free`,
    `deepseek/deepseek-v4.1-flash` -> `Deepseek V4.1 Flash`.

    Pure function, so labels are stable and unit-testable without touching a provider.
    """
    tail = model_id.rsplit("/", 1)[-1]
    words = _SEPARATOR_RE.sub(" ", tail).split()
    return " ".join(word[:1].upper() + word[1:] for word in words)


def deterministic_config() -> ModelConfig:
    return ModelConfig(
        provider=Provider.DETERMINISTIC,
        model_id=DETERMINISTIC_MODEL_ID,
        temperature=0.0,
        top_p=1.0,
        max_output_tokens=1024,
    )


def ensure_valid_bot_model(provider: Provider, model_id: str) -> None:
    """Raise a classified validation failure when a bot references an impossible model."""
    if provider is Provider.DETERMINISTIC and model_id != DETERMINISTIC_MODEL_ID:
        raise ValidationFailure(
            FailureReason.OUTPUT_CONSTRAINT,
            f"deterministic bots use model_id {DETERMINISTIC_MODEL_ID!r}, got {model_id!r}",
            details={"provider": str(provider), "model_id": model_id},
        )
