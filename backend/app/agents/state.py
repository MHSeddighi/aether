"""Graph state.

A `TypedDict` because LangGraph merges partial node updates into it. Everything the graph produces is
validated again at the edge (`finalize`), so nothing here is trusted application state (Rule 21).
"""

from __future__ import annotations

from typing import Annotated, Any, TypedDict

from app.infrastructure.models.base import ChatMessage, ToolCall

STOP_NO_TOOLS = "no_tool_calls"
STOP_MAX_STEPS = "max_steps_reached"
STOP_DEADLINE = "deadline_exceeded"
STOP_ERROR = "tool_error"


def _replace_messages(left, right):
    """Messages are appended by the nodes that produce them, so a plain append merge is correct."""
    return [*(left or []), *(right or [])]


def _merge_usage(left: dict[str, int] | None, right: dict[str, int] | None) -> dict[str, int]:
    """Accumulate token counters across steps instead of overwriting them."""
    base = left or {}
    extra = right or {}
    return {
        "input_tokens": base.get("input_tokens", 0) + extra.get("input_tokens", 0),
        "output_tokens": base.get("output_tokens", 0) + extra.get("output_tokens", 0),
    }


def _merge_list(left: list | None, right: list | None) -> list:
    return [*(left or []), *(right or [])]


def _replace_list(left, right):
    """For values a node produces once and consumes once (e.g. the pending tool calls)."""
    return right if right is not None else left


class AgentState(TypedDict, total=False):
    messages: Annotated[list[ChatMessage], _replace_messages]
    steps: Annotated[int, lambda a, b: max(a or 0, b or 0)]
    usage: Annotated[dict[str, int], _merge_usage]
    tool_results: Annotated[list[dict[str, Any]], _merge_list]
    pending_tool_calls: Annotated[list[ToolCall], _replace_list]
    final_text: str
    stop_reason: str
    last_error: str | None
