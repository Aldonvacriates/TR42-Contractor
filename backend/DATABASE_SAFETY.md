# ⚠️ Shared Database Safety — Read Before Running Anything

After the **May-2026 drop-tables incident on Render**, we need everyone on the
team following the same rules so we don't lose work again. The team's shared
Postgres now lives on Supabase (managed by Daniel).

---

## The rules

### ✅ Do
- **Pull the latest `main`** before running the backend.
- **Use the shared `DATABASE_URL`** Daniel posts in chat — paste it into your
  local `backend/.env`. That file is gitignored on purpose.
- **Use the app normally** to add/edit data on the shared DB.
- **Want to experiment / wipe / reseed?** Use a *local* SQLite DB. Leave
  `RENDER` unset and remove `DATABASE_URL` from your `.env`. Flask falls
  back to `sqlite:///app.db`, which is your own personal file.

### ❌ Don't
- ❌ **Don't run `python seed_dev.py`** against the shared DB. It is now
  guarded (`ALLOW_DESTRUCTIVE_SEED=1` required) and `wipe()` is commented
  out — but don't try to bypass either without team sign-off.
- ❌ **Don't run any script with `db.drop_all()`, `TRUNCATE`, or
  `DROP TABLE`** against the shared DB.
- ❌ **Don't push schema migrations** (new tables, dropped columns,
  renamed columns) without telling Daniel first. He owns schema.
- ❌ **Don't paste `DATABASE_URL` in commits, screenshots, or public
  channels.** Treat it like a password.
- ❌ **Don't change `flask_app.py`'s `db.create_all()` line** — it only
  *adds* missing tables, never drops.

---

## What's protected in code

- `backend/seed_dev.py`
  - `wipe()` function has been **removed entirely**. The script now only
    INSERTs — no `TRUNCATE`, no `DROP`, no `DELETE`. If you need a clean
    slate locally, delete `backend/instance/app.db` and restart Flask.
  - `__main__` block still refuses to run if `DATABASE_URL` points at a
    non-SQLite DB unless `ALLOW_DESTRUCTIVE_SEED=1` is set, since seeding a
    populated shared DB can still create unique-constraint violations and
    leak demo credentials.
- `backend/tests/conftest.py`
  - The `_db.drop_all()` call only runs against `sqlite:///:memory:` (an
    in-memory pytest fixture that lives for the duration of a single test).
    It cannot affect any persistent database. Safe by design — leave alone.
- No other backend code contains `drop_all`, `DROP TABLE`, `TRUNCATE`, or
  unscoped `DELETE FROM` statements.

---

## If you suspect data was lost

1. **Stop running scripts immediately.**
2. Tell Daniel + the team channel.
3. Supabase Dashboard → **Database → Backups**. Even on the free tier you can
   often roll back to a recent point. Don't try to "fix it" with another seed
   script — that's how the first incident got worse.

---

## Who owns what

| Area                            | Owner   |
|---------------------------------|---------|
| Shared Supabase project         | Daniel  |
| Schema changes / migrations     | Daniel  |
| Render deploy + env vars        | Aldo    |
| Frontend / offline mode         | Aldo    |
| Auth screens                    | Troy    |
| Tickets, drive-time             | (team)  |

Ping the owner before changing anything in their area.
