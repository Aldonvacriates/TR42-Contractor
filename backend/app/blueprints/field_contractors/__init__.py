from flask import Blueprint

field_contractors_bp = Blueprint('field_contractors_bp', __name__)

from . import routes
