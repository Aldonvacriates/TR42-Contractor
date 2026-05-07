"""AI endpoints for the contractor app.

All routes use @handle_ai_errors so the response shape is consistent:
    success: regular JSON or text/event-stream
    failure: { "error": "...", "code": "AI_*" }

Provider routing
----------------
The active LLM provider is picked by the AI_PROVIDER env var (default: gemini).
Anthropic stays available as an instant fallback if Gemini misbehaves; just
flip the env var and redeploy. See providers.py for selection logic.

Routes
------
    POST   /api/ai/inspection-assist         one-shot structured report
    POST   /api/ai/inspection-assist/stream  streamed via SSE
    POST   /api/ai/refine-report             revise a report given feedback
    POST   /api/ai/analyze-photo             vision against a ticket photo
    POST   /api/ai/chat                      stateless chat assistant
    POST   /api/ai/save-report               persist a report to local DB
    GET    /api/ai/reports                   list saved reports for the caller
"""
import json
import logging
import re
from datetime import datetime, timezone

from flask import Response, jsonify, request, stream_with_context
from sqlalchemy.exc import SQLAlchemyError

from app.models import AiChatSession, AiInspectionReports, Contractor, Ticket, TicketPhoto, db


def _utcnow() -> datetime:
    """Aware UTC timestamp. Mirrors models._utcnow without coupling to it."""
    return datetime.now(timezone.utc)
from app.util.auth import token_required

from . import ai_bp
from .errors import (
    AI_BAD_REQUEST,
    AI_BAD_RESPONSE,
    AI_INTERNAL,
    AI_NOT_FOUND,
    AI_UNAUTHORIZED,
    AIError,
    handle_ai_errors,
)
from .providers import get_provider, resilient_call
from .schemas import (
    ai_chat_session_schema,
    ai_chat_sessions_schema,
    ai_report_schema,
    ai_reports_schema,
    chat_schema,
    inspection_assist_schema,
    refine_report_schema,
    save_chat_schema,
    save_report_schema,
)

log = logging.getLogger(__name__)


# ── Prompts ──────────────────────────────────────────────────────────────────
# All system prompts go through the provider's caching mechanism (Anthropic's
# cache_control, Gemini's auto cache). Same prompts work across providers.

_INSPECTION_PROMPT = """You are an AI assistant for field contractors.
Convert raw contractor field notes into a structured inspection report.
Respond with ONLY valid JSON using exactly these fields:
- title: short descriptive title (string)
- priority: one of "low", "medium", or "high" (string)
- category: e.g. "Electrical", "Plumbing", "HVAC", "Structural", "Safety" (string)
- description: clear professional description of the issue (string)
- recommended_actions: specific action items to address the issue (array of strings)

Do not include any text outside the JSON object. Do not wrap the JSON in
markdown code fences."""


_REFINE_PROMPT = """You are revising an existing inspection report based on
contractor feedback. Keep the same JSON shape:
- title (string)
- priority ("low" | "medium" | "high")
- category (string)
- description (string)
- recommended_actions (array of strings)

Apply the contractor's feedback faithfully. Do not invent facts that aren't
in the original report or the feedback. Respond with ONLY the revised JSON
object and nothing else. Do not wrap the JSON in markdown code fences."""


_PHOTO_PROMPT = """You are a job-site safety inspector reviewing a contractor's
photo. Identify any visible safety concerns, OSHA violations, code issues, or
quality problems. Be specific. If the photo looks safe and compliant, say so.

Respond with ONLY valid JSON using exactly these fields:
- summary: one-sentence overall assessment (string)
- severity: "none", "low", "medium", or "high" (string)
- concerns: list of specific issues found (array of strings, empty if none)
- recommendations: specific actions to address the concerns (array of strings, empty if none)

Do not include any text outside the JSON object. Do not wrap the JSON in
markdown code fences."""


_CHAT_PROMPT = """You are an AI assistant for oil-services field contractors
using a mobile app. Help with: questions about work orders and tickets,
procedures, safety guidance, OSHA references, troubleshooting equipment
issues, and clarifying paperwork. Be concise. If a question needs specific
data the contractor would have access to in the app, point them to the
right screen instead of guessing. If asked anything outside this scope,
say you focus on field-work topics."""


# ── Helpers ──────────────────────────────────────────────────────────────────

# Some providers (Gemini especially) sometimes wrap JSON in ``` fences even
# when told not to. Strip them defensively so callers always get clean JSON.
_FENCE_RE = re.compile(r'^\s*```(?:json)?\s*|\s*```\s*$', re.IGNORECASE)

def _strip_fences(text: str) -> str:
    """Remove leading/trailing ``` or ```json fences, if any."""
    if not text:
        return text
    out = _FENCE_RE.sub('', text.strip())
    return out.strip()


