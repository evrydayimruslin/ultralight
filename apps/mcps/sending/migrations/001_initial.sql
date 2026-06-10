-- Sending: newsletter distribution, subscribers, send logs
-- Each table scoped to user_id

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  subscribed INTEGER DEFAULT 1,
  tags TEXT DEFAULT '[]',
  source TEXT DEFAULT 'manual',
  subscribed_at TEXT,
  unsubscribed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscribers_user_id ON subscribers(user_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(user_id, email);
CREATE INDEX IF NOT EXISTS idx_subscribers_subscribed ON subscribers(user_id, subscribed);

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

CREATE TABLE IF NOT EXISTS env_vars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_env_vars_user_id ON env_vars(user_id);
CREATE INDEX IF NOT EXISTS idx_env_vars_key ON env_vars(user_id, key);
