-- Migration: Store plaintext API tokens for retrieval
-- This allows the platform to show and use API keys without regenerating them.
-- Tokens are server-to-server API keys (not passwords), so storing plaintext is acceptable.

ALTER TABLE user_api_tokens ADD COLUMN IF NOT EXISTS plaintext_token TEXT;
