-- Smart Budget: transactions and budgets tables

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date);
CREATE INDEX idx_transactions_user_category ON transactions(user_id, category);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'monthly',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_budgets_user_id ON budgets(user_id);
CREATE INDEX idx_budgets_user_category ON budgets(user_id, category);
