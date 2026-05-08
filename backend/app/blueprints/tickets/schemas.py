from marshmallow_sqlalchemy import auto_field

from app.extensions import ma
from app.models import Ticket
from marshmallow import fields, Schema, validate

class TicketSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Ticket
        include_fk = True
    id = auto_field(dump_only=True)

class TicketUpdateSchema(Schema):
    notes = fields.Str(required=False)
    status = fields.Str(required=False, validate=validate.OneOf(["UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "PENDING_APPROVAL", "APPROVED", "COMPLETED", "REJECTED"]),)
    start_time = fields.AwareDateTime(required=False)
    end_time = fields.AwareDateTime(required=False)
    contractor_start_latitude = fields.Float(required=False)
    contractor_start_longitude = fields.Float(required=False)
    contractor_end_latitude = fields.Float(required=False)
    contractor_end_longitude = fields.Float(required=False)
    # Pre-task PPE attestation. Required when status transitions to IN_PROGRESS;
    # routes.py enforces presence + non-empty list. ppe_confirmed_at is optional
    # (server fills with utcnow when missing).
    ppe_confirmed = fields.Bool(required=False)
    ppe_confirmed_at = fields.AwareDateTime(required=False)
    ppe_items = fields.List(fields.Str(), required=False)

ticket_schema = TicketSchema()
tickets_schema = TicketSchema(many=True)
ticket_update_schema = TicketUpdateSchema()