-- Budget Tracker — Initial Schema
-- Tracks transactions and budgets per user.

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income')),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date);
CREATE INDEX idx_transactions_user_category ON transactions(user_id, category);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, category)
);

CREATE INDEX idx_budgets_user ON budgets(user_id);
