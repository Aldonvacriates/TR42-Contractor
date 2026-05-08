import os

from flask import request, jsonify
from app.models import AuthUser, Contractor, PasswordResetToken, db
from .schemas import auth_user_schema, login_schema, auth_user_update_password_schema, auth_user_forgot_password_schema, auth_user_reset_password_schema, offline_pin_schema
from marshmallow import ValidationError
from werkzeug.security import generate_password_hash, check_password_hash
from . import auth_users_bp
from app.util.auth import encode_token, token_required
from datetime import datetime, timezone, timedelta
import secrets
import resend

resend.api_key = os.getenv('RESEND_API_KEY')

def ensure_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        # Assume naive datetimes are in UTC (or adjust as needed)
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def validate_reset_token(token, user_id):
    if not token:
        return None
    # In a real implementation, you would look up the hashed token in the database and check if it's valid and not expired.
    reset_token_entry = db.session.query(PasswordResetToken).filter_by(is_used=False, auth_user_id=user_id).all()  # Get all unused tokens for the user
    for entry in reset_token_entry:
        if check_password_hash(entry.hashed_token, token) and ensure_utc(entry.expires_at) > datetime.now(timezone.utc):
            # Mark the token as used
            entry.is_used = True
            return db.session.get(AuthUser, entry.auth_user_id)

    return None



#Login and get token
@auth_users_bp.route('/login', methods=['POST'])
def login():
    try:
        data = login_schema.load(request.json)
    except ValidationError as e:
        return jsonify(e.messages), 400

    # Frontend sends `identifier` (accepts email OR username); legacy clients
    # may still send `email` or `username` directly — accept any of the three.
    identifier = (
        data.get('identifier')
        or data.get('email')
        or data.get('username')
        or ''
    ).strip()

    if not identifier:
        return jsonify({
            'error': 'Please provide an email address or username.',
            'code':  'MISSING_IDENTIFIER',
        }), 400

    # Presence of '@' is a strong enough signal that the contractor typed an
    # email. Both columns are unique so only one lookup is needed per request.
    if '@' in identifier:
        user = db.session.query(AuthUser).where(AuthUser.email == identifier).first()
    else:
        user = db.session.query(AuthUser).where(AuthUser.username == identifier).first()

    if user and check_password_hash(user.password_hash, data['password']):
        token = encode_token(user.id, user.user_type)
        return jsonify({
            'message': 'Successfully Logged in',
            'token': token,
            'user': auth_user_schema.dump(user)
        }), 200

    # Generic message — don't leak whether the email/username was recognised
    return jsonify({
        'error': 'Invalid credentials.',
        'code':  'INVALID_CREDENTIALS',
    }), 401


# Register/Create AuthUser for new contractor is in contractor routes - for testing


#Update password route (this one is if they already know existing password)
@auth_users_bp.route('/update-password', methods=['PUT'])
@token_required
def update_password():
    try:
        data = auth_user_update_password_schema.load(request.json)
    except ValidationError as e:
        return jsonify(e.messages), 400

    current_password = data.get('current_password')
    new_password = data.get('new_password')

    try: 
        #user_id from token
        user_id = request.user_id
        user = db.session.get(AuthUser, user_id)

        if user and check_password_hash(user.password_hash, current_password):
            user.password_hash = generate_password_hash(new_password)

            db.session.commit()    
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Updating failed'}), 500


    return jsonify({ 'message': 'Password updated successfully'}), 200


#Update password route for forgot password flow - no current password, but need to verify token from email link
@auth_users_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = auth_user_forgot_password_schema.load(request.json)
    except ValidationError as e:
        return jsonify(e.messages), 400
    
    email = data.get('email')

    try:
        user = db.session.query(AuthUser).where(AuthUser.email == email).first()
        if user:
            # In a real implementation, generate a secure token, save it with an expiration
            token = secrets.token_urlsafe(32)
            hashed_token = generate_password_hash(token)

            reset_token_entry = PasswordResetToken(
                auth_user_id=user.id,
                hashed_token=hashed_token,
                is_used=False,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),  # token valid for 1 hour
                created_at=datetime.now(timezone.utc)
            )
            db.session.add(reset_token_entry)
        

            # Send an email to the user with a reset link containing the token.

            # Note, this url has a temporary domain and should be updated to the actual frontend domain when available. The frontend will need to extract the token and user_id from the query params and call the reset-password endpoint with them.
            params: resend.Emails.SendParams = {
                "from": "Field Force <noreply@resend.dev>",
                "to": [email],
                "subject": "Field Force Password Reset",
                "html": f"<strong>Please use this link to reset your password:</strong> <a href='https://testing.com/reset-password?token={token}&id={user.id}'>Reset Password</a>",
            }

            resend.Emails.send(params)
            db.session.commit()
            
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Error occurred while fetching data'}), 500

    # To avoid leaking information, we'll return a success message even for emails that aren't in our system. The reset link will only be sent if the email exists.
    return jsonify({'message': 'If an account with that email exists, a reset link has been sent.'}), 200
# This endpoint would be called by the frontend when the user clicks the reset link in their email, with the token and new password.
@auth_users_bp.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = auth_user_reset_password_schema.load(request.json)
    except ValidationError as e:
        return jsonify(e.messages), 400

    reset_token = data.get('token')
    user_id = data.get('user_id')
    new_password = data.get('new_password')

    user = validate_reset_token(reset_token, user_id)
    if not user:
        return jsonify({'error': 'Invalid or expired reset token'}), 400

    try:
        user.password_hash = generate_password_hash(new_password)
        db.session.commit()    # commits both new password and the token being marked as used in validate_reset_token
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Password reset failed'}), 500

    return jsonify({ 'message': 'Password reset successfully'}), 200

# Set offline PIN for contractor (stored for offline login use on-device)
@auth_users_bp.route('/offline-pin', methods=['POST'])
@token_required
def set_offline_pin():
    try:
        data = offline_pin_schema.load(request.json)
    except ValidationError as e:
        return jsonify(e.messages), 400

    pin = data.get('pin', '')
    if not pin.isdigit() or len(pin) < 6 or len(pin) > 10:
        return jsonify({'error': 'pin must be 6-10 digits'}), 400

    contractor = db.session.query(Contractor).where(Contractor.user_id == request.user_id).first()
    if not contractor:
        return jsonify({'error': 'contractor not found for current user'}), 404

    contractor.offline_pin = generate_password_hash(pin)
    db.session.commit()

    return jsonify({'message': 'offline pin set'}), 200

