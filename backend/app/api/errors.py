"""Typed API error envelope and exception handlers.

The frontend has no error surfaces today, so the backend defines stable `code` values that a future
data layer can branch on without string-matching messages.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain.failures import AgentError, ValidationFailure
from app.infrastructure.logging_config import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class ErrorCode:
    VALIDATION_ERROR = "validation_error"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    RATE_LIMITED = "rate_limited"
    INTERNAL_ERROR = "internal_error"
    AGENT_FAILURE = "agent_failure"
    NOT_READY = "not_ready"


class ApiError(Exception):
    """Raised by application code for expected, client-visible failures."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}
        self.headers = headers or {}


class NotFoundError(ApiError):
    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(
            404,
            ErrorCode.NOT_FOUND,
            f"{resource} {resource_id!r} was not found",
            details={"resource": resource, "id": resource_id},
        )


class ConflictError(ApiError):
    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(409, ErrorCode.CONFLICT, message, details=details)


class UnauthorizedError(ApiError):
    def __init__(self, message: str = "authentication required") -> None:
        super().__init__(
            401,
            ErrorCode.UNAUTHORIZED,
            message,
            headers={"WWW-Authenticate": "Bearer"},
        )


class ForbiddenError(ApiError):
    def __init__(self, message: str = "operation not permitted") -> None:
        super().__init__(403, ErrorCode.FORBIDDEN, message)


class AuthenticationRequired(Exception):
    """The bearer token is missing, malformed, expired or otherwise unusable.

    Deliberately a single exception for every failure mode: the client must not learn *why* a token
    stopped working (expired vs. revoked vs. wrong workspace). Raised by the auth dependency and
    rendered here.
    """


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
                "request_id": getattr(request.state, "request_id", None),
            }
        },
        headers=headers or None,
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return _error_response(
            request,
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            details=exc.details,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error_response(
            request,
            status_code=422,
            code=ErrorCode.VALIDATION_ERROR,
            message="request validation failed",
            details={"errors": json.loads(json.dumps(exc.errors(), default=str))},
        )

    @app.exception_handler(AgentError)
    async def _agent_error(request: Request, exc: AgentError) -> JSONResponse:
        """A classified failure escaping a use case.

        A `ValidationFailure` here came from an invariant, i.e. bad client input, so it is a 422.
        Every other kind is a genuine server-side or agent-side fault and stays a 500 carrying the
        full classification (Rule 19/20) rather than a bare error.
        """
        client_fault = isinstance(exc, ValidationFailure)
        return _error_response(
            request,
            status_code=422 if client_fault else 500,
            code=ErrorCode.VALIDATION_ERROR if client_fault else ErrorCode.AGENT_FAILURE,
            message=exc.message,
            details=exc.to_dict(),
        )

    @app.exception_handler(PydanticValidationError)
    async def _domain_validation(request: Request, exc: PydanticValidationError) -> JSONResponse:
        """A domain invariant violated inside a use case.

        The domain models raise `ValueError` (pydantic turns it into `ValidationError`) for things the
        request schema cannot know — an agent bot with a deterministic provider, an http tool with no
        network permission. Those are client input problems, so they are 422s, not 500s.
        """
        return _error_response(
            request,
            status_code=422,
            code=ErrorCode.VALIDATION_ERROR,
            message="the request does not satisfy the domain invariants",
            details={"errors": json.loads(json.dumps(exc.errors(include_url=False), default=str))},
        )

    @app.exception_handler(AuthenticationRequired)
    async def _auth_required(request: Request, exc: AuthenticationRequired) -> JSONResponse:
        """Every auth failure — missing, malformed, expired, revoked — is one 401 envelope.

        The dependency layer raises a single exception on purpose: the client must not be able to
        distinguish "your token expired" from "your token is for a workspace you left", and the log
        keeps the detail.
        """
        logger.info("authentication rejected", extra={"reason": str(exc)})
        return _error_response(
            request,
            status_code=401,
            code=ErrorCode.UNAUTHORIZED,
            message=str(exc) or "authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {
            401: ErrorCode.UNAUTHORIZED,
            403: ErrorCode.FORBIDDEN,
            404: ErrorCode.NOT_FOUND,
            409: ErrorCode.CONFLICT,
            429: ErrorCode.RATE_LIMITED,
        }.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
        return _error_response(
            request,
            status_code=exc.status_code,
            code=code,
            message=str(exc.detail),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error", exc_info=exc)
        return _error_response(
            request,
            status_code=500,
            code=ErrorCode.INTERNAL_ERROR,
            message="internal server error",
        )
