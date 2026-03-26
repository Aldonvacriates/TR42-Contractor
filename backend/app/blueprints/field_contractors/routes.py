from flask import request, jsonify
from app.models import Auth_users, Contractors, db
from .schemas import contractor_schema, contractor_update_schema
from ..auth_users.schemas import auth_user_update_schema
from marshmallow import ValidationError
from werkzeug.security import generate_password_hash, check_password_hash
from . import field_contractors_bp
from app.util.auth import encode_token, token_required


# View User Profile
@field_contractors_bp.route('/profile', methods=['GET'])
@token_required
def get_contractor():
    user_id= request.user_id
    user = db.session.get(Contractors, user_id)
    if user:
        return contractor_schema.jsonify(user), 200
    return jsonify ({'error': 'Invalid user id'}), 400

# Update Profile (need to be able to update email, contact number, address - anything else will be through vendor)
@field_contractors_bp.route('/profile', methods=['PUT'])
@token_required
def update_contractor():
    json_data = request.get_json()

    if not json_data:
         return jsonify({'error': 'No input data provided'}), 400

    # Validate and deserialize new updated input
    try:
        auth_user_data = auth_user_update_schema.load(json_data.get('auth_user', {})) 
        contractor_data = contractor_update_schema.load(json_data.get('contractor', {}))
    except ValidationError as e:
        return jsonify(e.messages), 400
    if not auth_user_data and not contractor_data:
        return jsonify({'error': 'No data to update'}), 400
    
    #user_id from token
    user_id = request.user_id
    contractor = db.session.get(Contractors, user_id)

    if not contractor or not contractor.auth_user:
            return jsonify({'error': 'Invalid User Id'}), 404
    
    auth_user = contractor.auth_user

    try: 
        for key, value in auth_user_data.items():
            setattr(auth_user, key, value)
        for key, value in contractor_data.items():
            setattr(contractor, key, value)

        db.session.commit()    
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Updating failed'}), 500


    return jsonify({
        'message': 'Profile updated successfully',
        'auth_user': auth_user_update_schema.dump(auth_user),
        'contractor': contractor_update_schema.dump(contractor)
    }), 200



#Update password route
#Update offline pin route


