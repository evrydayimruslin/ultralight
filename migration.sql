-- Run this in Supabase SQL Editor
-- Go to: https://uavjzycsltdnwblwutmb.supabase.co/project/_/sql
-- Paste this entire file and click Run

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
    tier_expires_at TIMESTAMPTZ,
    storage_used_bytes BIGINT DEFAULT 0,
    storage_limit_bytes BIGINT DEFAULT 536870912, -- 500MB
    byok_enabled BOOLEAN DEFAULT FALSE,
    byok_provider TEXT,
    byok_key_encrypted TEXT,
    root_memory JSONB DEFAULT '{}',
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Apps table
CREATE TABLE IF NOT EXISTS apps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
    current_version TEXT DEFAULT '1.0.0',
    versions JSONB DEFAULT '[]',
    storage_key TEXT NOT NULL,
    storage_bytes BIGINT DEFAULT 0,
    skills_md TEXT,
    exports JSONB DEFAULT '[]',
    last_build_success BOOLEAN,
    last_build_logs JSONB DEFAULT '[]',
    total_runs INTEGER DEFAULT 0,
    runs_30d INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_id, slug)
);

-- Memory table
CREATE TABLE IF NOT EXISTS memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT DEFAULT 'user',
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    created_by_app UUID REFERENCES apps(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, scope, key)
);

-- Executions table
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    app_id UUID REFERENCES apps(id),
    user_id UUID REFERENCES users(id),
    function_name TEXT NOT NULL,
    success BOOLEAN,
    duration_ms INTEGER,
    logs JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_apps_owner ON apps(owner_id);
CREATE INDEX idx_apps_visibility ON apps(visibility);
CREATE INDEX idx_memory_user ON memory(user_id);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY users_own ON users FOR ALL USING (auth.uid() = id);
CREATE POLICY apps_owner ON apps FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY apps_public ON apps FOR SELECT USING (visibility = 'public');
CREATE POLICY memory_own ON memory FOR ALL USING (auth.uid() = user_id);

-- DROP FK constraint on apps.owner_id to simplify user management
-- Run this if you're having issues with user creation
-- ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_owner_id_fkey;

-- RPC Functions

-- Ensure user exists (bypasses RLS)
CREATE OR REPLACE FUNCTION ensure_user_exists(
  user_id UUID,
  user_email TEXT,
  user_display_name TEXT DEFAULT NULL,
  user_avatar_url TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO users (id, email, display_name, avatar_url)
  VALUES (user_id, user_email, COALESCE(user_display_name, split_part(user_email, '@', 1)), user_avatar_url)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- Atomic increment for app run counts
CREATE OR REPLACE FUNCTION increment_app_runs(app_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE apps
  SET
    total_runs = total_runs + 1,
    runs_30d = runs_30d + 1,
    updated_at = NOW()
  WHERE id = app_id;
END;
$$;
