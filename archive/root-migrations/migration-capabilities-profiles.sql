-- Migration: Capabilities & Profiles
-- Adds user country, featured capability, profile slugs, and leaderboard/stats RPC functions

-- 1. User profile fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS featured_app_id UUID REFERENCES apps(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_profile_slug
  ON users(profile_slug) WHERE profile_slug IS NOT NULL;

-- 2. Leaderboard RPC — returns highest-grossing profiles for a given time period
--    Combines tool_call/page_view revenue from transfers + seller payouts from app_sales
CREATE OR REPLACE FUNCTION get_leaderboard(p_interval TEXT DEFAULT '30d', p_limit INT DEFAULT 20)
RETURNS TABLE(
  user_id UUID,
  display_name TEXT,
  profile_slug TEXT,
  avatar_url TEXT,
  country TEXT,
  earnings_cents BIGINT,
  featured_app_id UUID,
  featured_app_name TEXT,
  featured_app_slug TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_interval INTERVAL;
BEGIN
  -- Parse interval string (1d, 7d, 30d, 90d, 365d, at)
  CASE p_interval
    WHEN '1d'   THEN v_interval := INTERVAL '1 day';
    WHEN '7d'   THEN v_interval := INTERVAL '7 days';
    WHEN '30d'  THEN v_interval := INTERVAL '30 days';
    WHEN '90d'  THEN v_interval := INTERVAL '90 days';
    WHEN '365d' THEN v_interval := INTERVAL '365 days';
    WHEN 'at'   THEN v_interval := INTERVAL '100 years'; -- effectively all-time
    ELSE v_interval := INTERVAL '30 days';
  END CASE;

  RETURN QUERY
  WITH earnings AS (
    -- Revenue from tool calls and page views
    SELECT t.to_user_id AS uid, SUM(t.amount_cents)::BIGINT AS earned
    FROM transfers t
    WHERE t.reason IN ('tool_call', 'page_view')
      AND t.created_at >= NOW() - v_interval
    GROUP BY t.to_user_id

    UNION ALL

    -- Revenue from marketplace sales (seller payout)
    SELECT s.seller_id AS uid, SUM(s.seller_payout_cents)::BIGINT AS earned
    FROM app_sales s
    WHERE s.created_at >= NOW() - v_interval
    GROUP BY s.seller_id
  ),
  ranked AS (
    SELECT e.uid, SUM(e.earned)::BIGINT AS total_earned
    FROM earnings e
    GROUP BY e.uid
    HAVING SUM(e.earned) > 0
    ORDER BY total_earned DESC
    LIMIT p_limit
  )
  SELECT
    r.uid AS user_id,
    u.display_name,
    u.profile_slug,
    u.avatar_url,
    u.country,
    r.total_earned AS earnings_cents,
    u.featured_app_id,
    a.name AS featured_app_name,
    a.slug AS featured_app_slug
  FROM ranked r
  JOIN users u ON u.id = r.uid
  LEFT JOIN apps a ON a.id = u.featured_app_id AND a.deleted_at IS NULL
  ORDER BY r.total_earned DESC;
END;
$$;

-- 3. Platform stats RPC — returns aggregate metrics for ticker tape
CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_gmv_30d BIGINT;
  v_gmv_prev BIGINT;
  v_acq_30d INT;
  v_acq_prev INT;
  v_capabilities INT;
  v_gmv_change_pct FLOAT;
  v_acq_change INT;
BEGIN
  -- GMV last 30 days (total sale prices)
  SELECT COALESCE(SUM(sale_price_cents), 0) INTO v_gmv_30d
  FROM app_sales WHERE created_at >= NOW() - INTERVAL '30 days';

  -- GMV previous 30 days (for change %)
  SELECT COALESCE(SUM(sale_price_cents), 0) INTO v_gmv_prev
  FROM app_sales WHERE created_at >= NOW() - INTERVAL '60 days'
    AND created_at < NOW() - INTERVAL '30 days';

  -- Acquisitions last 30 days
  SELECT COUNT(*) INTO v_acq_30d
  FROM app_sales WHERE created_at >= NOW() - INTERVAL '30 days';

  -- Acquisitions previous 30 days
  SELECT COUNT(*) INTO v_acq_prev
  FROM app_sales WHERE created_at >= NOW() - INTERVAL '60 days'
    AND created_at < NOW() - INTERVAL '30 days';

  -- Total public capabilities
  SELECT COUNT(*) INTO v_capabilities
  FROM apps WHERE visibility = 'public' AND deleted_at IS NULL;

  -- Calculate change percentage
  IF v_gmv_prev > 0 THEN
    v_gmv_change_pct := ROUND(((v_gmv_30d - v_gmv_prev)::FLOAT / v_gmv_prev) * 100, 1);
  ELSE
    v_gmv_change_pct := 0;
  END IF;

  v_acq_change := v_acq_30d - v_acq_prev;

  RETURN jsonb_build_object(
    'gmv_30d_cents', v_gmv_30d,
    'gmv_change_pct', v_gmv_change_pct,
    'acquisitions_30d', v_acq_30d,
    'acquisitions_change', v_acq_change,
    'capabilities_listed', v_capabilities
  );
END;
$$;

-- 4. User profile stats helper — returns public profile data for a user
CREATE OR REPLACE FUNCTION get_user_profile_stats(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lifetime_gross BIGINT;
  v_published INT;
  v_acquired INT;
BEGIN
  -- Lifetime gross (total_earned_cents from users table)
  SELECT COALESCE(u.total_earned_cents, 0)::BIGINT INTO v_lifetime_gross
  FROM users u WHERE u.id = p_user_id;

  -- Published count
  SELECT COUNT(*) INTO v_published
  FROM apps WHERE owner_id = p_user_id AND visibility = 'public' AND deleted_at IS NULL;

  -- Acquired count (apps bought)
  SELECT COUNT(*) INTO v_acquired
  FROM app_sales WHERE buyer_id = p_user_id;

  RETURN jsonb_build_object(
    'lifetime_gross_cents', v_lifetime_gross,
    'published_count', v_published,
    'acquired_count', v_acquired
  );
END;
$$;
