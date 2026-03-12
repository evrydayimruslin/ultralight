-- Migration: Add permanent had_external_db flag to apps
-- Once a Supabase connection is made, the app is permanently ineligible for marketplace trading.
-- This prevents disconnecting an external DB to sell a broken app.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS had_external_db BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any app currently connected to Supabase gets flagged
UPDATE apps SET had_external_db = true
  WHERE had_external_db = false
    AND (supabase_enabled = true OR supabase_config_id IS NOT NULL);
