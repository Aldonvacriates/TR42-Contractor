from flask import request, jsonify
from app.models import Auth_users, db
from .schemas import auth_user_schema, login_schema
from marshmallow import ValidationError
from werkzeug.security import generate_password_hash, check_password_hash
from . import auth_users_bp
from app.util.auth import encode_token

#Login and get token
@auth_users_bp.route('/login', methods=['POST'])
def login():
    try:
        data = login_schema.load(request.json)
    except ValidationError as e:
        return jsonify(e.messages), 400
    
    user = db.session.query(Auth_users).where(Auth_users.username==data['username']).first()

    if user and check_password_hash(user.password, data['password']):
        token = encode_token(user.id, user.role)
        return jsonify({
            'message': 'Successfully Logged in',
            'token': token,
            'user': auth_user_schema.dump(user)
        }), 200
    
    return jsonify({'error': 'invalid username or password'}), 401


# Register/Create Users
@auth_users_bp.route('', methods=['POST'])
def create_user():

    try:
        data = auth_user_schema.load(request.json)
    except ValidationError as e:
        return jsonify(e.messages), 400
    
    data['password']= generate_password_hash(data['password'])

    user = db.session.query(Auth_users).where(Auth_users.username == data['username']).first()

    if user: 
        return jsonify({'error': 'Username already taken'}), 400
    
    new_user = Auth_users(**data)
    db.session.add(new_user)
    db.session.commit()

    return auth_user_schema.jsonify(new_user), 201


