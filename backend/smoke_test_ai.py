#!/usr/bin/env python3
"""End-to-end smoke test for the AI endpoints.

Walks every /api/ai/* route plus error paths so a single run tells you
whether the AI surface is healthy.

Pre-conditions
--------------
1. backend/.env is configured for local dev:
     SECRET_KEY=<anything>
     # one of the following (or both for hot-swap):
     GEMINI_API_KEY=...                 # default provider
     ANTHROPIC_API_KEY=sk-ant-...       # fallback provider
     # AI_PROVIDER=gemini                (default; set to anthropic to swap)
   (DATABASE_URL must be commented out so Flask uses local SQLite.)
2. Local DB has been seeded:
     cd backend
     python -c "import flask_app"          # creates SQLite tables
     python seed_dev.py                    # creates aldo / 123456
3. Flask is running on localhost:5000:
     python flask_app.py

Usage
-----
    python smoke_test_ai.py [username] [password]

Defaults to aldo / 123456 (the seed_dev.py credentials).
Override the base URL with SMOKE_TEST_URL env var.

Exits 0 on full pass, non-zero on first hard failure. Soft warnings
(e.g. AI_CONFIG_MISSING when the API key isn't set) are reported but
do not fail the run.
"""
import json
import os
import sys
from typing import Any

import requests

BASE_URL  = os.environ.get('SMOKE_TEST_URL', 'http://localhost:5000').rstrip('/')
USERNAME  = sys.argv[1] if len(sys.argv) > 1 else 'aldo'
PASSWORD  = sys.argv[2] if len(sys.argv) > 2 else '123456'

PASS = 0
FAIL = 0
WARN = 0


def expect(name: str, ok: bool, detail: str = '') -> None:
    global PASS, FAIL
    marker = 'OK' if ok else 'FAIL'
    print(f'  [{marker}] {name}{":  " + detail if detail else ""}')
    if ok:
        PASS += 1
    else:
        FAIL += 1


def warn(name: str, detail: str = '') -> None:
    global WARN
    WARN += 1
    print(f'  [WARN] {name}{":  " + detail if detail else ""}')


def status_and_body(r: requests.Response) -> tuple[int, Any]:
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text


def login() -> str:
    r = requests.post(
        f'{BASE_URL}/auth/login',
        json={'identifier': USERNAME, 'password': PASSWORD},
        timeout=10,
    )
    if r.status_code != 200:
        print(f'login failed: status={r.status_code} body={r.text[:300]}')
        sys.exit(1)
    token = r.json().get('token')
    if not token:
        print(f'login response had no token: {r.json()}')
        sys.exit(1)
    return token


