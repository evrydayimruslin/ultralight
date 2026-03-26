-- Resort Manager: Approval queue for admin review of emails and DB changes

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  summary TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  admin_notes TEXT,
  related_table TEXT,
  related_id TEXT,
  original_email_id TEXT,
  expires_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_approval_user ON approval_queue(user_id);
CREATE INDEX idx_approval_status ON approval_queue(user_id, status);
CREATE INDEX idx_approval_type ON approval_queue(user_id, type);
CREATE INDEX idx_approval_priority ON approval_queue(user_id, priority, created_at);
