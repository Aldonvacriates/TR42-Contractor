"""Analytics endpoints for the contractor dashboard.

Source of truth: backend/app/models.py + the live team Supabase project
(`zatumiuotungelnicuhj`). All tables are SINGULAR, all PKs are text/UUID.

Endpoint catalog
- GET   /api/analytics/dashboard/stats          aggregate stats cards
- GET   /api/analytics/jobs                     paginated ticket history
- GET   /api/analytics/performance/trends       monthly ticket + rating trends
- GET   /api/analytics/performance/distribution jobs by route + status
- GET   /api/analytics/profile                  contractor profile + ratings + license
- GET   /api/analytics/notifications            notification list
- GET   /api/analytics/active-work              tickets currently in progress

Endpoints intentionally NOT implemented yet
- earnings/payments  the team Supabase has no `payments` or `shift` table for
                    contractor-level totals; revisit when Daniel adds the
                    per-contractor compensation schema
- shifts            same; no `shift` table on the team DB
- mark notification read
                    `notification` has no `is_read` column today; tracked as
                    a follow-up

Auth model
- @token_required attaches `request.user_id` and `request.user_role`.
- Every endpoint defaults `contractor_id` to the token owner. A `?contractor_id=`
  override is only honored for users with role `vendor` (so vendors can fetch
  stats for their own subcontractors). Contractors querying anyone but
  themselves get 403.
"""

from flask import jsonify, request
from sqlalchemy import text

from app.models import db
from app.util.auth import token_required

from . import analytics_bp


# ── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_contractor_id():
    """Return (contractor_id, error_response). Default to token owner.

    Vendors can pass ?contractor_id=<id> to read another contractor's stats.
    Contractors can only read their own.
    """
    raw = (request.args.get('contractor_id') or '').strip()
    if not raw:
        return request.user_id, None

    role = (getattr(request, 'user_role', '') or '').lower()
    if role == 'vendor':
        return raw, None

    if raw != request.user_id:
        return None, (
            jsonify({'error': 'Forbidden: you may only access your own analytics'}),
            403,
        )
    return raw, None


def _execute_query(query: str, params: dict | None = None):
    """Run a parameterized SQL query and return (rows, error_string).

    Returns dict rows so jsonify can serialize directly. Catches DB errors
    so a single broken query doesn't 500 the whole route.
    """
    try:
        result = db.session.execute(text(query), params or {})
        columns = list(result.keys())
        return [dict(zip(columns, row)) for row in result], None
    except Exception as e:
        db.session.rollback()
        return None, str(e)


# ── 1. Dashboard stats ───────────────────────────────────────────────────────

@analytics_bp.route('/dashboard/stats', methods=['GET'])
@token_required
def get_dashboard_stats():
    """Aggregate stat cards. One round-trip via subqueries for cheaper response."""
    contractor_id, err = _resolve_contractor_id()
    if err:
        return err

    rows, qerr = _execute_query(
        """
        SELECT
            (SELECT COUNT(*) FROM ticket WHERE assigned_contractor = :cid)
                AS total_jobs,
            (SELECT COUNT(*) FROM ticket
             WHERE assigned_contractor = :cid AND status = 'COMPLETED')
                AS completed_jobs,
            (SELECT ROUND(
                COUNT(*) FILTER (WHERE status = 'COMPLETED')::numeric /
                NULLIF(COUNT(*), 0) * 100, 2)
             FROM ticket WHERE assigned_contractor = :cid)
                AS completion_rate,
            (SELECT ROUND(
                COUNT(*) FILTER (WHERE anomaly_flag = TRUE)::numeric /
                NULLIF(COUNT(*), 0) * 100, 2)
             FROM ticket
             WHERE assigned_contractor = :cid AND status = 'COMPLETED')
                AS flag_rate,
            (SELECT ROUND(AVG(rating)::numeric, 2)
             FROM contractor_performance WHERE contractor_id = :cid)
                AS avg_rating
        """,
        {'cid': contractor_id},
    )
    if qerr:
        return jsonify({'error': f'dashboard stats query failed: {qerr}'}), 500

    row = rows[0] if rows else {}
    return jsonify({
        'total_jobs':       row.get('total_jobs') or 0,
        'completed_jobs':   row.get('completed_jobs') or 0,
        'completion_rate':  float(row.get('completion_rate') or 0),
        'flag_rate':        float(row.get('flag_rate') or 0),
        'avg_rating':       float(row.get('avg_rating') or 0),
    }), 200


# ── 2. Job history ───────────────────────────────────────────────────────────

