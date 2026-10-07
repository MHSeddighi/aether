"""Prompt construction.

System prompts are built here, once, from the bot's own version snapshot. Nothing about a specific
provider or model id leaks into them (Rule 6).
"""

from __future__ import annotations

from app.agents.request import AgentRequest, ToolSpec

ANSWER_GUARDRAILS = """
- Answer in the language the user wrote in.
- Be concise and factual. If you used a tool, base the answer on its output.
- If a tool fails, say so plainly instead of inventing a result.
- Never invent tool output, citations or file contents.
""".strip()


def build_system_prompt(request: AgentRequest) -> str:
    sections = [request.instructions.strip() or "You are a helpful assistant.", ANSWER_GUARDRAILS]
    if request.tools:
        names = ", ".join(tool.name for tool in request.tools)
        sections.append(f"Available tools: {names}.")
    if request.knowledge:
        sections.append(f"Knowledge sources attached: {', '.join(request.knowledge)}.")
    return "\n\n".join(sections)


def tool_names(specs: tuple[ToolSpec, ...]) -> list[str]:
    return [spec.tool_id.replace("-", "_") for spec in specs]
