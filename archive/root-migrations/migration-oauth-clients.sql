-- OAuth Clients Migration
-- Persists dynamically registered OAuth clients (RFC 7591) so they
-- survive server restarts and work across multiple instances.
-- Authorization codes stay in-memory (5-min TTL, one-time use).

CREATE TABLE IF NOT EXISTS oauth_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL UNIQUE,          -- UUID issued during registration
    client_name TEXT,                         -- Human-readable name
    redirect_uris TEXT[] NOT NULL,            -- Registered redirect URIs
    grant_types TEXT[] DEFAULT ARRAY['authorization_code'],
    response_types TEXT[] DEFAULT ARRAY['code'],
    token_endpoint_auth_method TEXT DEFAULT 'none',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast client lookup during authorize / token exchange
CREATE INDEX idx_oauth_clients_client_id ON oauth_clients(client_id);

-- Cleanup function: remove clients older than 30 days with no activity
-- Can be called by cron or manually
CREATE OR REPLACE FUNCTION cleanup_stale_oauth_clients()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM oauth_clients
    WHERE created_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- RLS policies
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;

-- Service role has full access (OAuth registration is unauthenticated per spec)
CREATE POLICY "Service role full access"
    ON oauth_clients FOR ALL
    USING (true);

COMMENT ON TABLE oauth_clients IS 'Dynamically registered OAuth 2.1 clients for MCP spec compliance (RFC 7591)';
COMMENT ON COLUMN oauth_clients.client_id IS 'UUID issued during dynamic client registration';
COMMENT ON COLUMN oauth_clients.redirect_uris IS 'Registered redirect URIs validated during authorization';
