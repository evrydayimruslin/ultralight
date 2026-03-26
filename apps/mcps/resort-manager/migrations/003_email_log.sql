-- Resort Manager: Email tracking for inbound/outbound correspondence

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  thread_id TEXT,
  in_reply_to TEXT,
  classification TEXT,
  approval_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_user ON email_log(user_id);
CREATE INDEX idx_email_direction ON email_log(user_id, direction);
CREATE INDEX idx_email_thread ON email_log(user_id, thread_id);
CREATE INDEX idx_email_from ON email_log(user_id, from_address);
CREATE INDEX idx_email_status ON email_log(user_id, status);
