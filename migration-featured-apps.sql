-- Migration: Featured Apps
-- Adds featured_at column for admin-curated featured apps on marketplace.
-- Apps with featured_at set are shown in a "Featured" section on the marketplace browse page.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

-- Partial index: only featured apps, sorted by most recently featured first
CREATE INDEX IF NOT EXISTS idx_apps_featured ON apps (featured_at DESC NULLS LAST) WHERE featured_at IS NOT NULL;
