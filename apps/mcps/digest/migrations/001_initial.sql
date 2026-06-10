-- Digest: synthesis engine with insights, digest runs, and newsletters
-- Each table scoped to user_id

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  digest_run_id TEXT,
  source_content_ids TEXT DEFAULT '[]',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  themes TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  theme_id TEXT,
  embedding TEXT,
  newsletter_section TEXT,
  newsletter_id TEXT,
  approved INTEGER DEFAULT 0,
  approved_at TEXT,
  rejected INTEGER DEFAULT 0,
  revision_notes TEXT,
  codebase_relevance TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_insights_user_id ON insights(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_approved ON insights(user_id, approved);
CREATE INDEX IF NOT EXISTS idx_insights_rejected ON insights(user_id, rejected);
CREATE INDEX IF NOT EXISTS idx_insights_newsletter_id ON insights(user_id, newsletter_id);
CREATE INDEX IF NOT EXISTS idx_insights_digest_run_id ON insights(user_id, digest_run_id);

CREATE TABLE IF NOT EXISTS digest_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  items_processed INTEGER DEFAULT 0,
  items_created INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  ai_input_tokens INTEGER DEFAULT 0,
  ai_output_tokens INTEGER DEFAULT 0,
  ai_cost_light REAL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_digest_runs_user_id ON digest_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_digest_runs_started_at ON digest_runs(user_id, started_at);

CREATE TABLE IF NOT EXISTS newsletters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT,
  sections TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  published_url TEXT,
  email_sent_at TEXT,
  email_send_count INTEGER DEFAULT 0,
  discord_posted_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_newsletters_user_id ON newsletters(user_id);
CREATE INDEX IF NOT EXISTS idx_newsletters_status ON newsletters(user_id, status);
