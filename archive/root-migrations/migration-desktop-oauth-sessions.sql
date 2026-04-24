-- Migration: Durable desktop OAuth polling sessions for Cloudflare Workers
-- Replaces the old in-memory auth handoff that only worked on a single API instance.
-- Sessions are short-lived (5 min) and deleted on successful poll consumption.

CREATE TABLE IF NOT EXISTS desktop_oauth_sessions (
  session_id TEXT PRIMARY KEY,
  poll_secret_hash TEXT,
  access_token_encrypted TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
);

CREATE INDEX IF NOT EXISTS idx_desktop_oauth_sessions_expires_at
  ON desktop_oauth_sessions(expires_at);

COMMENT ON TABLE desktop_oauth_sessions IS
  'Short-lived desktop OAuth polling sessions used to hand off Supabase access tokens to the desktop app.';

COMMENT ON COLUMN desktop_oauth_sessions.poll_secret_hash IS
  'Optional SHA-256 hash of a desktop-held poll secret. Null keeps backward compatibility with older desktop builds.';

COMMENT ON COLUMN desktop_oauth_sessions.access_token_encrypted IS
  'Encrypted Supabase access token, deleted once the desktop app successfully polls it.';
