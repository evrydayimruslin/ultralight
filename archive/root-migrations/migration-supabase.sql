-- Migration: Add Supabase configuration to apps
-- Run this in your Supabase SQL Editor

-- Add Supabase configuration columns to apps table
-- Credentials are stored encrypted (same as env vars)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS supabase_url TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS supabase_anon_key_encrypted TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS supabase_service_key_encrypted TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS supabase_enabled BOOLEAN DEFAULT false;

-- Create index for apps with Supabase enabled
CREATE INDEX IF NOT EXISTS idx_apps_supabase_enabled ON apps(supabase_enabled) WHERE supabase_enabled = true;

-- Add comment explaining the encryption
COMMENT ON COLUMN apps.supabase_anon_key_encrypted IS 'AES-GCM encrypted anon key, format: iv:ciphertext';
COMMENT ON COLUMN apps.supabase_service_key_encrypted IS 'AES-GCM encrypted service role key (optional), format: iv:ciphertext';
