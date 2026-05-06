"""AI endpoints for the contractor app.

All routes use @handle_ai_errors so the response shape is consistent:
    success: regular JSON or text/event-stream
    failure: { "error": "...", "code": "AI_*" }

Routes:
    POST   /api/ai/inspection-assist  - convert raw notes to structured report (one-shot)
    POST   /api/ai/inspection-assist/stream - same, but streamed via SSE
    POST   /api/ai/refine-report      - regenerate a report given user feedback
    POST   /api/ai/analyze-photo      - run Claude vision against a ticket photo
    POST   /api/ai/chat               - stateless chat assistant (frontend keeps history)
    POST   /api/ai/save-report        - persist a report to the local DB
    GET    /api/ai/reports            - list saved reports for the caller
"""
import base64
import io
import json
import logging
import os

import anthropic
from flask import Response, jsonify, request, stream_with_context
from sqlalchemy.exc import SQLAlchemyError

from app.models import AiInspectionReports, Contractor, Ticket, TicketPhoto, db
from app.util.auth import token_required

from . import ai_bp
from .errors import (
    AI_BAD_REQUEST,
    AI_NOT_FOUND,
    AI_UNAUTHORIZED,
    AIError,
    handle_ai_errors,
    require_api_key,
)
from .schemas import (
    ai_report_schema,
    ai_reports_schema,
    chat_schema,
    inspection_assist_schema,
    refine_report_schema,
    save_report_schema,
)

log = logging.getLogger(__name__)

# ── Anthropic client ─────────────────────────────────────────────────────────
# Lazy-init so the module imports even when ANTHROPIC_API_KEY isn't set
# (lets the rest of the backend boot in offline / no-AI environments).
_client = None

def _get_client():
    global _client
    if _client is None:
        require_api_key()
        _client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))
    return _client


# Default model. Haiku 4.5 is fast, cheap, and supports vision.
_MODEL = 'claude-haiku-4-5'

# ── Prompts ──────────────────────────────────────────────────────────────────
# All system prompts get prompt-cached so repeat requests amortise the cost
# of sending the prompt text every time. The cache TTL is 5 minutes by
# default; the AI assistant chat warms it on the first turn.

_INSPECTION_PROMPT = """You are an AI assistant for field contractors.
Convert raw contractor field notes into a structured inspection report.
Respond with ONLY valid JSON using exactly these fields:
- title: short descriptive title (string)
- priority: one of "low", "medium", or "high" (string)
- category: e.g. "Electrical", "Plumbing", "HVAC", "Structural", "Safety" (string)
- description: clear professional description of the issue (string)
- recommended_actions: specific action items to address the issue (array of strings)

Do not include any text outside the JSON object."""


_REFINE_PROMPT = """You are revising an existing inspection report based on
contractor feedback. Keep the same JSON shape:
- title (string)
- priority ("low" | "medium" | "high")
- category (string)
- description (string)
- recommended_actions (array of strings)

Apply the contractor's feedback faithfully. Do not invent facts that aren't
in the original report or the feedback. Respond with ONLY the revised JSON
object and nothing else."""


_PHOTO_PROMPT = """You are a job-site safety inspector reviewing a contractor's
photo. Identify any visible safety concerns, OSHA violations, code issues, or
quality problems. Be specific. If the photo looks safe and compliant, say so.

Respond with ONLY valid JSON using exactly these fields:
- summary: one-sentence overall assessment (string)
- severity: "none", "low", "medium", or "high" (string)
- concerns: list of specific issues found (array of strings, empty if none)
- recommendations: specific actions to address the concerns (array of strings, empty if none)

Do not include any text outside the JSON object."""


_CHAT_PROMPT = """You are an AI assistant for oil-services field contractors
using a mobile app. Help with: questions about work orders and tickets,
procedures, safety guidance, OSHA references, troubleshooting equipment
issues, and clarifying paperwork. Be concise. If a question needs specific
data the contractor would have access to in the app, point them to the
right screen instead of guessing. If asked anything outside this scope,
say you focus on field-work topics."""


