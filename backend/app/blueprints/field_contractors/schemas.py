from marshmallow_sqlalchemy import auto_field

from app.extensions import ma
from app.models import Contractor
from marshmallow import fields, Schema

class ContractorSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Contractor
        include_fk = True
    id = auto_field(dump_only=True)

class ContractorUpdateSchema(Schema):
    # contact_number = fields.Str(required=False)
    # address_id = fields.Str(required=False)

class VendorUpdateContractorSchema(Schema):


    # contractor_type = fields.Str(required=False)
    # contact_number = fields.Str(required=False)
    # date_of_birth = fields.Date(required=False)
    # address = fields.Str(required=False)

contractor_schema = ContractorSchema()
contractor_update_schema = ContractorUpdateSchema()
vendor_update_contractor_schema = VendorUpdateContractorSchema()