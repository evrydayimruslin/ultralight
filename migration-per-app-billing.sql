-- Migration: Per-app billing clocks
-- Moves billing granularity from user-level to per-app/per-page level.
-- Each app/page tracks its own billing clock independently.
-- Publishing sets the clock to NOW(); unpublishing drops it from billing.

-- Apps: per-app billing clock (initialized to first_published_at if available, else NOW())
ALTER TABLE apps ADD COLUMN IF NOT EXISTS hosting_last_billed_at TIMESTAMPTZ;
UPDATE apps SET hosting_last_billed_at = COALESCE(first_published_at, created_at)
  WHERE hosting_last_billed_at IS NULL AND visibility IN ('public', 'unlisted');

-- Content/pages: per-page billing clock
ALTER TABLE content ADD COLUMN IF NOT EXISTS hosting_last_billed_at TIMESTAMPTZ;
UPDATE content SET hosting_last_billed_at = COALESCE(created_at, NOW())
  WHERE hosting_last_billed_at IS NULL AND visibility = 'public' AND type = 'page';