def _system_block(text: str):
    """Wrap a prompt string in the Anthropic format with cache control on."""
    return [{
        'type': 'text',
        'text': text,
        'cache_control': {'type': 'ephemeral'},
    }]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _extract_text(message) -> str:
    """Pull the first text block out of an Anthropic Message response."""
    return next((b.text for b in message.content if b.type == 'text'), '')


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
# Converts raw contractor field notes into a structured report. One-shot
# (no streaming). Use /inspection-assist/stream for the streaming variant.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/inspection-assist', methods=['POST'])
@token_required
@handle_ai_errors
def inspection_assist():
    data = inspection_assist_schema.load(request.get_json() or {})
    notes = data['notes'].strip()
    if not notes:
        raise AIError(AI_BAD_REQUEST, 'notes cannot be empty', 400)

    response = _get_client().messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_system_block(_INSPECTION_PROMPT),
        messages=[{
            'role': 'user',
            'content': f'Convert these field notes into a structured report:\n\n{notes}',
        }],
    )
    report = json.loads(_extract_text(response))
    return jsonify(report), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/inspection-assist/stream
# Same as above but streams the response as Server-Sent Events. The body of
# the stream is the JSON object being constructed token-by-token. Frontend
# accumulates the chunks and parses the final JSON when the stream closes.
#
# Stream protocol:
#   data: <chunk text>\n\n        ...zero or more times...
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

    client = _get_client()

    @stream_with_context
    def generate():
        try:
            with client.messages.stream(
                model=_MODEL,
                max_tokens=1024,
                system=_system_block(_INSPECTION_PROMPT),
                messages=[{
                    'role': 'user',
                    'content': f'Convert these field notes into a structured report:\n\n{notes}',
                }],
            ) as stream:
                for chunk in stream.text_stream:
                    # SSE framing: each event is "data: <payload>\n\n"
                    # JSON-encode the chunk so newlines in it don't break the
                    # SSE framing.
                    yield f'data: {json.dumps({"chunk": chunk})}\n\n'
            yield 'event: done\ndata: {}\n\n'
        except anthropic.APIError as e:
            log.exception('Stream failed')
            yield f'event: error\ndata: {json.dumps({"error": str(e)})}\n\n'

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',  # disable nginx buffering if proxied
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/refine-report
# Take an existing structured report + user feedback, return a revised report.
# Same JSON shape as inspection-assist output.
# ─────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/refine-report', methods=['POST'])
@token_required
@handle_ai_errors
def refine_report():
    data = refine_report_schema.load(request.get_json() or {})
    feedback = data['feedback'].strip()
    if not feedback:
        raise AIError(AI_BAD_REQUEST, 'feedback cannot be empty', 400)

    original_json = json.dumps(data['report'], indent=2)
    user_message = (
        f'Original report:\n{original_json}\n\n'
        f'Contractor feedback:\n{feedback}\n\n'
        f'Apply the feedback and return the revised JSON.'
    )

    response = _get_client().messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_system_block(_REFINE_PROMPT),
        messages=[{'role': 'user', 'content': user_message}],
    )
    return jsonify(json.loads(_extract_text(response))), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/analyze-photo
# Run Claude vision against a ticket photo the caller is allowed to see.
# Body: { "photo_id": "<uuid>" }
# The bytes already live in ticket_photo.photo_content (bytea), so we just
# base64 them into the vision message.
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

    # Default to JPEG since that's what the photos route re-encodes to. The
    # mime_type column isn't on the table per the team schema, so we infer.
    media_type = 'image/jpeg'
    encoded = base64.standard_b64encode(photo.photo_content).decode('ascii')

    response = _get_client().messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_system_block(_PHOTO_PROMPT),
        messages=[{
            'role': 'user',
            'content': [
                {
                    'type': 'image',
                    'source': {
                        'type': 'base64',
                        'media_type': media_type,
                        'data': encoded,
                    },
                },
                {'type': 'text', 'text': 'Analyze this job-site photo.'},
            ],
        }],
    )
    return jsonify(json.loads(_extract_text(response))), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/chat
# Stateless chat assistant. The frontend keeps the conversation history and
# sends it with each request. Backend just forwards to Claude with the
# system prompt cached.
#
# Body shape:
#   { "messages": [ {"role": "user"|"assistant", "content": "..."}, ... ] }
# Returns:
#   { "reply": "<assistant text>" }
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

    response = _get_client().messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_system_block(_CHAT_PROMPT),
        messages=messages,
    )
    return jsonify({'reply': _extract_text(response)}), 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/ai/save-report
# Persists an AI-generated report to the local DB. Frontend sends the
# structured object it received from /inspection-assist or /refine-report.
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
        raise AIError('AI_INTERNAL', f'Could not save report: {e}', 500)

    result = ai_report_schema.dump(report)
    result['recommended_actions'] = json.loads(report.recommended_actions)
    return jsonify(result), 201


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/ai/reports
# Returns all saved AI inspection reports for the logged-in contractor,
# newest first.
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
