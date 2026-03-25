-- Story Builder v2: relationships, arcs, factions, lore, rules

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  character_a_id TEXT NOT NULL REFERENCES characters(id),
  character_b_id TEXT NOT NULL REFERENCES characters(id),
  type TEXT NOT NULL DEFAULT 'neutral',
  description TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_relationships_user_id ON relationships(user_id);
CREATE INDEX IF NOT EXISTS idx_relationships_world_id ON relationships(world_id);

CREATE TABLE IF NOT EXISTS arcs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'narrative',
  description TEXT DEFAULT '',
  season TEXT DEFAULT '',
  episode_range TEXT DEFAULT '',
  character_ids TEXT DEFAULT '[]',
  arc_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_arcs_user_id ON arcs(user_id);
CREATE INDEX IF NOT EXISTS idx_arcs_world_id ON arcs(world_id);

CREATE TABLE IF NOT EXISTS factions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  member_ids TEXT DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_factions_user_id ON factions(user_id);
CREATE INDEX IF NOT EXISTS idx_factions_world_id ON factions(world_id);

CREATE TABLE IF NOT EXISTS lore (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'institution',
  description TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lore_user_id ON lore(user_id);
CREATE INDEX IF NOT EXISTS idx_lore_world_id ON lore(world_id);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'constraint',
  description TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rules_user_id ON rules(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_world_id ON rules(world_id);
