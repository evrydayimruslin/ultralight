-- migrations/001_initial.sql
-- Starter migration template for an Ultralight app.
-- Every table MUST have: id, user_id, created_at, updated_at.
-- Every table MUST have an index on user_id.

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  value REAL DEFAULT 0,
  category TEXT DEFAULT 'uncategorized',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_items_user ON items(user_id);
CREATE INDEX idx_items_user_category ON items(user_id, category);