def main() -> None:
    print(f'AI smoke test against {BASE_URL}')
    print(f'  user={USERNAME!r}')
    print()

    token = login()
    H = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    # ── Validation / error handling (no API key needed) ─────────────────────
    print('Validation + error handling')

    s, b = status_and_body(requests.post(
        f'{BASE_URL}/api/ai/inspection-assist',
        headers=H, json={'notes': ''}, timeout=10,
    ))
    expect('inspection-assist empty notes -> 400 AI_BAD_REQUEST',
           s == 400 and isinstance(b, dict) and b.get('code') == 'AI_BAD_REQUEST')

    s, b = status_and_body(requests.post(
        f'{BASE_URL}/api/ai/inspection-assist',
        headers=H, json={}, timeout=10,
    ))
    expect('inspection-assist missing field -> 400 AI_BAD_REQUEST',
           s == 400 and isinstance(b, dict) and b.get('code') == 'AI_BAD_REQUEST')

    s, b = status_and_body(requests.post(
        f'{BASE_URL}/api/ai/chat',
        headers=H, json={'messages': []}, timeout=10,
    ))
    expect('chat empty messages -> 400 AI_BAD_REQUEST',
           s == 400 and isinstance(b, dict) and b.get('code') == 'AI_BAD_REQUEST')

    s, b = status_and_body(requests.post(
        f'{BASE_URL}/api/ai/chat',
        headers=H, json={'messages': [
            {'role': 'user', 'content': 'hi'},
            {'role': 'assistant', 'content': 'hi back'},
        ]}, timeout=10,
    ))
    expect('chat assistant-as-last -> 400 AI_BAD_REQUEST',
           s == 400 and isinstance(b, dict) and b.get('code') == 'AI_BAD_REQUEST')

    s, b = status_and_body(requests.post(
        f'{BASE_URL}/api/ai/analyze-photo',
        headers=H, json={}, timeout=10,
    ))
    expect('analyze-photo missing photo_id -> 400 AI_BAD_REQUEST',
           s == 400 and isinstance(b, dict) and b.get('code') == 'AI_BAD_REQUEST')

    s, b = status_and_body(requests.post(
        f'{BASE_URL}/api/ai/analyze-photo',
        headers=H, json={'photo_id': '00000000-0000-0000-0000-000000000000'}, timeout=10,
    ))
    # AI_NOT_FOUND if API key not set (auth check happens first), AI_NOT_FOUND with key.
    # Either way the response should NOT be a 500.
    expect('analyze-photo unknown id -> 404 AI_NOT_FOUND',
           s == 404 and isinstance(b, dict) and b.get('code') == 'AI_NOT_FOUND')

    s, b = status_and_body(requests.post(
        f'{BASE_URL}/api/ai/refine-report',
        headers=H, json={'feedback': 'higher priority'}, timeout=10,
    ))
    expect('refine-report missing report -> 400 AI_BAD_REQUEST',
           s == 400 and isinstance(b, dict) and b.get('code') == 'AI_BAD_REQUEST')

    print()
    print('Happy path (requires an AI provider key: GEMINI_API_KEY or ANTHROPIC_API_KEY)')

    # ── Happy path: inspection-assist ───────────────────────────────────────
    notes = (
        'Found a leaking valve on rig 3 east side. Oil pooled around the '
        'base, ~2 sq ft. No active fire risk but operator stopped pumping '
        'until cleanup.'
    )
    r = requests.post(
        f'{BASE_URL}/api/ai/inspection-assist',
        headers=H, json={'notes': notes}, timeout=60,
    )
    s, b = status_and_body(r)

    if s == 503 and isinstance(b, dict) and b.get('code') == 'AI_CONFIG_MISSING':
        warn('inspection-assist',
             'no AI provider key configured; skipping all happy-path tests')
        report = None
    elif s == 200 and isinstance(b, dict) and 'title' in b:
        expect('inspection-assist returns structured report',
               all(k in b for k in ('title', 'priority', 'category', 'description', 'recommended_actions')))
        report = b
    else:
        expect('inspection-assist returns structured report', False, f'status={s} body={str(b)[:200]}')
        report = None

    # ── Happy path: refine ──────────────────────────────────────────────────
    if report:
        r = requests.post(
            f'{BASE_URL}/api/ai/refine-report',
            headers=H,
            json={'report': report, 'feedback': 'bump priority to high and mention the operator stopped pumping'},
            timeout=60,
        )
        s, b = status_and_body(r)
        expect('refine-report returns revised report',
               s == 200 and isinstance(b, dict) and b.get('priority') == 'high')

    # ── Happy path: chat ────────────────────────────────────────────────────
    if report is not None or True:  # chat is independent of inspection-assist
        r = requests.post(
            f'{BASE_URL}/api/ai/chat',
            headers=H,
            json={'messages': [
                {'role': 'user', 'content': 'What PPE do I need for high-pressure water hauling?'},
            ]},
            timeout=60,
        )
        s, b = status_and_body(r)
        if s == 503 and isinstance(b, dict) and b.get('code') == 'AI_CONFIG_MISSING':
            warn('chat', 'no AI provider key configured; skipping')
        else:
            expect('chat returns assistant reply',
                   s == 200 and isinstance(b, dict) and b.get('reply'))

    # ── Happy path: save + list reports ─────────────────────────────────────
    if report:
        r = requests.post(
            f'{BASE_URL}/api/ai/save-report',
            headers=H,
            json={**report, 'raw_notes': notes},
            timeout=10,
        )
        s, b = status_and_body(r)
        expect('save-report persists', s == 201 and isinstance(b, dict) and 'id' in b)

        r = requests.get(f'{BASE_URL}/api/ai/reports', headers=H, timeout=10)
        s, b = status_and_body(r)
        expect('list-reports returns saved record',
               s == 200 and isinstance(b, list) and any(rep.get('title') == report['title'] for rep in b))

    print()
    print(f'{PASS} passed, {FAIL} failed, {WARN} warned')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
