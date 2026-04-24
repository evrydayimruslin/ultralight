-- ============================================================================
-- RLS Lockdown Migration
-- Fixes: 42 Supabase Security Advisor errors (38 RLS disabled + 4 sensitive columns exposed)
--
-- SAFE: Backend uses service_role key which bypasses RLS entirely.
--       This migration only restricts access via the anon key / user JWTs.
-- ============================================================================

-- ============================================================================
-- 1. ENABLE RLS ON ALL PUBLIC TABLES
--    (idempotent — safe to re-run even if already enabled)
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_supabase_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_app_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_supabase_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_content_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_content_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_code_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_impressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_caller_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_call_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supabase_oauth_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gpu_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gpu_rate_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gpu_build_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appstore_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shortcomings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gap_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. USER-OWNED TABLES — users can CRUD their own rows
--    (DROP IF EXISTS to make idempotent with existing migration policies)
-- ============================================================================

-- users: own profile
DROP POLICY IF EXISTS users_own ON public.users;
CREATE POLICY users_own ON public.users
  FOR ALL USING (auth.uid() = id);

-- apps: owner can manage, public apps readable by all authenticated users
DROP POLICY IF EXISTS apps_owner ON public.apps;
CREATE POLICY apps_owner ON public.apps
  FOR ALL USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS apps_public_read ON public.apps;
CREATE POLICY apps_public_read ON public.apps
  FOR SELECT USING (visibility = 'public');

-- memory: user's own memory entries
DROP POLICY IF EXISTS memory_own ON public.memory;
CREATE POLICY memory_own ON public.memory
  FOR ALL USING (auth.uid() = user_id);

-- content: owner can manage, public content readable by all
DROP POLICY IF EXISTS content_owner ON public.content;
CREATE POLICY content_owner ON public.content
  FOR ALL USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS content_public_read ON public.content;
CREATE POLICY content_public_read ON public.content
  FOR SELECT USING (visibility = 'public');

-- user_supabase_configs: own configs
DROP POLICY IF EXISTS user_supabase_configs_own ON public.user_supabase_configs;
CREATE POLICY user_supabase_configs_own ON public.user_supabase_configs
  FOR ALL USING (auth.uid() = user_id);

-- user_app_permissions: permissions granted TO this user
DROP POLICY IF EXISTS user_app_permissions_own ON public.user_app_permissions;
CREATE POLICY user_app_permissions_own ON public.user_app_permissions
  FOR SELECT USING (auth.uid() = granted_to_user_id OR auth.uid() = granted_by_user_id);

-- user_supabase_oauth: own OAuth tokens
DROP POLICY IF EXISTS user_supabase_oauth_own ON public.user_supabase_oauth;
CREATE POLICY user_supabase_oauth_own ON public.user_supabase_oauth
  FOR ALL USING (auth.uid() = user_id);

-- user_content_library: own saved content
DROP POLICY IF EXISTS user_content_library_own ON public.user_content_library;
CREATE POLICY user_content_library_own ON public.user_content_library
  FOR ALL USING (auth.uid() = user_id);

-- user_content_blocks: own blocked content
DROP POLICY IF EXISTS user_content_blocks_own ON public.user_content_blocks;
CREATE POLICY user_content_blocks_own ON public.user_content_blocks
  FOR ALL USING (auth.uid() = user_id);

-- content_likes: own likes
DROP POLICY IF EXISTS content_likes_own ON public.content_likes;
CREATE POLICY content_likes_own ON public.content_likes
  FOR ALL USING (auth.uid() = user_id);

-- content_shares: shared with this user
DROP POLICY IF EXISTS content_shares_own ON public.content_shares;
CREATE POLICY content_shares_own ON public.content_shares
  FOR SELECT USING (auth.uid() = shared_with_user_id);

-- memory_shares: own shares (as owner or recipient)
DROP POLICY IF EXISTS memory_shares_own ON public.memory_shares;
CREATE POLICY memory_shares_own ON public.memory_shares
  FOR ALL USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS memory_shares_recipient ON public.memory_shares;
CREATE POLICY memory_shares_recipient ON public.memory_shares
  FOR SELECT USING (auth.uid() = shared_with_user_id);

-- ============================================================================
-- 3. BILLING / FINANCIAL — users can read their own, writes via service_role only
-- ============================================================================

-- billing_transactions: read own
DROP POLICY IF EXISTS billing_transactions_own ON public.billing_transactions;
CREATE POLICY billing_transactions_own ON public.billing_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- transfers: read own (sent or received)
DROP POLICY IF EXISTS transfers_own ON public.transfers;
CREATE POLICY transfers_own ON public.transfers
  FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- payouts: read own
