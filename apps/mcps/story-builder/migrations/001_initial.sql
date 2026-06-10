-- Story Builder: worlds, characters, locations, scenes
-- Each table scoped to user_id

CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  genre TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_worlds_user_id ON worlds(user_id);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  traits TEXT DEFAULT '[]',
  backstory TEXT DEFAULT '',
  role TEXT DEFAULT '',
  relationships TEXT DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_world_id ON characters(world_id);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_world_id ON locations(world_id);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  type TEXT DEFAULT 'scene',
  character_ids TEXT DEFAULT '[]',
  setting_id TEXT,
  scene_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_scenes_user_id ON scenes(user_id);
CREATE INDEX IF NOT EXISTS idx_scenes_world_id ON scenes(world_id);

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_themes_user_id ON themes(user_id);
CREATE INDEX IF NOT EXISTS idx_themes_world_id ON themes(world_id);
