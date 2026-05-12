# DEMO_REVERT — production cutover checklist

This PR carries client-demo conveniences alongside the real work. Everything
listed below MUST be reverted or reconfigured before this branch ships to
real users behind real authentication. Each item is gated behind a flag or
isolated to a single file so the flip is mechanical, not a code rewrite.

## Hard flips (security-relevant)

### 1. `frontend/field-force-contractor/constants/showcase.ts`

`SHOWCASE_MODE` is hardcoded `true` in this PR so the demo runs without real
biometric hardware or real GPS proximity. Set to `false` (or swap for the
env-driven form documented in the file's header comment) before any build
that touches real client data.

What flips when `SHOWCASE_MODE === true`:

- **Accept Ticket** (`TicketDetailScreen.handleAcceptTask`) short-circuits to
  `navigation.goBack()`. The inspection forced-nav and the GPS permission
  prompt are skipped.
- **Start Task** (`TicketDetailScreen.handleStartTask`) runs a two-tap demo.
  First tap shows an `Alert` with the "you must be within 100 feet of the
  site" proximity message so the audience sees the gate exists. Second tap
  bypasses the biometric / PIN / location / PPE chain entirely and flips
  the ticket to `IN_PROGRESS` with the task's site coordinates as the demo
  start location.

The production path (real biometric, real PIN, real GPS proximity, real PPE
checklist) lives below each `if (SHOWCASE_MODE)` block in
`TicketDetailScreen.tsx` and runs unchanged when the flag is off.

## Soft cleanups (cosmetic / data)

### 2. Demo fallback contact

If `/contractors/contacts` returns nothing useful, `ContactScreen` falls
back to the hardcoded `demoUsers` list in `contexts/AppContext.tsx` (John
Doe / Jane Doe / Taylor Swith / Ben Joe with 555 numbers). Once the shared
Supabase has enough real `auth_user` rows with `contact_number` populated,
the fallback should never fire in practice, but the demo data still ships
in the bundle. Acceptable for production; only relevant if you want a
truly empty Contacts screen when the backend is unreachable.

### 3. Demo POC placeholder

`TicketDetailScreen` falls back to `John Martinez / +1 (555) 012-3456`
when neither the client primary contact nor the vendor primary contact is
populated on the joined ticket row. Same situation as #2 — only fires when
the shared DB lacks the data. Acceptable for production; reviewer should
just be aware so the placeholder doesn't ship as visible text in a real
demo to a different client.

### 4. Hardcoded SF map pin fallback

`TicketDetailScreen` falls back to `{ lat: 37.7749, lng: -122.4194 }` when
`work_order.latitude` / `longitude` are null. Same shape as #2 / #3.

## Backend changes that DO NOT need reverting

These ship as-is to production:

- `GET /contractors/contacts` (new endpoint, real query).
- `GET /contractors/assigned-tickets` augmented response with
  `client_contact_*`, `vendor_contact_*`, `site_latitude`,
  `site_longitude`, `site_location` joined from `work_order` / `client` /
  `vendor`. No schema change — pure JOIN-and-augment.

## Quick verification before merging

```bash
# 1. SHOWCASE_MODE off?
grep -n "export const SHOWCASE_MODE" frontend/field-force-contractor/constants/showcase.ts
# Expected: export const SHOWCASE_MODE: boolean = false;

# 2. No leftover ngrok URLs in the diff?
git diff main..HEAD -- frontend/field-force-contractor/utils/api.ts | grep -i "ngrok"
# Expected: empty.

# 3. Real biometric + PIN + location chain runs?
# Manual: launch app, tap Start Task, confirm verification modal opens
# at the biometric step (NOT the proximity Alert).
```