@analytics_bp.route('/jobs', methods=['GET'])
@token_required
def get_job_history():
    """Paginated ticket history with the parent work_order joined in."""
    contractor_id, err = _resolve_contractor_id()
    if err:
        return err

    page   = max(request.args.get('page',  1, type=int), 1)
    limit  = min(request.args.get('limit', 20, type=int), 100)
    offset = (page - 1) * limit

    params = {'cid': contractor_id, 'limit': limit, 'offset': offset}

    jobs, qerr = _execute_query(
        """
        SELECT
            t.id,
            t.description,
            t.route,
            t.status,
            t.priority,
            t.anomaly_flag,
            t.anomaly_reason,
            t.start_time,
            t.end_time,
            t.contractor_start_latitude,
            t.contractor_start_longitude,
            t.contractor_end_latitude,
            t.contractor_end_longitude,
            t.notes,
            t.assigned_at,
            t.created_at,
            w.work_order_code,
            w.description AS work_order_description,
            w.location    AS work_order_location
        FROM ticket t
        LEFT JOIN work_order w ON w.id = t.work_order_id
        WHERE t.assigned_contractor = :cid
        ORDER BY t.created_at DESC
        LIMIT :limit OFFSET :offset
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'job history query failed: {qerr}'}), 500

    total_rows, terr = _execute_query(
        "SELECT COUNT(*) AS n FROM ticket WHERE assigned_contractor = :cid",
        {'cid': contractor_id},
    )
    if terr:
        return jsonify({'error': f'job count query failed: {terr}'}), 500

    total = total_rows[0]['n'] if total_rows else 0

    return jsonify({
        'jobs': jobs,
        'pagination': {
            'page':        page,
            'limit':       limit,
            'total':       total,
            'total_pages': (total + limit - 1) // limit if total else 0,
        }
    }), 200


# ── 3. Performance trends ────────────────────────────────────────────────────

@analytics_bp.route('/performance/trends', methods=['GET'])
@token_required
def get_performance_trends():
    """Monthly volume, completion, anomaly rate, and rating trend (last 12 months)."""
    contractor_id, err = _resolve_contractor_id()
    if err:
        return err

    params = {'cid': contractor_id}

    monthly_jobs, qerr = _execute_query(
        """
        SELECT
            date_trunc('month', created_at) AS month,
            COUNT(*)                        AS job_count,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')                  AS completed_count,
            COUNT(*) FILTER (WHERE status IN ('ASSIGNED', 'IN_PROGRESS')) AS active_count
        FROM ticket
        WHERE assigned_contractor = :cid
        GROUP BY date_trunc('month', created_at)
        ORDER BY month DESC
        LIMIT 12
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'monthly jobs query failed: {qerr}'}), 500

    rating_trend, qerr = _execute_query(
        """
        SELECT
            date_trunc('month', created_at) AS month,
            ROUND(AVG(rating)::numeric, 2)  AS avg_rating,
            COUNT(*)                        AS rating_count
        FROM contractor_performance
        WHERE contractor_id = :cid
        GROUP BY date_trunc('month', created_at)
        ORDER BY month DESC
        LIMIT 12
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'rating trend query failed: {qerr}'}), 500

    anomaly_trend, qerr = _execute_query(
        """
        SELECT
            date_trunc('month', created_at) AS month,
            ROUND(
                COUNT(*) FILTER (WHERE anomaly_flag = TRUE)::numeric /
                NULLIF(COUNT(*), 0) * 100, 2
            ) AS anomaly_rate_pct,
            COUNT(*) AS total_tickets
        FROM ticket
        WHERE assigned_contractor = :cid
        GROUP BY date_trunc('month', created_at)
        ORDER BY month DESC
        LIMIT 12
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'anomaly trend query failed: {qerr}'}), 500

    return jsonify({
        'monthly_jobs':  monthly_jobs,
        'rating_trend':  rating_trend,
        'anomaly_trend': anomaly_trend,
    }), 200


# ── 4. Performance distribution ──────────────────────────────────────────────

@analytics_bp.route('/performance/distribution', methods=['GET'])
@token_required
def get_performance_distribution():
    """Job counts grouped by route and by status."""
    contractor_id, err = _resolve_contractor_id()
    if err:
        return err

    params = {'cid': contractor_id}

    by_route, qerr = _execute_query(
        """
        SELECT route, COUNT(*) AS job_count
        FROM ticket
        WHERE assigned_contractor = :cid AND route IS NOT NULL
        GROUP BY route
        ORDER BY job_count DESC
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'jobs by route query failed: {qerr}'}), 500

    by_status, qerr = _execute_query(
        """
        SELECT status, COUNT(*) AS job_count
        FROM ticket
        WHERE assigned_contractor = :cid
        GROUP BY status
        ORDER BY job_count DESC
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'jobs by status query failed: {qerr}'}), 500

    return jsonify({'by_route': by_route, 'by_status': by_status}), 200


