-- supabase_password_reset_token.sql
--
-- Creates the password_reset_token table on Supabase for the forgot-password
-- flow added in feat/reset-password. Without this table the deployed backend
-- 500s on the first /auth/forgot-password call with
-- `relation "password_reset_token" does not exist`.
--
-- Why this exists
--   seed_dev.py is guarded against running on the shared Supabase after the
--   May-2026 incident, so new SQLAlchemy models do not auto-create their
--   tables in production. Each new table needs an explicit one-shot SQL
--   helper here, matching the pattern from supabase_demo_map_coords.sql.
--
-- How to run
--   1. Open Supabase project -> SQL Editor.
--   2. Paste this file, hit Run. Idempotent: CREATE TABLE IF NOT EXISTS and
--      CREATE INDEX IF NOT EXISTS, so re-running is a no-op.
--   3. Confirm the sanity-check query at the bottom returns one row.
--
-- Schema mirrors backend/app/models.py::PasswordResetToken so SQLAlchemy
-- reflection lines up with the live table.

CREATE TABLE IF NOT EXISTS password_reset_token (
    id           VARCHAR PRIMARY KEY,
    auth_user_id VARCHAR NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    hashed_token VARCHAR(400) NOT NULL,
    is_used      BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_hashed
    ON password_reset_token(hashed_token);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_user
    ON password_reset_token(auth_user_id);

-- Sanity check: should return one row describing the table.
SELECT
    table_name,
    (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'password_reset_token') AS column_count
FROM information_schema.tables
WHERE table_name = 'password_reset_token';
