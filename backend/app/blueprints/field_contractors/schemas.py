from marshmallow_sqlalchemy import auto_field

from app.extensions import ma
from app.models import Contractors
from marshmallow import fields, Schema

class ContractorSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Contractors
        include_fk = True
    id = auto_field(dump_only=True)

class ContractorUpdateSchema(Schema):
    contact_number = fields.Str(required=False)
    address = fields.Str(required=False)

contractor_schema = ContractorSchema()
contractor_update_schema = ContractorUpdateSchema()