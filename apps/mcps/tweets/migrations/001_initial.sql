-- Tweets: tweet/post content management
-- Each table scoped to user_id

CREATE TABLE IF NOT EXISTS tweets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT DEFAULT 'tweet',
  source_id TEXT,
  source_url TEXT,
  source_meta TEXT DEFAULT '{}',
  title TEXT,
  body TEXT NOT NULL,
  author TEXT,
  tags TEXT DEFAULT '[]',
  theme_id TEXT,
  embedded_at TEXT,
  digested_at TEXT,
  source_created_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets(user_id);
CREATE INDEX IF NOT EXISTS idx_tweets_source_type ON tweets(user_id, source_type);
CREATE INDEX IF NOT EXISTS idx_tweets_source_id ON tweets(user_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(user_id, author);
CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(user_id, created_at);
