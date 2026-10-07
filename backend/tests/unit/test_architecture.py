"""State 13 — dependency-direction guards (Rule 38).

These are executable architecture rules, not documentation. They fail the build when a layer starts
depending on something it must not, which is the only way the boundary stays real over time.
"""

from __future__ import annotations

import ast
from pathlib import Path

from app.application.ports import BuildStarter, KnowledgeStarter, RunStarter
from app.infrastructure.temporal.build_starter import TemporalBuildStarter
from app.infrastructure.temporal.knowledge_starter import TemporalKnowledgeStarter
from app.infrastructure.temporal.starter import TemporalRunStarter

APP = Path(__file__).resolve().parents[2] / "app"

FORBIDDEN_IN_DOMAIN = {
    "fastapi",
    "sqlalchemy",
    "temporalio",
    "app.infrastructure",
    "app.api",
    "app.application",
}
FORBIDDEN_IN_APPLICATION = {"fastapi", "sqlalchemy", "temporalio"}
FORBIDDEN_IN_ROUTES = {"sqlalchemy", "temporalio"}


def _modules(package: str):
    return sorted((APP / package).rglob("*.py"))


def _imports(path: Path) -> set[str]:
    """Every module name this file imports, absolute and relative-resolved to `app.*`."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                continue  # relative import inside the same package is always allowed
            if node.module:
                names.add(node.module)
                names.update(f"{node.module}.{alias.name}" for alias in node.names)
    return names


def _violations(package: str, forbidden: set[str]) -> list[str]:
    found: list[str] = []
    for module in _modules(package):
        for name in _imports(module):
            if any(name == bad or name.startswith(f"{bad}.") for bad in forbidden):
                found.append(f"{module.relative_to(APP)} imports {name}")
    return found


def test_domain_depends_on_nothing_outer() -> None:
    """The domain is pure: no web framework, no database, no workflow engine, no outer layer."""
    assert _violations("domain", FORBIDDEN_IN_DOMAIN) == []


def test_application_does_not_import_infrastructure_frameworks() -> None:
    """Use cases are framework-free; infrastructure is reached through ports."""
    assert _violations("application", FORBIDDEN_IN_APPLICATION) == []


def test_routes_do_not_touch_the_database_or_temporal() -> None:
    """Routes parse, call a use case and serialise. Wiring lives in `deps.py`."""
    assert _violations("api/routes", FORBIDDEN_IN_ROUTES) == []


def test_infrastructure_adapters_satisfy_their_ports() -> None:
    """Liskov/Interface Segregation: the real adapters are substitutable for the ports they implement."""
    assert isinstance(TemporalRunStarter(object(), task_queue="q"), RunStarter)
    assert isinstance(TemporalBuildStarter(object(), task_queue="q"), BuildStarter)
    assert isinstance(TemporalKnowledgeStarter(object(), task_queue="q"), KnowledgeStarter)
