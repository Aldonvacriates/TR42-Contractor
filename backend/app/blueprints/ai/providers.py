"""AI provider abstraction.

Why this exists
---------------
The contractor app needs to call an LLM for chat, structured inspection
reports, refine, and image analysis. We want to be able to swap providers
(Gemini, Anthropic, eventually an on-device Llama) without rewriting routes.

Selection
---------
- AI_PROVIDER env var picks the active provider. Default is `gemini`.
- If the requested provider's API key isn't set, we raise AI_CONFIG_MISSING
  via require_api_key()/get_provider().
- Supported values: 'gemini' | 'anthropic'. Anything else raises
  AI_CONFIG_MISSING with a clear error.

Interface
---------
Every provider exposes the same three methods:
    generate(messages, system) -> str
        One-shot text response.
    stream(messages, system) -> Iterator[str]
        Yields text chunks as they arrive.
    generate_with_image(messages, system, image_bytes, mime_type) -> str
        One-shot vision call. Image is sent inline (base64 / bytes) so the
        provider doesn't need a public URL.

`messages` is the OpenAI-style list of {role, content} dicts where role is
'user' or 'assistant'. `system` is a single system prompt string. We hide
the per-provider quirks (Anthropic wants system as a top-level arg, Gemini
folds it into the conversation) inside each implementation.

Adding a new provider
---------------------
Subclass AIProvider, implement the three methods, and register it in
_PROVIDER_FACTORIES below. The routes.py code never has to change.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import Iterator, List, Optional

log = logging.getLogger(__name__)


# Default model per provider. Kept here so changing models is one line.
DEFAULT_GEMINI_MODEL    = 'gemini-2.5-flash'
DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'


# OpenAI-style message shape used across the codebase.
Message = dict  # {'role': 'user' | 'assistant', 'content': str}


class AIProvider(ABC):
    """One LLM-backed text/vision provider. Stateless."""

    name: str = 'unknown'

    @abstractmethod
    def generate(
        self,
        messages: List[Message],
        system:   str,
        max_tokens: int = 1024,
    ) -> str:
        """One-shot text generation. Returns the assistant's full reply."""

    @abstractmethod
    def stream(
        self,
        messages: List[Message],
        system:   str,
        max_tokens: int = 1024,
    ) -> Iterator[str]:
        """Streaming text generation. Yields text chunks."""

    @abstractmethod
    def generate_with_image(
        self,
        messages:   List[Message],
        system:     str,
        image_bytes: bytes,
        mime_type:  str = 'image/jpeg',
        max_tokens: int = 1024,
    ) -> str:
        """Vision call. The image is appended to the LAST user message."""


# ── Gemini ───────────────────────────────────────────────────────────────────

class GeminiProvider(AIProvider):
    """Google Gemini via the google-genai SDK.

    Notes on shape mapping:
    - Gemini doesn't have a separate 'system' role in the conversation. We
      pass the system prompt via the model's `config.system_instruction`.
    - 'role' values map: 'user' -> 'user', 'assistant' -> 'model'.
    - Image input uses inline base64 via types.Part.from_bytes().
    - JSON-only responses: Gemini sometimes wraps JSON in ``` fences. We
      strip those server-side in routes.py so callers always get clean JSON.
    """

    name = 'gemini'

    def __init__(self, api_key: str, model: str = DEFAULT_GEMINI_MODEL):
        # Lazy-import the SDK so the module loads even on machines without
        # google-genai installed (until they actually call the provider).
        from google import genai
        self._genai  = genai
        self._client = genai.Client(api_key=api_key)
        self._model  = model

    def _to_gemini_contents(self, messages: List[Message]):
        """Convert OpenAI-style messages to Gemini's contents list."""
        from google.genai import types
        out = []
        for m in messages:
            role = 'model' if m['role'] == 'assistant' else 'user'
            out.append(types.Content(
                role=role,
                parts=[types.Part(text=m['content'])],
            ))
        return out

    def _config(self, system: str, max_tokens: int):
        from google.genai import types
        return types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=0.7,
        )

    def generate(self, messages, system, max_tokens=1024):
        response = self._client.models.generate_content(
            model=self._model,
            contents=self._to_gemini_contents(messages),
            config=self._config(system, max_tokens),
        )
        return response.text or ''

    def stream(self, messages, system, max_tokens=1024):
        stream = self._client.models.generate_content_stream(
            model=self._model,
            contents=self._to_gemini_contents(messages),
            config=self._config(system, max_tokens),
        )
        for chunk in stream:
            text = getattr(chunk, 'text', None)
            if text:
                yield text

    def generate_with_image(self, messages, system, image_bytes, mime_type='image/jpeg', max_tokens=1024):
        from google.genai import types
        if not messages:
            messages = [{'role': 'user', 'content': 'Describe what you see.'}]
        # Build the contents list, then append the image to the LAST user turn
        # as an extra Part. Anything else (e.g. attaching to a model turn)
        # confuses the model.
        contents = self._to_gemini_contents(messages)
        if not contents:
            contents.append(types.Content(role='user', parts=[types.Part(text='Describe what you see.')]))
        last = contents[-1]
        if last.role != 'user':
            contents.append(types.Content(role='user', parts=[]))
            last = contents[-1]
        last.parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
        response = self._client.models.generate_content(
            model=self._model,
            contents=contents,
            config=self._config(system, max_tokens),
        )
        return response.text or ''


