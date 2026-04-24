-- API Tokens Migration
-- Allows users to create personal access tokens for CLI/API access

-- Create the user_api_tokens table
CREATE TABLE IF NOT EXISTS user_api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Store hash of token, not the token itself (token shown once on creation)
    token_prefix TEXT NOT NULL,  -- First 8 chars for identification (ul_xxxx...)
    token_hash TEXT NOT NULL,    -- SHA-256 hash of full token
    scopes TEXT[] DEFAULT ARRAY['*'],  -- Future: granular permissions
    last_used_at TIMESTAMPTZ,
    last_used_ip TEXT,
    expires_at TIMESTAMPTZ,      -- NULL = never expires
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Each user can only have one token with a given name
    UNIQUE(user_id, name)
);

-- Index for fast token lookup during authentication
CREATE INDEX idx_user_api_tokens_prefix ON user_api_tokens(token_prefix);
CREATE INDEX idx_user_api_tokens_user ON user_api_tokens(user_id);

-- Index for cleanup of expired tokens
CREATE INDEX idx_user_api_tokens_expires ON user_api_tokens(expires_at)
    WHERE expires_at IS NOT NULL;

-- Function to clean up expired tokens (can be called by cron)
CREATE OR REPLACE FUNCTION cleanup_expired_api_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_api_tokens
    WHERE expires_at IS NOT NULL AND expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- RLS policies
ALTER TABLE user_api_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own tokens
CREATE POLICY "Users can view own tokens"
    ON user_api_tokens FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tokens"
    ON user_api_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
    ON user_api_tokens FOR DELETE
    USING (auth.uid() = user_id);

-- Service role can do everything (for API validation)
CREATE POLICY "Service role full access"
    ON user_api_tokens FOR ALL
    USING (true);

-- Add comment for documentation
COMMENT ON TABLE user_api_tokens IS 'Personal access tokens for CLI and API authentication';
COMMENT ON COLUMN user_api_tokens.token_prefix IS 'First 8 characters of token (ul_xxxx) for identification';
COMMENT ON COLUMN user_api_tokens.token_hash IS 'SHA-256 hash of the full token for secure validation';
COMMENT ON COLUMN user_api_tokens.scopes IS 'Permission scopes - currently unused, reserved for future granular permissions';
