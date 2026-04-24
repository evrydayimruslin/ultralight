-- ============================================================================
-- Security Warnings Fix Migration
-- Fixes: 49 mutable search_path functions, 1 exposed materialized view,
--        3 always-true RLS policies
--
-- SKIPPED (intentionally):
--   - Moving vector extension out of public (too many dependencies, low risk)
--   - Leaked password protection (dashboard toggle, not SQL)
--
-- REVERSIBILITY: Every change here can be undone instantly:
--   - search_path: ALTER FUNCTION ... RESET search_path;
--   - REVOKE: GRANT SELECT ON ... TO anon, authenticated;
--   - DROP POLICY: re-create the policy with USING(true)
-- ============================================================================

-- ============================================================================
-- 1. FIX MUTABLE SEARCH_PATH ON ALL 49 FUNCTIONS
--    Using 'public, extensions' (not '') because 47/49 functions use
--    unqualified table names and 5 use the vector type from public schema.
--    This pins the search path to prevent hijacking while preserving
--    existing behavior.
-- ============================================================================

ALTER FUNCTION public.mark_payout_releasing(UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.cleanup_expired_provisionals() SET search_path = 'public, extensions';
ALTER FUNCTION public.cleanup_rate_limits() SET search_path = 'public, extensions';
ALTER FUNCTION public.record_sale_fingerprint(UUID, UUID, UUID, UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.update_content_like_counts() SET search_path = 'public, extensions';
ALTER FUNCTION public.cleanup_stale_oauth_clients() SET search_path = 'public, extensions';
ALTER FUNCTION public.accept_bid(UUID, UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_user_profile_stats(UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.reject_bid(UUID, UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.rollup_call_metrics() SET search_path = 'public, extensions';
ALTER FUNCTION public.adjust_data_storage(UUID, BIGINT) SET search_path = 'public, extensions';
ALTER FUNCTION public.rollup_discovery_metrics() SET search_path = 'public, extensions';
ALTER FUNCTION public.compute_quality_scores() SET search_path = 'public, extensions';
ALTER FUNCTION public.increment_budget_used(UUID, TEXT, TEXT) SET search_path = 'public, extensions';
ALTER FUNCTION public.record_upload_storage(UUID, UUID, TEXT, BIGINT) SET search_path = 'public, extensions';
ALTER FUNCTION public.update_app_embedding(UUID, vector) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_analytics_summary(INT) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_platform_stats() SET search_path = 'public, extensions';
ALTER FUNCTION public.update_app_like_counts() SET search_path = 'public, extensions';
ALTER FUNCTION public.rollup_impressions() SET search_path = 'public, extensions';
ALTER FUNCTION public.check_http_rate_limit(UUID, INTEGER) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_releasable_payouts() SET search_path = 'public, extensions';
ALTER FUNCTION public.create_payout_record(UUID, FLOAT, FLOAT, FLOAT) SET search_path = 'public, extensions';
ALTER FUNCTION public.search_content(vector, UUID, TEXT[], TEXT, INTEGER) SET search_path = 'public, extensions';
ALTER FUNCTION public.check_data_storage_quota(UUID, BIGINT) SET search_path = 'public, extensions';
ALTER FUNCTION public.refresh_gpu_reliability() SET search_path = 'public, extensions';
ALTER FUNCTION public.escrow_bid(UUID, UUID, INT, TEXT, TIMESTAMPTZ) SET search_path = 'public, extensions';
ALTER FUNCTION public.increment_app_runs(UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_weekly_usage(UUID, TIMESTAMPTZ) SET search_path = 'public, extensions';
ALTER FUNCTION public.cleanup_http_requests() SET search_path = 'public, extensions';
ALTER FUNCTION public.check_rate_limit(UUID, TEXT, INTEGER, INTEGER) SET search_path = 'public, extensions';
ALTER FUNCTION public.search_apps(vector, UUID, INTEGER, INTEGER) SET search_path = 'public, extensions';
ALTER FUNCTION public.ensure_user_exists(UUID, TEXT, TEXT, TEXT) SET search_path = 'public, extensions';
ALTER FUNCTION public.transfer_balance(UUID, UUID, FLOAT) SET search_path = 'public, extensions';
ALTER FUNCTION public.increment_caller_usage(UUID, UUID, TEXT) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_leaderboard(TEXT, INT) SET search_path = 'public, extensions';
ALTER FUNCTION public.credit_balance(UUID, FLOAT) SET search_path = 'public, extensions';
ALTER FUNCTION public.merge_provisional_user(UUID, UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.cancel_bid(UUID, UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.count_provisional_by_ip(TEXT, INT) SET search_path = 'public, extensions';
ALTER FUNCTION public.debit_balance(UUID, FLOAT, BOOLEAN) SET search_path = 'public, extensions';
ALTER FUNCTION public.search_content_fusion(vector, TEXT, UUID, TEXT[], TEXT, INTEGER) SET search_path = 'public, extensions';
ALTER FUNCTION public.expire_old_bids() SET search_path = 'public, extensions';
ALTER FUNCTION public.get_user_allowed_functions(UUID, UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.increment_weekly_calls(UUID, TIMESTAMPTZ) SET search_path = 'public, extensions';
ALTER FUNCTION public.get_app_granted_users(UUID) SET search_path = 'public, extensions';
ALTER FUNCTION public.check_seller_relist(UUID, TEXT) SET search_path = 'public, extensions';
ALTER FUNCTION public.fail_payout_refund(UUID, TEXT) SET search_path = 'public, extensions';
-- debit_hosting_balance was dropped in migration-light-currency.sql (replaced by debit_balance)

-- ============================================================================
-- 2. RESTRICT MATERIALIZED VIEW gpu_reliability_7d
--    Currently selectable by anon/authenticated via PostgREST API.
--    This is server-side infrastructure data — only service_role needs it.
-- ============================================================================

REVOKE SELECT ON public.gpu_reliability_7d FROM anon, authenticated;

-- ============================================================================
-- 3. FIX ALWAYS-TRUE RLS POLICIES
--    These policies use USING(true) / WITH CHECK(true) which lets ANY role
--    (including anon) perform the operation. Since service_role bypasses RLS
--    entirely, these policies are redundant — dropping them removes the
--    unintended anon/authenticated access without affecting server-side code.
-- ============================================================================

-- http_requests: INSERT WITH CHECK (true) — lets anon insert request logs
DROP POLICY IF EXISTS "Service role can insert http requests" ON public.http_requests;

-- oauth_clients: ALL USING (true) — lets anon read/write OAuth clients
DROP POLICY IF EXISTS "Service role full access" ON public.oauth_clients;

-- oauth_consents: ALL USING (true) — lets anon read/write OAuth consents
DROP POLICY IF EXISTS "Service role full access" ON public.oauth_consents;

-- ============================================================================
-- REMAINING WARNINGS (manual action required):
--
-- 1. vector extension in public schema — LOW RISK, skip for now.
--    Moving it would require updating 5 function signatures + all vector
--    queries. The risk of an attacker shadowing the vector extension is
--    minimal since only service_role creates objects in public.
--
-- 2. Leaked password protection — DASHBOARD TOGGLE:
--    Supabase Dashboard → Authentication → Settings → Password Security
--    Toggle "Leaked password protection" ON
-- ============================================================================
