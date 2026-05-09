-- supabase_demo_map_coords.sql
--
-- One-shot SQL helper to give the Tickets-on-Map showcase visible pins on a
-- populated Supabase. Updates existing `work_order` rows that are linked to
-- assigned tickets but have no coordinates yet, stamping them with realistic
-- Austin-metro lat/lng + a "Site …" label.
--
-- Why this exists
--   The repo's seed_dev.py is guarded against running on the shared Supabase
--   after the May-2026 incident. That guard is correct but means new schema
--   columns (work_order.latitude, work_order.longitude, work_order.location)
--   stay NULL on Supabase even after seed_dev.py is updated.
--
--   The MapScreen only renders pins for tickets whose work_order has lat/lng.
--   Without this update the showcase map would be empty even though the
--   Tickets list shows real data.
--
-- How to run
--   1. Open Supabase project -> SQL Editor.
--   2. Paste this file, hit Run. Idempotent: only updates rows where
--      latitude IS NULL, so re-running is a no-op.
--   3. Confirm in MapScreen on the deployed app — pins should appear.
--
-- Coordinates clustered around Austin, TX so the demo sits on a coherent
-- region instead of dots scattered across the country.

WITH demo_sites(rn, lat, lng, label) AS (
    VALUES
        (1, 30.2672, -97.7431, 'Site A — Downtown'),
        (2, 30.3105, -97.7220, 'Site B — North Loop'),
        (3, 30.2402, -97.7140, 'Site C — East Riverside'),
        (4, 30.2419, -97.7813, 'Site D — South Lamar'),
        (5, 30.4083, -97.6680, 'Site E — Round Rock'),
        (6, 30.2960, -97.8120, 'Site F — West Lake Hills')
),
candidate_work_orders AS (
    -- Take the 6 most recently assigned tickets that don't yet have map
    -- coords on their underlying work_order. Limits blast radius: even if
    -- there are hundreds of tickets we only stamp a handful.
    SELECT
        wo.id AS work_order_id,
        ROW_NUMBER() OVER (ORDER BY t.assigned_at DESC NULLS LAST, t.created_at DESC) AS rn
    FROM ticket t
    JOIN work_order wo ON wo.id = t.work_order_id
    WHERE wo.latitude IS NULL
      AND t.status IN ('ASSIGNED', 'IN_PROGRESS', 'PENDING_APPROVAL', 'COMPLETED')
    LIMIT 6
)
UPDATE work_order wo
SET
    latitude      = ds.lat,
    longitude     = ds.lng,
    location      = COALESCE(NULLIF(wo.location, ''), ds.label),
    location_type = COALESCE(wo.location_type, 'well_site'),
    updated_at    = NOW()
FROM candidate_work_orders cwo
JOIN demo_sites ds ON ds.rn = cwo.rn
WHERE wo.id = cwo.work_order_id;

-- Quick sanity check after the update.
SELECT id, latitude, longitude, location
FROM work_order
WHERE latitude IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;
