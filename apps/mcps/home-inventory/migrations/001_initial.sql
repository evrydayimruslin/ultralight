-- Home Inventory: items table

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  value REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  purchase_date TEXT,
  warranty_expires TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_items_user_id ON items(user_id);
CREATE INDEX idx_items_user_location ON items(user_id, location);
CREATE INDEX idx_items_user_category ON items(user_id, category);
