"""Tool handlers: the only code that actually performs a tool's side effect.

A handler receives already-validated, already-authorised, already-deadline-bound arguments. It must
return a JSON-serialisable dict, which the gateway validates against the tool's output schema before
the agent ever sees it (Rule 22).

Handlers never talk to the database, to Temporal, or to the model gateway: that keeps the untrusted
code path (State 10) and the trusted code path symmetrical.
"""

from __future__ import annotations

import ast
import contextlib
import math
import operator
from typing import Any, Protocol

from app.domain.deadline import Deadline
from app.domain.failures import FailureReason, ToolFailure


class ToolHandler(Protocol):
    name: str

    async def __call__(self, arguments: dict[str, Any], *, deadline: Deadline) -> dict[str, Any]: ...


_BIN_OPS: dict[type[ast.AST], Any] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}
_FUNCS = {
    "abs": abs,
    "min": min,
    "max": max,
    "sum": sum,
    "round": round,
    "sqrt": math.sqrt,
    "log": math.log,
    "exp": math.exp,
    "floor": math.floor,
    "ceil": math.ceil,
}
_MAX_NODES = 200


class PythonMathHandler:
    """Evaluate a small arithmetic expression.

    The AST is walked against an allow-list instead of using `eval`, so a crafted expression cannot
    reach builtins, imports, attribute access or calls other than the listed maths functions.
    """

    name = "python_math"

    async def __call__(self, arguments: dict[str, Any], *, deadline: Deadline) -> dict[str, Any]:
        deadline.require(0.05, what="math evaluation")
        expression = str(arguments.get("expression", ""))
        try:
            value = self._evaluate(ast.parse(expression, mode="eval").body)
        except ToolFailure:
            raise
        except ZeroDivisionError as exc:
            raise ToolFailure(FailureReason.TOOL_INVALID_OUTPUT, "division by zero") from exc
        except Exception as exc:
            raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, f"cannot evaluate expression: {exc}") from exc
        return {"expression": expression, "result": value}

    def _evaluate(self, node: ast.AST) -> Any:
        self._count_nodes(node)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float, complex)):
                return node.value
            raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, "only numeric literals are allowed")
        if isinstance(node, ast.BinOp):
            op = _BIN_OPS.get(type(node.op))
            if op is None:
                raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, "operator is not allowed")
            return op(self._evaluate(node.left), self._evaluate(node.right))
        if isinstance(node, ast.UnaryOp):
            op = _BIN_OPS.get(type(node.op))
            if op is None:
                raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, "operator is not allowed")
            return op(self._evaluate(node.operand))
        if isinstance(node, (ast.List, ast.Tuple)):
            return [self._evaluate(item) for item in node.elts]
        if isinstance(node, ast.Name):
            if node.id in _FUNCS:
                return _FUNCS[node.id]
            raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, f"name {node.id!r} is not allowed")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCS:
                raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, "function is not allowed")
            return _FUNCS[node.func.id](*[self._evaluate(a) for a in node.args])
        raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, "expression form is not allowed")

    def _count_nodes(self, node: ast.AST) -> None:
        nodes = list(ast.walk(node))
        if len(nodes) > _MAX_NODES:
            raise ToolFailure(FailureReason.TOOL_INPUT_INVALID, "expression is too large")


class HttpRequestHandler:
    """Call an external HTTP endpoint. Requires the `network` permission."""

    name = "http_request"

    def __init__(self, client_factory=None) -> None:
        self._client_factory = client_factory

    async def __call__(self, arguments: dict[str, Any], *, deadline: Deadline) -> dict[str, Any]:
        import httpx

        url = str(arguments.get("url", ""))
        method = str(arguments.get("method", "GET")).upper()
        headers = dict(arguments.get("headers") or {})
        body = arguments.get("body")
        timeout = deadline.budget(float(arguments.get("timeout_seconds", 10.0)))

        if self._client_factory is not None:
            client = self._client_factory()
            try:
                response = await client.request(method, url, headers=headers, json=body, timeout=timeout)
            finally:
                await client.aclose()
        else:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(method, url, headers=headers, json=body)

        payload: dict[str, Any] = {
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type", ""),
            "body": response.text[:8000],
        }
        with contextlib.suppress(ValueError):
            payload["json"] = response.json()
        return payload


class KnowledgeSearchHandler:
    """Placeholder retrieval over indexed knowledge. State 11 replaces it with real chunk search."""

    name = "knowledge_search"

    def __init__(self, chunks: dict[str, list[str]] | None = None) -> None:
        self._chunks = chunks or {}

    async def __call__(self, arguments: dict[str, Any], *, deadline: Deadline) -> dict[str, Any]:
        deadline.require(0.05, what="knowledge search")
        query = str(arguments.get("query", "")).lower()
        matches: list[dict[str, Any]] = []
        for source_id, texts in self._chunks.items():
            for index, text in enumerate(texts):
                if query and query in text.lower():
                    matches.append({"source_id": source_id, "chunk": index, "text": text[:800]})
                if len(matches) >= 10:
                    return {"matches": matches, "count": len(matches)}
        return {"matches": matches, "count": len(matches)}


BUILTIN_HANDLERS: dict[str, type] = {
    PythonMathHandler.name: PythonMathHandler,
    HttpRequestHandler.name: HttpRequestHandler,
    KnowledgeSearchHandler.name: KnowledgeSearchHandler,
    # Alias so a tool version can select the http handler by kind (`handler="http"`).
    "http_request": HttpRequestHandler,
    # Placeholder until State 10 wires the Docker sandbox.
    "docker": None,  # type: ignore[dict-item]
}


def build_builtin(name: str) -> ToolHandler | None:
    """Instantiate a builtin handler by name, or `None` when the name is unknown."""
    factory = BUILTIN_HANDLERS.get(name)
    return factory() if factory else None
