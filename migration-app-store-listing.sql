-- Migration: App Store public listing fields
-- Run AFTER: migration-platform-mcp-v2.sql (which added apps.visibility, tags, category, etc.)
--
-- Adds fields needed for the unified /app/:id store page that the developer
-- can edit from the new "App Store" tab in the app admin dashboard.
--
-- screenshots: ordered array of R2 storage keys. Shape: ["apps/{id}/media/screenshot-0-{ts}.png", ...]
--              Capped client-side at 6 entries. Server enforces the cap in POST /screenshots.
-- long_description: markdown body rendered below the hero on /app/:id.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS screenshots JSONB DEFAULT '[]'::jsonb;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS long_description TEXT;

-- Backfill any pre-existing NULL rows to the empty-array default so readers
-- can unconditionally treat the column as an array.
UPDATE apps SET screenshots = '[]'::jsonb WHERE screenshots IS NULL;

-- Enforce NOT NULL after backfill (defensive against future accidental NULLs).
ALTER TABLE apps ALTER COLUMN screenshots SET NOT NULL;
ALTER TABLE apps ALTER COLUMN screenshots SET DEFAULT '[]'::jsonb;
