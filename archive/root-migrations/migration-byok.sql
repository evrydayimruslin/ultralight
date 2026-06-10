-- BYOK (Bring Your Own Key) Migration
-- Run this in Supabase SQL Editor to add BYOK support
-- Go to: https://uavjzycsltdnwblwutmb.supabase.co/project/_/sql

-- Add byok_keys column to store encrypted API keys for multiple providers
-- Structure: { "openai": { "encrypted_key": "...", "model": "gpt-4o", "added_at": "..." }, ... }
ALTER TABLE users ADD COLUMN IF NOT EXISTS byok_keys JSONB DEFAULT NULL;

-- Update byok_provider to support new providers
-- Valid values: 'openrouter', 'openai', 'anthropic', 'deepseek', 'moonshot'
-- (No constraint change needed - TEXT allows any value)

-- Add comment for documentation
COMMENT ON COLUMN users.byok_keys IS 'Encrypted API keys for BYOK providers. Structure: { provider: { encrypted_key, model?, added_at } }';
COMMENT ON COLUMN users.byok_enabled IS 'Whether BYOK is enabled for this user';
COMMENT ON COLUMN users.byok_provider IS 'Primary BYOK provider to use for AI calls';
