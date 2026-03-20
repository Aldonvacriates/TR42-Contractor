from app.extensions import ma
from app.models import Auth_users

class AuthUserSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Auth_users

auth_user_schema = AuthUserSchema()