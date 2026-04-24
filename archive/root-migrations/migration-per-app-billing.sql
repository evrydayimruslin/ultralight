-- Migration: Per-app billing clocks
-- Moves billing granularity from user-level to per-app/per-page level.
-- Each app/page tracks its own billing clock independently.
-- Publishing sets the clock to NOW(); unpublishing drops it from billing.
--
-- IMPORTANT: Use NOW() for existing published apps because the old user-level
-- billing already charged up to this point. Using first_published_at would
-- double-charge for the overlap period.

-- Apps: per-app billing clock (start from NOW for existing published apps)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS hosting_last_billed_at TIMESTAMPTZ;
UPDATE apps SET hosting_last_billed_at = NOW()
  WHERE hosting_last_billed_at IS NULL AND visibility IN ('public', 'unlisted');

-- Content/pages: per-page billing clock
ALTER TABLE content ADD COLUMN IF NOT EXISTS hosting_last_billed_at TIMESTAMPTZ;
UPDATE content SET hosting_last_billed_at = NOW()
  WHERE hosting_last_billed_at IS NULL AND visibility = 'public' AND type = 'page';
