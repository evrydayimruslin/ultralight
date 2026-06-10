-- Migration: Persist OAuth authorization codes to Supabase
-- Previously stored in-memory (lost on restart, breaks multi-instance)
-- Codes are short-lived (5 min) and one-time use

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL DEFAULT 'S256',
    supabase_access_token TEXT NOT NULL,
    supabase_refresh_token TEXT,
    user_id UUID NOT NULL,
    user_email TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'mcp:read mcp:write',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes'
);

-- Index for cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expires ON oauth_authorization_codes(expires_at);