DROP POLICY IF EXISTS payouts_own ON public.payouts;
CREATE POLICY payouts_own ON public.payouts
  FOR SELECT USING (auth.uid() = user_id);

-- points_ledger: read own
DROP POLICY IF EXISTS points_ledger_own ON public.points_ledger;
CREATE POLICY points_ledger_own ON public.points_ledger
  FOR SELECT USING (auth.uid() = user_id);

-- weekly_call_usage: read own
DROP POLICY IF EXISTS weekly_call_usage_own ON public.weekly_call_usage;
CREATE POLICY weekly_call_usage_own ON public.weekly_call_usage
  FOR SELECT USING (auth.uid() = user_id);

-- app_caller_usage: read own
DROP POLICY IF EXISTS app_caller_usage_own ON public.app_caller_usage;
CREATE POLICY app_caller_usage_own ON public.app_caller_usage
  FOR SELECT USING (auth.uid() = user_id);

-- mcp_call_logs: read own
DROP POLICY IF EXISTS mcp_call_logs_own ON public.mcp_call_logs;
CREATE POLICY mcp_call_logs_own ON public.mcp_call_logs
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- 4. MARKETPLACE — participants can read relevant records
-- ============================================================================

-- app_listings: public read (marketplace is public), owner can manage
DROP POLICY IF EXISTS app_listings_public_read ON public.app_listings;
CREATE POLICY app_listings_public_read ON public.app_listings
  FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS app_listings_owner ON public.app_listings;
CREATE POLICY app_listings_owner ON public.app_listings
  FOR ALL USING (auth.uid() = owner_id);

-- app_bids: bidder can see own bids
DROP POLICY IF EXISTS app_bids_own ON public.app_bids;
CREATE POLICY app_bids_own ON public.app_bids
  FOR ALL USING (auth.uid() = bidder_id);

-- app_sales: buyer or seller can see
DROP POLICY IF EXISTS app_sales_own ON public.app_sales;
CREATE POLICY app_sales_own ON public.app_sales
  FOR SELECT USING (auth.uid() = seller_id OR auth.uid() = buyer_id);

-- app_code_fingerprints: buyer or seller can see
DROP POLICY IF EXISTS app_code_fingerprints_own ON public.app_code_fingerprints;
CREATE POLICY app_code_fingerprints_own ON public.app_code_fingerprints
  FOR SELECT USING (auth.uid() = seller_id OR auth.uid() = buyer_id);

-- ============================================================================
-- 5. PUBLIC READ-ONLY TABLES (platform config, discovery)
-- ============================================================================

-- seasons: public read (leaderboard/points info)
DROP POLICY IF EXISTS seasons_public_read ON public.seasons;
CREATE POLICY seasons_public_read ON public.seasons
  FOR SELECT USING (true);

-- gaps: public read (bounty board)
DROP POLICY IF EXISTS gaps_public_read ON public.gaps;
CREATE POLICY gaps_public_read ON public.gaps
  FOR SELECT USING (true);

-- gpu_rate_table: public read (pricing info)
DROP POLICY IF EXISTS gpu_rate_table_public_read ON public.gpu_rate_table;
CREATE POLICY gpu_rate_table_public_read ON public.gpu_rate_table
  FOR SELECT USING (true);

-- ============================================================================
-- 6. SERVER-ONLY TABLES — no anon/JWT access at all
--    (RLS enabled but no policies = only service_role can access)
-- ============================================================================

-- These tables have RLS enabled above but NO policies, so only service_role
-- can read/write them. This is intentional:
--
--   app_config            — platform configuration
--   app_health_events     — server health tracking
--   app_impressions       — analytics (no user_id)
--   appstore_queries      — search analytics (anonymous)
--   conversion_events     — conversion tracking
--   gap_assessments       — assessment pipeline
--   gpu_endpoints         — GPU infrastructure
--   gpu_build_events      — GPU build logs
--   oauth_authorization_codes — OAuth flow state
--   onboarding_requests   — anonymous onboarding
--   pending_permissions   — pre-signup invites
--   shortcomings          — agent-reported gaps
--   supabase_oauth_state  — PKCE state
--
-- If any of these need authenticated user access in the future,
-- add specific policies then.

-- ============================================================================
-- 7. VERIFY: Check that all tables now have RLS enabled
-- ============================================================================
-- Run this query after migration to verify:
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
