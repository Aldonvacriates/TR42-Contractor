from marshmallow import Schema, fields, validate


_PRIORITY = validate.OneOf(['low', 'medium', 'high'])


class InspectionAssistSchema(Schema):
    """Input for /inspection-assist (and its streaming variant).

    Notes are free-form contractor input. Length-bounded so the upstream
    request stays predictable.
    """
    notes = fields.Str(required=True, validate=validate.Length(min=1, max=8000))


class _ReportShape(Schema):
    """Shared shape for an AI inspection report. Used inside refine_report's
    payload so we validate the original structure the client sends back.
    """
    title               = fields.Str(required=True)
    priority            = fields.Str(required=True, validate=_PRIORITY)
    category            = fields.Str(required=True)
    description         = fields.Str(required=True)
    recommended_actions = fields.List(fields.Str(), required=True)


class RefineReportSchema(Schema):
    """Input for /refine-report.

    The client sends the original AI-generated report plus their feedback,
    and we ask Claude to revise it. Keeping this server-side instead of
    just inlining the original report into the chat prompt makes the
    contract explicit and lets us validate the report shape.
    """
    report   = fields.Nested(_ReportShape, required=True)
    feedback = fields.Str(required=True, validate=validate.Length(min=1, max=4000))


class ChatMessageSchema(Schema):
    """Single turn in the AI chat.

    role is restricted to user/assistant — system messages live in the
    backend's prompt, never in the client payload.
    """
    role    = fields.Str(required=True, validate=validate.OneOf(['user', 'assistant']))
    content = fields.Str(required=True, validate=validate.Length(min=1, max=10000))


class ChatSchema(Schema):
    """Input for /chat. Frontend keeps the conversation history and sends
    the whole thing every turn. The system prompt is added server-side.
    """
    messages = fields.List(
        fields.Nested(ChatMessageSchema),
        required=True,
        validate=validate.Length(min=1, max=50),
    )


class SaveReportSchema(Schema):
    """Payload the frontend sends when saving an AI-generated report."""
    title               = fields.Str(required=True)
    priority            = fields.Str(required=True, validate=_PRIORITY)
    category            = fields.Str(required=True)
    description         = fields.Str(required=True)
    recommended_actions = fields.List(fields.Str(), required=True)
    raw_notes           = fields.Str(required=False, load_default=None)
    # inspection_id is a text/UUID FK to inspection.id (not an int) since the
    # full schema sync moved every PK to text. Optional.
    inspection_id       = fields.Str(required=False, load_default=None)


class AiReportSchema(Schema):
    """Shape of a saved report returned to the client."""
    id                  = fields.Str()
    contractor_id       = fields.Str()
    inspection_id       = fields.Str(allow_none=True)
    title               = fields.Str()
    priority            = fields.Str()
    category            = fields.Str()
    description         = fields.Str()
    recommended_actions = fields.List(fields.Str())
    raw_notes           = fields.Str()
    created_at          = fields.DateTime()


# ── Saved Field Assistant conversation schemas ────────────────────────────
#
# Mirror the inspection-report shape so SavedReports can render both kinds
# of saved AI artefact through a single list endpoint pattern.

class _ChatMessageSchema(Schema):
    """One {role, content, timestamp} turn inside a saved conversation."""
    role      = fields.Str(
        required=True,
        validate=validate.OneOf(['user', 'assistant']),
    )
    content   = fields.Str(required=True, validate=validate.Length(min=1, max=10000))
    timestamp = fields.Str(required=False, allow_none=True)


class SaveChatSchema(Schema):
    """Payload for POST /api/ai/save-chat."""
    title    = fields.Str(required=True, validate=validate.Length(min=1, max=300))
    summary  = fields.Str(required=False, allow_none=True, load_default=None)
    messages = fields.List(
        fields.Nested(_ChatMessageSchema),
        required=True,
        validate=validate.Length(min=1, max=100),
    )
    # Optional FK to ticket_photo. Backend re-validates ownership before
    # persisting so a contractor can only attach photos they could have
    # uploaded themselves.
    photo_id = fields.Str(required=False, allow_none=True, load_default=None)


class AiChatSessionSchema(Schema):
    """Shape of a saved conversation returned to the client."""
    id            = fields.Str()
    contractor_id = fields.Str()
    title         = fields.Str()
    summary       = fields.Str(allow_none=True)
    messages      = fields.Raw()  # list of {role, content, timestamp}
    photo_id      = fields.Str(allow_none=True)
    created_at    = fields.DateTime()
    updated_at    = fields.DateTime(allow_none=True)


inspection_assist_schema = InspectionAssistSchema()
refine_report_schema     = RefineReportSchema()
chat_schema              = ChatSchema()
save_report_schema       = SaveReportSchema()
ai_report_schema         = AiReportSchema()
ai_reports_schema        = AiReportSchema(many=True)
save_chat_schema         = SaveChatSchema()
ai_chat_session_schema   = AiChatSessionSchema()
ai_chat_sessions_schema  = AiChatSessionSchema(many=True)
