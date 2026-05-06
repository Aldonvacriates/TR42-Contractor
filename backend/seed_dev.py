"""
seed_dev.py — Insert demo data into a dev database.

After the May-2026 shared-DB drop-tables incident, this script no longer
wipes existing data. The previous `wipe()` function (which ran a TRUNCATE
on auth_users CASCADE) was REMOVED entirely. The script now only INSERTs.

If you need a clean slate locally, delete the SQLite file
(`backend/instance/app.db`) and let `db.create_all()` recreate the schema
on the next Flask boot.

Inserts (idempotency not guaranteed — re-running may create duplicates or
fail on unique constraints; that's expected, just clear local data first):
  • 1 vendor admin user  (vendor / login)
  • 1 vendor company record
  • 1 contractor user    (aldo / the logged-in demo user)
  • Truck Pre-Trip Inspection template (6 sections, 30 items)
  • Today's drive-time session with realistic log segments

Usage (from the backend/ directory, against LOCAL SQLite only):
    python seed_dev.py

Running this against the shared Supabase is blocked by the safety guard at
the bottom of the file. Override only with team sign-off.

Login creds after seeding:
    username : aldo        password : 123456
    username : vendor      password : 123456
"""

from dotenv import load_dotenv
load_dotenv()

from datetime import date, datetime, timedelta, timezone
from werkzeug.security import generate_password_hash
from app import create_app
from app.models import (
    db,
    AuthUser, Contractor, Vendor,
    InspectionTemplate, InspectionSection, InspectionItem,
    DutySessions, DutyLogs,
)

import os
config = 'ProductionConfig' if os.environ.get('DATABASE_URL') else 'DevelopmentConfig'
app = create_app(config)

# ── Inspection checklist ──────────────────────────────────────────────────────

