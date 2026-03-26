from app.extensions import ma
from app.models import Contractors
from marshmallow import fields, Schema

class ContractorSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Contractors

class ContractorUpdateSchema(Schema):
    contact_number = fields.Str(required=False)
    address = fields.Str(required=False)


contractor_schema = ContractorSchema()
contractor_update_schema = ContractorUpdateSchema()