def _parse_json_strict(text: str):
    """Parse JSON, surfacing AI_BAD_RESPONSE if the upstream gave us garbage."""
    cleaned = _strip_fences(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        # Salvage path: Gemini sometimes truncates mid-response (especially
        # via the OpenAI-compat endpoint when the upstream connection chunks
        # oddly), so we end up with a near-valid but unclosed JSON object.
        # Try to extract whatever string fields and arrays the model emitted
        # before we give up. Better to render a partial, honest analysis
        # than a hard error.
        salvaged = _salvage_partial_json(cleaned)
        if salvaged is not None:
            log.info(
                'AI JSON was truncated; salvaged fields=%s | err=%s',
                list(salvaged.keys()), e,
            )
            return salvaged

        log.warning('AI returned non-JSON response: %s | text=%r', e, cleaned[:200])
        raise AIError(
            AI_BAD_RESPONSE,
            'AI returned an unexpected response format',
            502,
        )


# Field-by-field rescue for truncated photo-analysis responses. We pull the
# "summary"/"severity" strings and the "concerns"/"recommendations" arrays
# in whatever order they appear, ignoring the missing closing `}`. Anything
# we can't recover gets a sensible default so the frontend always renders
# something rather than a hard error during a demo.
_JSON_STRING_FIELD_RE = re.compile(
    r'"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"',
    re.DOTALL,
)
_JSON_ARRAY_FIELD_RE = re.compile(
    r'"(\w+)"\s*:\s*\[([^\]]*)\]',
    re.DOTALL,
)
_VALID_SEVERITIES = {'none', 'low', 'medium', 'high'}

def _salvage_partial_json(text: str):
    """Best-effort recovery from a truncated photo-analysis response.

    Returns a dict shaped like the PhotoAnalysis schema (summary, severity,
    concerns[], recommendations[]) or None if the text doesn't even look
    like an analysis attempt — in which case the caller still raises
    AI_BAD_RESPONSE.
    """
    if not text or '{' not in text:
        return None

    strings = {m.group(1): m.group(2) for m in _JSON_STRING_FIELD_RE.finditer(text)}
    if 'summary' not in strings and 'severity' not in strings:
        # Doesn't contain even the leading fields — give up.
        return None

    summary = strings.get('summary', '').strip()
    severity_raw = strings.get('severity', '').strip().lower()
    severity = severity_raw if severity_raw in _VALID_SEVERITIES else 'none'

    def _items_from_array(field: str):
        for m in _JSON_ARRAY_FIELD_RE.finditer(text):
            if m.group(1) != field:
                continue
            inner = m.group(2)
            return [
                s.group(1).strip()
                for s in re.finditer(r'"((?:[^"\\]|\\.)*)"', inner)
                if s.group(1).strip()
            ]
        return []

    return {
        'summary':         summary or 'Partial analysis received from the AI; details below may be incomplete.',
        'severity':        severity,
        'concerns':        _items_from_array('concerns'),
        'recommendations': _items_from_array('recommendations'),
    }


def _resolve_contractor():
    """Fetch the Contractor row for the JWT subject. Raises AIError if missing."""
    contractor = (
        db.session.query(Contractor)
        .filter(Contractor.user_id == request.user_id)
        .first()
    )
    if not contractor:
        raise AIError(
            AI_UNAUTHORIZED,
            'No contractor record associated with this account',
            403,
        )
    return contractor


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/inspection-assist
# Converts raw contractor field notes into a structured report.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/inspection-assist', methods=['POST'])
@token_required
@handle_ai_errors
def inspection_assist():
    data = inspection_assist_schema.load(request.get_json() or {})
    notes = data['notes'].strip()
    if not notes:
        raise AIError(AI_BAD_REQUEST, 'notes cannot be empty', 400)

    text = resilient_call(lambda p: p.generate(
        messages=[{
            'role': 'user',
            'content': f'Convert these field notes into a structured report:\n\n{notes}',
        }],
        system=_INSPECTION_PROMPT,
        max_tokens=1024,
    ))
    return jsonify(_parse_json_strict(text)), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/inspection-assist/stream
# Same as above but streams the response as Server Sent Events.
#
# Stream protocol:
#   data: <chunk>\n\n        ...repeated as Claude/Gemini emits text...
#   event: done\ndata: {}\n\n     terminator
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/inspection-assist/stream', methods=['POST'])
@token_required
@handle_ai_errors
def inspection_assist_stream():
    data = inspection_assist_schema.load(request.get_json() or {})
    notes = data['notes'].strip()
    if not notes:
        raise AIError(AI_BAD_REQUEST, 'notes cannot be empty', 400)

    provider = get_provider()  # raise here if not configured, before opening the stream

    @stream_with_context
    def generate():
        try:
            for chunk in provider.stream(
                messages=[{
                    'role': 'user',
                    'content': f'Convert these field notes into a structured report:\n\n{notes}',
                }],
                system=_INSPECTION_PROMPT,
                max_tokens=1024,
            ):
                # JSON-encode the chunk so newlines/quotes don't break SSE framing.
                yield f'data: {json.dumps({"chunk": chunk})}\n\n'
            yield 'event: done\ndata: {}\n\n'
        except Exception as e:
            log.exception('Stream failed')
            yield f'event: error\ndata: {json.dumps({"error": str(e)})}\n\n'

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control':     'no-cache',
            'X-Accel-Buffering': 'no',  # disable nginx buffering if proxied
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/refine-report
# Take an existing structured report + user feedback, return a revised report.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/refine-report', methods=['POST'])
@token_required
@handle_ai_errors
def refine_report():
    data = refine_report_schema.load(request.get_json() or {})
    feedback = data['feedback'].strip()
    if not feedback:
        raise AIError(AI_BAD_REQUEST, 'feedback cannot be empty', 400)

    user_message = (
        f'Original report:\n{json.dumps(data["report"], indent=2)}\n\n'
        f'Contractor feedback:\n{feedback}\n\n'
        f'Apply the feedback and return the revised JSON.'
    )

    text = resilient_call(lambda p: p.generate(
        messages=[{'role': 'user', 'content': user_message}],
        system=_REFINE_PROMPT,
        max_tokens=1024,
    ))
    return jsonify(_parse_json_strict(text)), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/analyze-photo
# Run vision against a ticket photo the caller is allowed to see.
# Body: { "photo_id": "<uuid>" }
# Bytes already live in ticket_photo.photo_content (bytea), no extra round-trips.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/analyze-photo', methods=['POST'])
@token_required
@handle_ai_errors
def analyze_photo():
    body = request.get_json() or {}
    photo_id = (body.get('photo_id') or '').strip()
    if not photo_id:
        raise AIError(AI_BAD_REQUEST, 'photo_id is required', 400)

    contractor = _resolve_contractor()

    # Authorisation: the contractor must be assigned to the photo's parent
    # ticket. Same join pattern as the photos blueprint.
    photo = (
        db.session.query(TicketPhoto)
        .join(Ticket, TicketPhoto.ticket_id == Ticket.id)
        .filter(
            TicketPhoto.id == photo_id,
            Ticket.assigned_contractor == contractor.id,
        )
        .first()
    )
    if not photo:
        # 404 on miss OR auth failure so we don't leak whether the photo exists.
        raise AIError(AI_NOT_FOUND, 'photo not found', 404)
    if not photo.photo_content:
        raise AIError(AI_BAD_REQUEST, 'photo has no content stored', 400)

    # If we already analyzed this photo and the caller didn't ask for a
    # fresh take, return the cached result. Saves Gemini quota and lets
    # the vendor/client review flow show the same answer the contractor
    # saw at capture time.
    force_refresh = bool(body.get('refresh'))
    if photo.ai_analysis and not force_refresh:
        return jsonify(photo.ai_analysis), 200

    # 2048 tokens gives Gemini comfortable headroom to finish the JSON
    # without mid-stream truncation. The prompt + structured schema fit
    # well under that ceiling for any realistic photo analysis.
    text = resilient_call(lambda p: p.generate_with_image(
        messages=[{'role': 'user', 'content': 'Analyze this job-site photo.'}],
        system=_PHOTO_PROMPT,
        image_bytes=photo.photo_content,
        mime_type='image/jpeg',
        max_tokens=2048,
    ))
    analysis = _parse_json_strict(text)

    # Persist the structured result on the photo row so it survives
    # across sessions and is visible to the vendor/client review flow.
    try:
        photo.ai_analysis    = analysis
        photo.ai_analyzed_at = _utcnow()

        # Auto-flag the parent ticket on a HIGH-severity photo. Closes
        # Cory's "AI catches a problem" loop — the dashboard's anomaly
        # count surfaces it without manual escalation. Don't clobber an
        # anomaly_reason set by another path (e.g. drive-time excursion);
        # only fill it if empty.
        if (analysis.get('severity') or '').lower() == 'high':
            ticket = db.session.query(Ticket).filter(Ticket.id == photo.ticket_id).first()
            if ticket is not None:
                ticket.anomaly_flag = True
                if not (ticket.anomaly_reason or '').strip():
                    summary = (analysis.get('summary') or '').strip()
                    ticket.anomaly_reason = (
                        f'AI photo review (HIGH severity): {summary[:240]}'
                        if summary else 'AI photo review flagged HIGH severity'
                    )

        db.session.commit()
    except Exception:
        # Persistence is non-fatal — the contractor still gets the
        # analysis even if the save fails. Log and roll back so the
        # session is clean for the next request.
        log.exception('Failed to persist photo analysis for photo_id=%s', photo_id)
        db.session.rollback()

    return jsonify(analysis), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/chat
# Stateless chat assistant. Frontend keeps the conversation history.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/chat', methods=['POST'])
@token_required
@handle_ai_errors
def chat():
    data = chat_schema.load(request.get_json() or {})
    messages = data['messages']
    if not messages:
        raise AIError(AI_BAD_REQUEST, 'messages cannot be empty', 400)
    if messages[-1]['role'] != 'user':
        raise AIError(AI_BAD_REQUEST, 'last message must be from the user', 400)

    reply = resilient_call(lambda p: p.generate(
        messages=messages,
        system=_CHAT_PROMPT,
        max_tokens=1024,
    ))
    return jsonify({'reply': reply}), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/save-report
# Persists an AI-generated report to the local DB.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/save-report', methods=['POST'])
@token_required
@handle_ai_errors
def save_report():
    data = save_report_schema.load(request.get_json() or {})

    report = AiInspectionReports(
        contractor_id       = request.user_id,
        inspection_id       = data.get('inspection_id'),
        title               = data['title'],
        priority            = data['priority'],
        category            = data['category'],
        description         = data['description'],
        recommended_actions = json.dumps(data['recommended_actions']),
        raw_notes           = data.get('raw_notes'),
    )
    db.session.add(report)
    try:
        db.session.commit()
    except SQLAlchemyError as e:
        db.session.rollback()
        log.exception('Failed to save AI report')
        raise AIError(AI_INTERNAL, f'Could not save report: {e}', 500)

    result = ai_report_schema.dump(report)
    result['recommended_actions'] = json.loads(report.recommended_actions)
    return jsonify(result), 201


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/ai/reports
# Returns all saved AI inspection reports for the logged-in contractor.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/reports', methods=['GET'])
@token_required
@handle_ai_errors
def get_reports():
    reports = (
        db.session.query(AiInspectionReports)
        .filter_by(contractor_id=request.user_id)
        .order_by(AiInspectionReports.created_at.desc())
        .all()
    )

    results = ai_reports_schema.dump(reports)
    for item, row in zip(results, reports):
        item['recommended_actions'] = json.loads(row.recommended_actions)

    return jsonify(results), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/save-chat
# Persist a Field Assistant conversation to the local DB. Mirrors save-report
# so SavedReports lists both kinds of saved AI artefact through one screen.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/save-chat', methods=['POST'])
@token_required
@handle_ai_errors
def save_chat():
    data = save_chat_schema.load(request.get_json() or {})

    # Optional photo attachment must belong to a ticket the caller is
    # actually assigned to. Re-validate here so a contractor can't bind
    # someone else's photo to their saved chat.
    photo_id = data.get('photo_id')
    if photo_id:
        contractor = (
            db.session.query(Contractor)
            .filter(Contractor.user_id == request.user_id)
            .first()
        )
        if not contractor:
            raise AIError(AI_BAD_REQUEST, 'no contractor record for this user', 400)
        owns_photo = (
            db.session.query(TicketPhoto)
            .join(Ticket, TicketPhoto.ticket_id == Ticket.id)
            .filter(
                TicketPhoto.id == photo_id,
                Ticket.assigned_contractor == contractor.id,
            )
            .first()
        )
        if not owns_photo:
            # 404 instead of 403 so we don't leak whether the photo exists.
            raise AIError(AI_NOT_FOUND, 'attached photo not found', 404)

    session = AiChatSession(
        contractor_id = request.user_id,
        title         = data['title'],
        summary       = data.get('summary'),
        messages      = data['messages'],
        photo_id      = photo_id,
    )
    db.session.add(session)
    try:
        db.session.commit()
    except SQLAlchemyError as e:
        db.session.rollback()
        log.exception('Failed to save AI chat session')
        raise AIError(AI_INTERNAL, f'Could not save chat: {e}', 500)

    return jsonify(ai_chat_session_schema.dump(session)), 201


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/ai/chats
# Returns saved Field Assistant conversations for the logged-in contractor,
# newest first.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/chats', methods=['GET'])
@token_required
@handle_ai_errors
def get_chats():
    sessions = (
        db.session.query(AiChatSession)
        .filter_by(contractor_id=request.user_id)
        .order_by(AiChatSession.created_at.desc())
        .all()
    )
    return jsonify(ai_chat_sessions_schema.dump(sessions)), 200
