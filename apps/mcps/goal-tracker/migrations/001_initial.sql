-- Goal Tracker: goals and milestones tables

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_goals_user_id ON goals(user_id);
CREATE INDEX idx_goals_user_status ON goals(user_id, status);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_date TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_milestones_user_id ON milestones(user_id);
CREATE INDEX idx_milestones_goal_id ON milestones(user_id, goal_id);

CREATE TABLE IF NOT EXISTS progress_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  percent_complete REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_progress_logs_user_id ON progress_logs(user_id);
CREATE INDEX idx_progress_logs_goal_id ON progress_logs(user_id, goal_id);
