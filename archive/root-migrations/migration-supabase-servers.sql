-- Migration: Multiple Supabase Servers per User
-- Moves from single user-level Supabase config to named servers.
-- Users can save unlimited Supabase servers, then assign them to apps via dropdown.

-- ============================================
-- 1. CREATE user_supabase_configs TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_supabase_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  supabase_url TEXT NOT NULL,
  anon_key_encrypted TEXT NOT NULL,
  service_key_encrypted TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_supabase_configs_user
  ON user_supabase_configs(user_id);

-- ============================================
-- 2. ADD supabase_config_id TO apps TABLE
-- ============================================
-- Apps now reference a saved server by ID instead of storing their own creds.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS supabase_config_id UUID REFERENCES user_supabase_configs(id) ON DELETE SET NULL;

-- ============================================
-- 3. MIGRATE EXISTING USER-LEVEL CONFIG
-- ============================================
-- Move the single platform-level config into the new table as "Default"

INSERT INTO user_supabase_configs (user_id, name, supabase_url, anon_key_encrypted, service_key_encrypted)
SELECT
  id,
  'Default',
  supabase_url,
  supabase_anon_key_encrypted,
  supabase_service_key_encrypted
FROM users
WHERE supabase_url IS NOT NULL
  AND supabase_anon_key_encrypted IS NOT NULL
ON CONFLICT (user_id, name) DO NOTHING;

-- ============================================
-- 4. MIGRATE EXISTING APP-LEVEL CONFIG
-- ============================================
-- For apps that had their own Supabase config, create a named server and link it.
-- We name these after the app to avoid conflicts.

INSERT INTO user_supabase_configs (user_id, name, supabase_url, anon_key_encrypted, service_key_encrypted)
SELECT
  a.owner_id,
  'App: ' || COALESCE(a.name, a.slug),
  a.supabase_url,
  a.supabase_anon_key_encrypted,
  a.supabase_service_key_encrypted
FROM apps a
WHERE a.supabase_url IS NOT NULL
  AND a.supabase_anon_key_encrypted IS NOT NULL
  AND a.deleted_at IS NULL
ON CONFLICT (user_id, name) DO NOTHING;

-- Link apps to their migrated config
UPDATE apps a
SET supabase_config_id = usc.id
FROM user_supabase_configs usc
WHERE usc.user_id = a.owner_id
  AND usc.name = 'App: ' || COALESCE(a.name, a.slug)
  AND a.supabase_url IS NOT NULL
  AND a.supabase_anon_key_encrypted IS NOT NULL
  AND a.deleted_at IS NULL;

-- Also link apps that had supabase_enabled but relied on platform fallback
-- to the "Default" config
UPDATE apps a
SET supabase_config_id = usc.id
FROM user_supabase_configs usc
WHERE usc.user_id = a.owner_id
  AND usc.name = 'Default'
  AND a.supabase_enabled = true
  AND a.supabase_config_id IS NULL
  AND a.deleted_at IS NULL;
