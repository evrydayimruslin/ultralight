-- Course model: lesson status tracking + quiz pre-generation
ALTER TABLE lessons ADD COLUMN status TEXT DEFAULT 'unread';
ALTER TABLE lessons ADD COLUMN read_at TEXT;
ALTER TABLE quiz_sessions ADD COLUMN generated_at TEXT;
