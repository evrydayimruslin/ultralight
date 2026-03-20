-- Recipe Box: recipes, grocery_lists, meal_plans tables

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ingredients TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  prep_time INTEGER,
  cook_time INTEGER,
  servings INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_recipes_user_id ON recipes(user_id);

CREATE TABLE IF NOT EXISTS grocery_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  checked_items TEXT NOT NULL DEFAULT '[]',
  recipe_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_grocery_lists_user_id ON grocery_lists(user_id);

CREATE TABLE IF NOT EXISTS meal_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  day TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  recipe_id TEXT,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX idx_meal_plans_user_id ON meal_plans(user_id);
CREATE INDEX idx_meal_plans_user_week ON meal_plans(user_id, week_start);
