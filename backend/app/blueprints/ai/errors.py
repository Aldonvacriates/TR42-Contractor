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

# Gemini exceptions live in google.genai.errors. Imported lazily inside
# from_gemini() so the module loads even when google-genai isn't installed.

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

    Special case: Anthropic returns a 400 BadRequest for "credit balance is
    too low to access the Anthropic API" — that's an account-level billing
    issue, NOT bad user input. We map it to AI_SERVICE_ERROR so the resilient
    fallback kicks in and the contractor sees "service unavailable" instead
    of "your request was wrong".
    """
    msg = str(e).lower()
    looks_like_billing = any(s in msg for s in (
        'credit balance', 'billing', 'quota', 'plans & billing', 'insufficient',
    ))

    if isinstance(e, anthropic.RateLimitError):
        return AIError(AI_RATE_LIMITED, 'AI service is rate-limited, try again shortly', 429)
    if isinstance(e, anthropic.AuthenticationError):
        return AIError(AI_CONFIG_MISSING, 'AI service auth failed (check ANTHROPIC_API_KEY)', 503)
    if isinstance(e, anthropic.BadRequestError):
        if looks_like_billing:
            return AIError(
                AI_SERVICE_ERROR,
                'AI service is temporarily unavailable (provider billing/quota)',
                503,
            )
        return AIError(AI_BAD_REQUEST, f'AI service rejected the request: {e}', 400)
    if isinstance(e, anthropic.APIConnectionError):
        return AIError(AI_SERVICE_ERROR, 'Could not reach AI service', 503)
    if isinstance(e, anthropic.APIError):
        # Generic upstream failure. Carry through the status code if we have one.
        status = getattr(e, 'status_code', 503) or 503
        if looks_like_billing:
            return AIError(AI_SERVICE_ERROR, 'AI service is temporarily unavailable (provider billing/quota)', 503)
        return AIError(AI_SERVICE_ERROR, f'AI service error: {e}', status)
    return AIError(AI_INTERNAL, f'Unexpected AI failure: {e}', 500)


def from_gemini(e: Exception) -> AIError:
    """Map a google-genai SDK exception to AIError.

    google.genai.errors.APIError carries an HTTP status code on `.code`
    that we use to pick the right AI_* code. Auth and rate-limit are the
    most common ones we care to surface specifically.
    """
    code   = getattr(e, 'code', None) or getattr(e, 'status_code', None)
    msg    = str(e)
    status = code if isinstance(code, int) and 100 <= code < 600 else 503

    if status in (401, 403):
        return AIError(AI_CONFIG_MISSING, 'AI service auth failed (check GEMINI_API_KEY)', 503)
    if status == 429:
        return AIError(AI_RATE_LIMITED, 'AI service is rate-limited, try again shortly', 429)
    if status == 400:
        return AIError(AI_BAD_REQUEST, f'AI service rejected the request: {msg}', 400)
    if status >= 500 or status == 0:
        return AIError(AI_SERVICE_ERROR, f'AI service error: {msg}', max(status, 503))
    return AIError(AI_SERVICE_ERROR, f'AI service error: {msg}', status)


def _is_gemini_error(e: Exception) -> bool:
    """Cheap check that doesn't require importing google.genai at module load."""
    mod = type(e).__module__ or ''
    return mod.startswith('google.genai') or mod.startswith('google.api_core')


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
            # Gemini errors live in google.genai.errors; sniff the module name
            # to avoid an import-time dependency on google-genai.
            if _is_gemini_error(e):
                return from_gemini(e).to_response()
            log.exception('Unhandled error in AI route %s', fn.__name__)
            return AIError(
                AI_INTERNAL,
                'Server error',
                500,
            ).to_response()
    return wrapped


def require_api_key():
    """Raise AI_CONFIG_MISSING if no AI provider key is configured.

    Selection mirrors providers.get_provider(): checks the active AI_PROVIDER
    (default gemini) and confirms its key is set. Falls back to anthropic if
    GEMINI_API_KEY isn't set but ANTHROPIC_API_KEY is, so a half-configured
    server still serves something instead of failing every request.
    """
    import os
    provider = (os.environ.get('AI_PROVIDER') or 'gemini').lower().strip()
    has_gemini    = bool(os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY'))
    has_anthropic = bool(os.environ.get('ANTHROPIC_API_KEY'))

    if provider == 'gemini'    and has_gemini:    return
    if provider == 'anthropic' and has_anthropic: return
    # Either provider works as a soft fallback when the requested one is missing.
    if has_gemini or has_anthropic:                return

    raise AIError(
        AI_CONFIG_MISSING,
        'AI is not configured on this server (set GEMINI_API_KEY or ANTHROPIC_API_KEY in backend/.env)',
        503,
    )
