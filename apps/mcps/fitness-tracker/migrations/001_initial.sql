-- Fitness Tracker: meals, workouts, sleep, weight tables

CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  meal_type TEXT NOT NULL DEFAULT 'meal',
  date TEXT NOT NULL,
  calories REAL NOT NULL DEFAULT 0,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_meals_user_id ON meals(user_id);
CREATE INDEX idx_meals_user_date ON meals(user_id, date);

CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_min REAL NOT NULL DEFAULT 0,
  calories_burned REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_workouts_user_id ON workouts(user_id);
CREATE INDEX idx_workouts_user_date ON workouts(user_id, date);

CREATE TABLE IF NOT EXISTS sleep_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  hours REAL NOT NULL,
  quality INTEGER,
  notes TEXT DEFAULT '',
  date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_sleep_logs_user_id ON sleep_logs(user_id);
CREATE INDEX idx_sleep_logs_user_date ON sleep_logs(user_id, date);

CREATE TABLE IF NOT EXISTS weight_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'lbs',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_weight_logs_user_id ON weight_logs(user_id);
CREATE INDEX idx_weight_logs_user_date ON weight_logs(user_id, date);
