-- Embeds: shared content store with embedding support
-- Each table scoped to user_id

CREATE TABLE IF NOT EXISTS embeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  source_meta TEXT DEFAULT '{}',
  title TEXT,
  body TEXT NOT NULL,
  author TEXT,
  tags TEXT DEFAULT '[]',
  theme_id TEXT,
  embedding TEXT,
  embedded_at TEXT,
  digested_at TEXT,
  digest_run_id TEXT,
  source_created_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_embeds_user_id ON embeds(user_id);
CREATE INDEX IF NOT EXISTS idx_embeds_source_type ON embeds(user_id, source_type);
CREATE INDEX IF NOT EXISTS idx_embeds_source_id ON embeds(user_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_embeds_embedded_at ON embeds(user_id, embedded_at);
CREATE INDEX IF NOT EXISTS idx_embeds_digested_at ON embeds(user_id, digested_at);
CREATE INDEX IF NOT EXISTS idx_embeds_created_at ON embeds(user_id, created_at);
