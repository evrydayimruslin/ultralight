CREATE TABLE IF NOT EXISTS imap_sync_state (
  user_id TEXT PRIMARY KEY,
  last_uid INTEGER DEFAULT 0,
  last_check TEXT DEFAULT (datetime('now'))
);
