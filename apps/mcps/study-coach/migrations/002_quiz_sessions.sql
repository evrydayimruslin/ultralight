-- Private Tutor: quiz sessions, answers, lessons, student profiles, conventions

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  score_pct REAL,
  total_questions INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id, started_at);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  concept_id TEXT,
  question TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  correct_answer TEXT NOT NULL DEFAULT '',
  user_answer TEXT,
  is_correct INTEGER,
  explanation TEXT,
  question_type TEXT DEFAULT 'mc',
  feedback TEXT,
  score INTEGER,
  rubric TEXT,
  misconceptions TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  answered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_session ON quiz_answers(session_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_concept ON quiz_answers(user_id, concept_id);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  quiz_session_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  weak_concepts TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_user ON lessons(user_id, created_at);

CREATE TABLE IF NOT EXISTS student_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  strengths TEXT DEFAULT '[]',
  weaknesses TEXT DEFAULT '[]',
  learning_notes TEXT DEFAULT '',
  quiz_count INTEGER DEFAULT 0,
  avg_score REAL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_user_subject ON student_profiles(user_id, subject_id);

CREATE TABLE IF NOT EXISTS conventions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conventions_user_key ON conventions(user_id, key);
