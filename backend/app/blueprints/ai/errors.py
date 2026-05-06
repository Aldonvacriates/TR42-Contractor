"""Structured error handling for the AI blueprint.

Every error from an AI route should land here so the frontend gets a
consistent shape:

    { "error": "human readable message", "code": "MACHINE_CODE" }

Codes are stable strings the mobile app can switch on. Status codes follow
HTTP semantics. Wrap your route in @handle_ai_errors and either let the
helper map exceptions for you or raise AIError directly with a specific
code.
"""
import functools
import json
import logging
from typing import Optional

import anthropic
from flask import jsonify
from marshmallow import ValidationError

log = logging.getLogger(__name__)


# ── Error codes ──────────────────────────────────────────────────────────────
# Keep this list short and meaningful. Frontend can branch on these to show
# specific UX (e.g. retry, upgrade, log in).

AI_BAD_REQUEST       = 'AI_BAD_REQUEST'        # client sent invalid input
AI_EMPTY_INPUT       = 'AI_EMPTY_INPUT'        # input was technically valid but empty
AI_RATE_LIMITED      = 'AI_RATE_LIMITED'       # upstream said slow down
AI_SERVICE_ERROR     = 'AI_SERVICE_ERROR'      # upstream Claude API failed
AI_BAD_RESPONSE      = 'AI_BAD_RESPONSE'       # upstream returned malformed JSON
AI_UNAUTHORIZED      = 'AI_UNAUTHORIZED'       # caller lacks access to the resource
AI_NOT_FOUND         = 'AI_NOT_FOUND'          # referenced resource doesn't exist
AI_CONFIG_MISSING    = 'AI_CONFIG_MISSING'     # ANTHROPIC_API_KEY not set, etc.
AI_INTERNAL          = 'AI_INTERNAL'           # generic catch-all


class AIError(Exception):
    """Anything an AI route can fail on, with a stable code for the client."""

    def __init__(self, code: str, message: str, status: int = 500):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    def to_response(self):
        return jsonify({'error': self.message, 'code': self.code}), self.status


def from_anthropic(e: Exception) -> AIError:
    """Map an anthropic SDK exception to our AIError shape.

    Anthropic raises a hierarchy under anthropic.APIError. We pick out the
    common ones and fall back to AI_SERVICE_ERROR for the rest. Status codes
    are taken from the upstream response when available.
    """
    if isinstance(e, anthropic.RateLimitError):
        return AIError(AI_RATE_LIMITED, 'AI service is rate-limited, try again shortly', 429)
    if isinstance(e, anthropic.AuthenticationError):
        return AIError(AI_CONFIG_MISSING, 'AI service auth failed (check ANTHROPIC_API_KEY)', 503)
    if isinstance(e, anthropic.BadRequestError):
        return AIError(AI_BAD_REQUEST, f'AI service rejected the request: {e}', 400)
    if isinstance(e, anthropic.APIConnectionError):
        return AIError(AI_SERVICE_ERROR, 'Could not reach AI service', 503)
    if isinstance(e, anthropic.APIError):
        # Generic upstream failure. Carry through the status code if we have one.
        status = getattr(e, 'status_code', 503) or 503
        return AIError(AI_SERVICE_ERROR, f'AI service error: {e}', status)
    return AIError(AI_INTERNAL, f'Unexpected AI failure: {e}', 500)


def from_validation(e: ValidationError) -> AIError:
    """Map a Marshmallow ValidationError to AIError."""
    # Marshmallow gives us a dict; flatten the first message for the user-facing
    # string while still letting us keep the code stable.
    first = next(iter(e.messages.values())) if e.messages else 'invalid input'
    if isinstance(first, list):
        first = first[0] if first else 'invalid input'
    return AIError(AI_BAD_REQUEST, f'Invalid request: {first}', 400)


def handle_ai_errors(fn):
    """Route decorator. Catches AIError, anthropic errors, ValidationError and
    JSONDecodeError, and returns a consistent JSON shape. Anything else is
    logged and surfaced as AI_INTERNAL so we never leak a stacktrace.
    """
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except AIError as e:
            return e.to_response()
        except ValidationError as e:
            return from_validation(e).to_response()
        except json.JSONDecodeError as e:
            log.warning('AI returned non-JSON response: %s', e)
            return AIError(
                AI_BAD_RESPONSE,
                'AI returned an unexpected response format',
                502,
            ).to_response()
        except anthropic.APIError as e:
            return from_anthropic(e).to_response()
        except Exception as e:
            log.exception('Unhandled error in AI route %s', fn.__name__)
            return AIError(
                AI_INTERNAL,
                'Server error',
                500,
            ).to_response()
    return wrapped


def require_api_key():
    """Raise AI_CONFIG_MISSING if ANTHROPIC_API_KEY isn't set.

    Cheap way to give the frontend a clear error instead of a confusing 401
    from anthropic later. Call this at the top of any route that hits Claude.
    """
    import os
    if not os.environ.get('ANTHROPIC_API_KEY'):
        raise AIError(
            AI_CONFIG_MISSING,
            'AI is not configured on this server (missing ANTHROPIC_API_KEY)',
            503,
        )
