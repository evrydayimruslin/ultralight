-- Reading List: books/articles tracking with highlights
-- Each table scoped to user_id

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'article',
  content_snippet TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  embedding TEXT,
  read_status TEXT DEFAULT 'unread',
  saved_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);
CREATE INDEX IF NOT EXISTS idx_books_read_status ON books(user_id, read_status);
CREATE INDEX IF NOT EXISTS idx_books_type ON books(user_id, type);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id),
  text TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_highlights_user_id ON highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);
