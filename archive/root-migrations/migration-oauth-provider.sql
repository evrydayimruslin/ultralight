-- Migration: OAuth Provider (Developer Portal + Scopes + Consent)
-- Run AFTER: migration-oauth-clients.sql, migration-oauth-auth-codes.sql
-- Adds: developer-owned OAuth apps, client secrets, consent tracking
-- Purpose: Turn Ultralight into a turnkey "Login with Ultralight" OAuth provider

-- ============================================
-- 1. EXTEND OAUTH_CLIENTS FOR DEVELOPER APPS
-- ============================================
-- Distinguishes MCP dynamic clients (auto-cleanup after 30 days)
-- from developer-registered apps (persist forever, have secrets + owners).

ALTER TABLE oauth_clients
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS client_secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS client_secret_salt TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_developer_app BOOLEAN DEFAULT FALSE;

-- Index for developer portal: list apps by owner
CREATE INDEX IF NOT EXISTS idx_oauth_clients_owner
  ON oauth_clients(owner_user_id) WHERE owner_user_id IS NOT NULL;

-- ============================================
-- 2. UPDATE CLEANUP TO SKIP DEVELOPER APPS
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_stale_oauth_clients()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM oauth_clients
    WHERE created_at < NOW() - INTERVAL '30 days'
      AND is_developer_app = FALSE;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. CONSENT TRACKING TABLE
-- ============================================
-- Records which users have consented to which developer apps.
-- UNIQUE(user_id, client_id) means one consent record per pair;
-- re-authorization with broader scopes upserts.

CREATE TABLE IF NOT EXISTS oauth_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    scopes TEXT[] NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    UNIQUE(user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_consents_user
  ON oauth_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_consents_client
  ON oauth_consents(client_id);

ALTER TABLE oauth_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
    ON oauth_consents FOR ALL
    USING (true);

COMMENT ON TABLE oauth_consents IS 'Tracks user consent grants to third-party OAuth applications';
COMMENT ON COLUMN oauth_clients.owner_user_id IS 'NULL = MCP dynamic client (auto-cleanup). Non-null = developer-registered app (persists)';
COMMENT ON COLUMN oauth_clients.is_developer_app IS 'TRUE for developer portal-created apps, FALSE for MCP dynamic registration';
COMMENT ON COLUMN oauth_clients.client_secret_hash IS 'HMAC-SHA256 hash of client secret (uls_xxx format). NULL for MCP dynamic clients.';
