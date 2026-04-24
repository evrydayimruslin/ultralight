-- Migration: Supabase Management API OAuth tokens
-- Stores encrypted OAuth access/refresh tokens for the "Connect Supabase" flow
-- One token pair per user (UNIQUE on user_id)

CREATE TABLE IF NOT EXISTS user_supabase_oauth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_supabase_oauth_user ON user_supabase_oauth(user_id);

-- Temporary storage for PKCE code verifiers during OAuth flow
-- Cleaned up after use or after 10 minutes
CREATE TABLE IF NOT EXISTS supabase_oauth_state (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