# ── Anthropic ────────────────────────────────────────────────────────────────

class AnthropicProvider(AIProvider):
    """Anthropic Claude via the anthropic SDK.

    Kept as the fallback so we can flip AI_PROVIDER=anthropic if Gemini
    misbehaves during a demo. Same interface as GeminiProvider so routes.py
    is provider-agnostic.
    """

    name = 'anthropic'

    def __init__(self, api_key: str, model: str = DEFAULT_ANTHROPIC_MODEL):
        import anthropic
        self._anthropic = anthropic
        self._client    = anthropic.Anthropic(api_key=api_key)
        self._model     = model

    def _system_block(self, system: str):
        return [{
            'type': 'text',
            'text': system,
            'cache_control': {'type': 'ephemeral'},
        }]

    def generate(self, messages, system, max_tokens=1024):
        response = self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            system=self._system_block(system),
            messages=messages,
        )
        return next((b.text for b in response.content if b.type == 'text'), '')

    def stream(self, messages, system, max_tokens=1024):
        with self._client.messages.stream(
            model=self._model,
            max_tokens=max_tokens,
            system=self._system_block(system),
            messages=messages,
        ) as s:
            for chunk in s.text_stream:
                yield chunk

    def generate_with_image(self, messages, system, image_bytes, mime_type='image/jpeg', max_tokens=1024):
        import base64
        encoded = base64.standard_b64encode(image_bytes).decode('ascii')
        if not messages:
            messages = [{'role': 'user', 'content': 'Describe what you see.'}]
        # Convert the LAST user message into a multipart content array
        # containing the image + the original text.
        msgs = list(messages)
        last = msgs[-1]
        text = last.get('content', '') if isinstance(last, dict) else ''
        msgs[-1] = {
            'role': 'user',
            'content': [
                {
                    'type': 'image',
                    'source': {
                        'type': 'base64',
                        'media_type': mime_type,
                        'data': encoded,
                    },
                },
                {'type': 'text', 'text': text or 'Describe what you see.'},
            ],
        }
        response = self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            system=self._system_block(system),
            messages=msgs,
        )
        return next((b.text for b in response.content if b.type == 'text'), '')


# ── Selection ────────────────────────────────────────────────────────────────

# Maps provider name -> factory. Factories take no args; they read env vars
# and raise AIError(AI_CONFIG_MISSING) if the relevant key isn't set.
_PROVIDER_FACTORIES = {}

def _make_gemini():
    key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if not key:
        from .errors import AIError, AI_CONFIG_MISSING
        raise AIError(
            AI_CONFIG_MISSING,
            'AI is not configured (set GEMINI_API_KEY in backend/.env)',
            503,
        )
    model = os.environ.get('GEMINI_MODEL', DEFAULT_GEMINI_MODEL)
    return GeminiProvider(api_key=key, model=model)


def _make_anthropic():
    key = os.environ.get('ANTHROPIC_API_KEY')
    if not key:
        from .errors import AIError, AI_CONFIG_MISSING
        raise AIError(
            AI_CONFIG_MISSING,
            'AI is not configured (set ANTHROPIC_API_KEY in backend/.env)',
            503,
        )
    model = os.environ.get('ANTHROPIC_MODEL', DEFAULT_ANTHROPIC_MODEL)
    return AnthropicProvider(api_key=key, model=model)


_PROVIDER_FACTORIES['gemini']    = _make_gemini
_PROVIDER_FACTORIES['anthropic'] = _make_anthropic


# Provider instances are cached per-process so we don't re-init the client on
# every request. Keyed by provider name.
_provider_cache: dict = {}


def get_provider(override: Optional[str] = None) -> AIProvider:
    """Return the active AIProvider.

    Selection order:
        1. `override` arg if passed (lets routes pin a specific provider per
           request, e.g. always-Anthropic for vision).
        2. AI_PROVIDER env var.
        3. Default 'gemini'.

    Raises AIError(AI_CONFIG_MISSING) if the requested provider isn't
    supported or its API key isn't configured.
    """
    name = (override or os.environ.get('AI_PROVIDER') or 'gemini').lower().strip()
    if name not in _PROVIDER_FACTORIES:
        from .errors import AIError, AI_CONFIG_MISSING
        raise AIError(
            AI_CONFIG_MISSING,
            f"Unknown AI_PROVIDER {name!r} (expected one of: {', '.join(_PROVIDER_FACTORIES)})",
            503,
        )
    if name not in _provider_cache:
        _provider_cache[name] = _PROVIDER_FACTORIES[name]()
        log.info('AI provider initialized: %s', name)
    return _provider_cache[name]


def reset_provider_cache() -> None:
    """Test helper. Drops all cached provider instances so re-init picks up
    new env vars."""
    _provider_cache.clear()