# ── 5. Profile + license ─────────────────────────────────────────────────────

@analytics_bp.route('/profile', methods=['GET'])
@token_required
def get_contractor_profile():
    """Profile, rating summary, and active license info."""
    contractor_id, err = _resolve_contractor_id()
    if err:
        return err

    params = {'cid': contractor_id}

    profile, qerr = _execute_query(
        """
        SELECT
            au.id              AS auth_user_id,
            au.username,
            au.email,
            au.first_name,
            au.last_name,
            au.contact_number,
            au.alternate_number,
            au.user_type,
            au.is_active,
            c.id               AS contractor_id,
            c.employee_number,
            c.role,
            c.status           AS contractor_status,
            c.tickets_completed,
            c.tickets_open,
            c.is_licensed,
            c.is_insured,
            c.is_certified,
            c.average_rating,
            c.years_experience,
            c.created_at
        FROM contractor c
        JOIN auth_user au ON au.id = c.id
        WHERE c.id = :cid
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'profile query failed: {qerr}'}), 500
    if not profile:
        return jsonify({'error': 'Contractor not found'}), 404

    rating_summary, qerr = _execute_query(
        """
        SELECT
            ROUND(AVG(rating)::numeric, 2) AS avg_rating,
            COUNT(*)                       AS total_ratings
        FROM contractor_performance
        WHERE contractor_id = :cid
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'rating summary query failed: {qerr}'}), 500

    recent_ratings, qerr = _execute_query(
        """
        SELECT id, rating, comments, ticket_id, created_at
        FROM contractor_performance
        WHERE contractor_id = :cid
        ORDER BY created_at DESC
        LIMIT 10
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'recent ratings query failed: {qerr}'}), 500

    licenses, qerr = _execute_query(
        """
        SELECT
            id, license_type, license_number, license_state,
            license_expiration_date, license_verified, license_verified_at
        FROM license
        WHERE contractor_id = :cid
        ORDER BY license_expiration_date DESC NULLS LAST
        """,
        params,
    )
    if qerr:
        return jsonify({'error': f'license query failed: {qerr}'}), 500

    return jsonify({
        'profile':        profile[0],
        'rating_summary': rating_summary[0] if rating_summary else {},
        'recent_ratings': recent_ratings,
        'licenses':       licenses,
    }), 200


# ── 6. Notifications ─────────────────────────────────────────────────────────
# The `notification` table has columns: id, message, recipient (text), level,
# created_at. There's no is_read column today, so we can't expose a read/unread
# split. Returning the recent list keyed on recipient = caller's user id.

@analytics_bp.route('/notifications', methods=['GET'])
@token_required
def get_notifications():
    """Recent notifications addressed to this user."""
    contractor_id, err = _resolve_contractor_id()
    if err:
        return err

    rows, qerr = _execute_query(
        """
        SELECT id, message, level, created_at
        FROM notification
        WHERE recipient = :cid
        ORDER BY created_at DESC
        LIMIT 20
        """,
        {'cid': contractor_id},
    )
    if qerr:
        return jsonify({'error': f'notifications query failed: {qerr}'}), 500

    return jsonify({
        'notifications': rows,
        'count':         len(rows) if rows else 0,
    }), 200


# ── 7. Active work ───────────────────────────────────────────────────────────

@analytics_bp.route('/active-work', methods=['GET'])
@token_required
def get_active_work():
    """Tickets currently assigned, in progress, or pending approval."""
    contractor_id, err = _resolve_contractor_id()
    if err:
        return err

    rows, qerr = _execute_query(
        """
        SELECT
            t.id,
            t.description,
            t.route,
            t.status,
            t.priority,
            t.start_time,
            t.end_time,
            t.contractor_start_latitude,
            t.contractor_start_longitude,
            t.anomaly_flag,
            t.notes,
            w.work_order_code,
            w.description AS work_order_description,
            w.location    AS work_order_location
        FROM ticket t
        LEFT JOIN work_order w ON w.id = t.work_order_id
        WHERE t.assigned_contractor = :cid
          AND t.status IN ('ASSIGNED', 'IN_PROGRESS', 'PENDING_APPROVAL')
        ORDER BY t.start_time DESC NULLS LAST
        """,
        {'cid': contractor_id},
    )
    if qerr:
        return jsonify({'error': f'active work query failed: {qerr}'}), 500

    return jsonify({
        'active_tickets': rows,
        'count':          len(rows) if rows else 0,
    }), 200
