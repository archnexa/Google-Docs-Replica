"""Consistent API error envelope.

Every error response has the shape:
    {"error": {"code": "<machine code>", "message": "<human message>", "fields": {...}?}}
Views may add extra top-level keys (e.g. 409 conflicts add "current").
"""

from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

CODES = {
    status.HTTP_400_BAD_REQUEST: "validation",
    status.HTTP_401_UNAUTHORIZED: "unauthenticated",
    status.HTTP_403_FORBIDDEN: "forbidden",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "too_large",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
    status.HTTP_429_TOO_MANY_REQUESTS: "throttled",
}


def error_response(status_code: int, message: str, code: str | None = None, **extra) -> Response:
    body = {"error": {"code": code or CODES.get(status_code, "error"), "message": message}}
    body.update(extra)
    return Response(body, status=status_code)


def _first_message(detail) -> str:
    if isinstance(detail, list) and detail:
        return _first_message(detail[0])
    if isinstance(detail, dict) and detail:
        return _first_message(next(iter(detail.values())))
    return str(detail)


def exception_handler(exc, context):
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    response = drf_exception_handler(exc, context)
    if response is None:
        return None  # unhandled -> Django 500

    detail = getattr(exc, "detail", response.data)
    error = {
        "code": CODES.get(response.status_code, "error"),
        "message": _first_message(detail),
    }
    if isinstance(exc, exceptions.ValidationError) and isinstance(detail, dict):
        error["fields"] = {k: [str(m) for m in (v if isinstance(v, list) else [v])] for k, v in detail.items()}
        error["message"] = _first_message(detail)
    if isinstance(exc, exceptions.NotAuthenticated) or isinstance(exc, exceptions.AuthenticationFailed):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        error["code"] = "unauthenticated"
    response.data = {"error": error}
    return response
