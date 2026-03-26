from flask import Blueprint

auth_users_bp = Blueprint('auth_users_bp', __name__)

from . import routes

