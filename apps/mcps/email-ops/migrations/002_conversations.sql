-- Conversations + Versions: version-controlled email thread system
-- Replaces email_log + approval_queue for the core email workflow

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_name TEXT,
  subject TEXT NOT NULL,
  language TEXT,
  classification TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  message_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version_num INTEGER NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  actor TEXT,
  actor_prompt TEXT,
  model TEXT,
  metadata TEXT,
  resend_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_status ON conversations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_versions_conversation ON versions(conversation_id, version_num);
