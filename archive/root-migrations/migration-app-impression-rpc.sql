-- Migration: Atomic app impression counter
-- Run AFTER: migration-discovery-metrics.sql (which added impressions_total)
--
-- Why an RPC: raw PATCH on impressions_total would race under concurrent
-- visits (lost updates). This atomic SQL UPDATE +=1 avoids the race.
-- Used by handlePublicAppPage() on every non-bot /app/:id visit.

CREATE OR REPLACE FUNCTION increment_app_impression(app_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE apps
  SET impressions_total = COALESCE(impressions_total, 0) + 1,
      impressions_7d    = COALESCE(impressions_7d, 0) + 1
  WHERE id = app_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pin search_path for security (matches pattern in migration-security-warnings.sql)
ALTER FUNCTION public.increment_app_impression(UUID) SET search_path = 'public, extensions';
