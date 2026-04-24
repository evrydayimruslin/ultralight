-- Add per-token salt column for HMAC-SHA256 token hashing
-- Existing tokens (token_salt IS NULL) continue to work with legacy unsalted SHA-256.
-- New tokens get a random salt and use HMAC-SHA256 for hashing.

ALTER TABLE user_api_tokens
  ADD COLUMN IF NOT EXISTS token_salt TEXT;

COMMENT ON COLUMN user_api_tokens.token_salt IS 'Random hex salt for HMAC-SHA256 token hashing. NULL = legacy unsalted SHA-256.';
