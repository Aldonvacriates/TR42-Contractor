from app.extensions import ma
from app.models import Auth_users
from marshmallow import fields, Schema

class AuthUserSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Auth_users
        load_only = ("password",)

class LoginSchema(Schema):
    username = fields.Str(required=True)
    password = fields.Str(required=True)

class AuthUserUpdateSchema(Schema):
    email = fields.Email(required=False)
#ex. use in contractor update routes


auth_user_schema = AuthUserSchema()
login_schema = LoginSchema()
auth_user_update_schema = AuthUserUpdateSchema()

# Offline PIN schema 
class OfflinePinSchema(Schema):
    pin = fields.Str(required=True)

offline_pin_schema = OfflinePinSchema()