INSPECTION_SECTIONS = [
    ('Engine Compartment', 1, [
        'Check oil level',
        'Check coolant level',
        'Inspect belts (no cracks/fraying)',
        'Check hoses for leaks',
        'Power steering fluid',
        'Windshield washer fluid',
    ]),
    ('Lights Check', 2, [
        'Headlights (high and low beam)',
        'Tail lights',
        'Brake lights',
        'Turn signals (front and rear)',
        'Hazard lights',
        'Clearance/marker lights',
    ]),
    ('Front of Vehicle', 3, [
        'Windshield condition (no cracks)',
        'Wiper blades condition',
        'Front bumper secure',
        'License plate visible and secure',
        'Mirrors clean and adjusted',
    ]),
    ('Driver Side', 4, [
        'Door opens/closes properly',
        'Window operates correctly',
        'Mirror secure and clean',
        'Fuel cap secure',
        'Steps/handrails secure',
    ]),
    ('Wheels & Tires', 5, [
        'Tire pressure adequate',
        'Tread depth sufficient',
        'No cuts, bulges, or damage',
        'Lug nuts tight',
        'Valve stems intact',
        'Spare tire present and inflated',
    ]),
    ('Brake System Check', 6, [
        'Brake pedal firm',
        'Parking brake holds',
        'Air brake pressure builds properly',
        'No air leaks detected',
        'Brake lines/hoses intact',
    ]),
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def now_utc():
    return datetime.now(timezone.utc)

def hours_ago(h):
    return now_utc() - timedelta(hours=h)

def mins_ago(m):
    return now_utc() - timedelta(minutes=m)


# ── Users ─────────────────────────────────────────────────────────────────────

def seed_users(session):
    print('Seeding users...')
    pw = generate_password_hash('123456')

    # Vendor admin user. AuthUser.created_by is nullable so we can create the
    # very first user without an audit trail, then patch it to self-reference.
    vendor_auth = AuthUser(
        email='vendor@tr42.com',
        username='vendor',
        password_hash=pw,
        user_type='vendor',
        is_active=True,
        first_name='Jonathan',
        last_name='Manager',
        created_at=now_utc(),
    )
    session.add(vendor_auth)
    session.flush()
    vendor_auth.created_by = vendor_auth.id   # self-reference for audit trail

    # Vendor company record (separate from the auth user).
    vendor = Vendor(
        company_name='TR42 Logistics',
        company_code='TR42',
        primary_contact_name='Jonathan Manager',
        company_email='ops@tr42.com',
        company_phone='555-100-2000',
        status='active',
        onboarding=False,
        compliance_status='compliant',
        description='Demo vendor company for local development.',
        vendor_code='V-001',
        created_by=vendor_auth.id,
        updated_by=vendor_auth.id,
    )
    session.add(vendor)
    session.flush()

    # Contractor auth user.
    contractor_auth = AuthUser(
        email='aldo@tr42.com',
        username='aldo',
        password_hash=pw,
        user_type='contractor',
        is_active=True,
        first_name='Aldo',
        last_name='Cruz',
        contact_number='555-867-5309',
        date_of_birth=date(1990, 4, 16),
        created_by=vendor_auth.id,
        created_at=now_utc(),
    )
    session.add(contractor_auth)
    session.flush()

    # Contractor profile (links auth user to contractor-specific fields).
    contractor = Contractor(
        employee_number='EMP-001',
        user_id=contractor_auth.id,
        role='driver',
        status='active',
        tickets_completed=0,
        tickets_open=0,
        biometric_enrolled=False,
        is_onboarded=True,
        is_subcontractor=False,
        is_fte=True,
        is_licensed=True,
        is_insured=True,
        is_certified=True,
        average_rating=None,
        years_experience=5,
        created_by=vendor_auth.id,
        updated_by=vendor_auth.id,
    )
    session.add(contractor)
    session.commit()

    print(f'  [OK] vendor      -- username: vendor   id: {vendor_auth.id}')
    print(f'  [OK] contractor  -- username: aldo     id: {contractor_auth.id}')
    return vendor_auth, vendor, contractor_auth, contractor


# ── Inspection template ───────────────────────────────────────────────────────

def seed_inspection_template(session, created_by):
    print('Seeding inspection template...')
    template = InspectionTemplate(
        name='Truck Pre-Trip Inspection',
        description='Standard pre-trip vehicle inspection checklist',
        is_active=True,
        created_by=created_by,
        updated_by=created_by,
    )
    session.add(template)
    session.flush()

    for section_name, order, items in INSPECTION_SECTIONS:
        section = InspectionSection(
            template_id=template.id,
            name=section_name,
            display_order=order,
            created_by=created_by,
            updated_by=created_by,
        )
        session.add(section)
        session.flush()
        for i, label in enumerate(items, 1):
            session.add(InspectionItem(
                section_id=section.id,
                label=label,
                display_order=i,
                created_by=created_by,
                updated_by=created_by,
            ))

    session.commit()
    total_items = sum(len(items) for _, _, items in INSPECTION_SECTIONS)
    print(f'  [OK] template "{template.name}" — {len(INSPECTION_SECTIONS)} sections, {total_items} items')
    return template


# ── Drive time session ────────────────────────────────────────────────────────

def seed_drive_time(session, contractor_id):
    """Seed a realistic in-progress session for today."""
    print('Seeding drive time session...')

    session_obj = DutySessions(
        contractor_id=contractor_id,
        current_status='driving',
        session_date=date.today(),
        started_at=hours_ago(6),
        is_active=True,
    )
    session.add(session_obj)
    session.flush()

    # Historical log segments
    segments = [
        # status,       start,          end,            duration_s
        ('on_duty',   hours_ago(6),   hours_ago(5.5), int(0.5 * 3600)),
        ('driving',   hours_ago(5.5), hours_ago(3),   int(2.5 * 3600)),
        ('on_duty',   hours_ago(3),   hours_ago(2.75),int(0.25* 3600)),
        ('driving',   hours_ago(2.75),hours_ago(1),   int(1.75* 3600)),
        ('off_duty',  hours_ago(1),   mins_ago(30),   int(0.5 * 3600)),
        # currently active — no end_time
        ('driving',   mins_ago(30),   None,           None),
    ]

    for status, start, end, dur in segments:
        session.add(DutyLogs(
            session_id=session_obj.id,
            contractor_id=contractor_id,
            status=status,
            start_time=start,
            end_time=end,
            duration_seconds=dur,
        ))

    session.commit()
    # driving total: 2.5 + 1.75 = 4.25 hrs of closed segments + 30 min active
    print(f'  [OK] session id {session_obj.id} — status: driving, ~4h 45m drive time today')
    return session_obj


# ── Main ──────────────────────────────────────────────────────────────────────

def seed():
    with app.app_context():
        # Note: data wipe was removed after the May-2026 shared-DB incident.
        # Seeding now only INSERTs. If you need a clean slate, drop the local
        # SQLite file (`backend/instance/app.db`) and let db.create_all() run.
        vendor_auth, vendor, contractor_auth, contractor = seed_users(db.session)
        seed_inspection_template(db.session, created_by=vendor_auth.id)
        seed_drive_time(db.session, contractor.id)
        # seed_tickets is intentionally absent. Tickets/Work_orders schema is
        # still in flux on team Supabase — add back once the columns are stable.

        print()
        print('=' * 50)
        print('Dev seed complete!')
        print('  Login -- username: aldo   password: 123456')
        print('=' * 50)


if __name__ == '__main__':
    # ── Safety guard ────────────────────────────────────────────────────────
    # The May-2026 incident happened when seed scripts ran against the shared
    # Render/Supabase DB. wipe() has been removed, but seeding can still
    # create duplicate / conflicting rows on a populated shared DB and may
    # leak demo passwords into prod. Block any non-SQLite target unless
    # explicitly opted in.
    db_url = os.environ.get('DATABASE_URL', '')
    if db_url and not db_url.startswith('sqlite'):
        if os.environ.get('ALLOW_DESTRUCTIVE_SEED') != '1':
            print('=' * 60)
            print('REFUSING TO RUN: DATABASE_URL points at a remote database.')
            print()
            print('  DATABASE_URL =', db_url.split('@')[-1])  # show host only
            print()
            print('To run anyway, set ALLOW_DESTRUCTIVE_SEED=1 in your env.')
            print('Coordinate with the team lead first — see DATABASE_SAFETY.md.')
            print('=' * 60)
            raise SystemExit(1)

    seed()
