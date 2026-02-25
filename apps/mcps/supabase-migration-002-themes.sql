-- ============================================
-- Research Intelligence Hub — Migration 002
-- Themes + Convictions + Room Routing
-- ============================================
-- Adds the organizational layer: themes map to Discord rooms,
-- convictions track the Index, insights link to themes.

-- ============================================
-- THEMES — The 12 Digest rooms + metadata
-- ============================================
-- Each theme maps to a bookmark category, a Discord room,
-- and a cluster (1-4).

create table if not exists themes (
  id uuid primary key default uuid_generate_v4(),

  -- Identity
  name text not null,                      -- Human label: 'AI', 'Crypto', 'Esoteric'
  slug text unique not null,               -- URL-safe key: 'ai', 'crypto', 'esoteric'
  description text,

  -- Discord mapping
  hemisphere text not null default 'digest', -- 'index' or 'digest'
  cluster integer,                          -- 1-4 for digest rooms, null for index
  room_name text not null,                  -- Discord channel name: 'data-center', 'sanctuary'
  discord_webhook_url text,                 -- Per-room webhook (encrypted or stored in KV)

  -- Bookmark category mapping
  bookmark_categories text[] default '{}',  -- Maps to tweet bookmark tags: ['ai', 'tech']

  -- Display
  color text,                               -- Hex color for UI: '#06b6d4'
  icon text,                                -- Emoji or icon name

  -- Ordering
  sort_order integer default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_themes_hemisphere on themes (hemisphere);
create index idx_themes_cluster on themes (cluster) where cluster is not null;
create index idx_themes_slug on themes (slug);

-- ============================================
-- CONVICTIONS — The Index (slow-moving theses)
-- ============================================
-- Core beliefs that inform what Ultralight builds.
-- These are the 13D-style entries that live in the amphitheater.

create table if not exists convictions (
  id uuid primary key default uuid_generate_v4(),

  -- The thesis
  title text not null,                      -- 'MCP is the interface layer between agents and the world'
  thesis text not null,                     -- 2-5 sentence expanded argument
  status text not null default 'active',    -- 'active', 'evolved', 'archived'

  -- Weight / Allocation
  allocation_weight integer default 0,      -- 0-100, how much time/resource this gets
  confidence text default 'medium',         -- 'low', 'medium', 'high', 'conviction'

  -- Links
  supporting_theme_ids uuid[] default '{}', -- Themes that feed evidence into this conviction
  supporting_insight_ids uuid[] default '{}', -- Key insights that support this thesis

  -- History (append-only log of changes)
  history jsonb default '[]',               -- [{ date, change, reason }]

  -- Display
  sort_order integer default 0,
  color text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_convictions_status on convictions (status) where status = 'active';

-- ============================================
-- EXTEND INSIGHTS — Add theme_id FK
-- ============================================

alter table insights
  add column if not exists theme_id uuid references themes(id);

create index idx_insights_theme on insights (theme_id) where theme_id is not null;

-- ============================================
-- EXTEND CONTENT — Add theme_id for pre-categorized content
-- ============================================
-- When tweets are ingested with a bookmark category, we can
-- pre-assign a theme_id so the Digest MCP knows which room
-- the resulting insight should route to.

alter table content
  add column if not exists theme_id uuid references themes(id);

create index idx_content_theme on content (theme_id) where theme_id is not null;

-- ============================================
-- EXTEND NEWSLETTERS — Add conviction context
-- ============================================

alter table newsletters
  add column if not exists conviction_ids uuid[] default '{}';

-- ============================================
-- TRIGGERS
-- ============================================

create trigger themes_updated_at
  before update on themes
  for each row execute function update_updated_at();

create trigger convictions_updated_at
  before update on convictions
  for each row execute function update_updated_at();

-- ============================================
-- RLS
-- ============================================

alter table themes enable row level security;
alter table convictions enable row level security;

create policy "Service role full access" on themes for all using (true);
create policy "Service role full access" on convictions for all using (true);

-- ============================================
-- SEED — All 12 rooms (Ultravision)
-- ============================================

-- INDEX rooms (hemisphere = 'index', no cluster)
insert into themes (name, slug, description, hemisphere, cluster, room_name, bookmark_categories, color, icon, sort_order) values
  ('Amphitheater', 'amphitheater', 'Core theses, conviction updates, what we shipped. The stage.', 'index', null, 'amphitheater', '{}', '#f59e0b', '🏛️', 1),
  ('Feedback Loop', 'feedback-loop', 'Community ↔ team dialogue. Vertical transparency. Why we build what we build.', 'index', null, 'feedback-loop', '{}', '#8b5cf6', '🔄', 2),
  ('Billboard', 'billboard', 'Community-created MCPs, markdowns, and tools. The showcase.', 'index', null, 'billboard', '{}', '#ec4899', '📋', 3);

-- DIGEST Cluster 1 — Hard Signal
insert into themes (name, slug, description, hemisphere, cluster, room_name, bookmark_categories, color, icon, sort_order) values
  ('Tech', 'tech', 'Industry moves, platforms, developer ecosystem.', 'digest', 1, 'trading-floor', '{"tech"}', '#3b82f6', '📈', 10),
  ('AI', 'ai', 'Models, agents, infrastructure, capabilities.', 'digest', 1, 'data-center', '{"ai"}', '#06b6d4', '🖥️', 11),
  ('Rumors', 'rumors', 'Industry rumors, speculation, back-channel signal.', 'digest', 1, 'back-rooms', '{"rumors", "crypto"}', '#f97316', '🚪', 12);

-- DIGEST Cluster 2 — Inner Game
insert into themes (name, slug, description, hemisphere, cluster, room_name, bookmark_categories, color, icon, sort_order) values
  ('Esoteric', 'esoteric', 'Spirituality, metaphysics, hidden knowledge.', 'digest', 2, 'sanctuary', '{"esoteric"}', '#a855f7', '🔮', 20),
  ('History', 'history', 'Archives, timeless patterns, precedent.', 'digest', 2, 'old-library', '{"history"}', '#78716c', '📚', 21),
  ('Mindset', 'mindset', 'Frameworks, mental models, discipline.', 'digest', 2, 'classroom', '{"mindset"}', '#eab308', '🧠', 22);

-- DIGEST Cluster 3 — Life
insert into themes (name, slug, description, hemisphere, cluster, room_name, bookmark_categories, color, icon, sort_order) values
  ('Life', 'life', 'Casual, social, humor.', 'digest', 3, 'living-room', '{"life", "funny"}', '#22c55e', '🛋️', 30),
  ('Nutrition', 'nutrition', 'Food, nourishment, longevity.', 'digest', 3, 'kitchen', '{"health"}', '#84cc16', '🍳', 31),
  ('Fitness', 'fitness', 'Discipline, performance, body.', 'digest', 3, 'gym', '{"health", "mindset"}', '#14b8a6', '💪', 32);

-- ============================================
-- HELPER: Resolve theme from bookmark category
-- ============================================
-- Given a list of tags (from tweet bookmarks), find the best matching theme.

-- ============================================
-- DROP old function signatures (return type changed)
-- ============================================
-- PostgreSQL cannot ALTER return types via CREATE OR REPLACE,
-- so we drop the migration-001 versions first.

drop function if exists get_undigested(int, text);
drop function if exists search_content(vector, float, int, text, text[]);
drop function if exists search_insights(vector, float, int);

-- ============================================
-- OVERRIDE: get_undigested — now returns theme_id
-- ============================================
-- Replaces the migration-001 version to include theme_id
-- so Digest MCP can inherit theme from source content.

create or replace function get_undigested(
  batch_limit int default 20,
  source_filter text default null
)
returns table (
  id uuid,
  source_type text,
  title text,
  body text,
  author text,
  tags text[],
  theme_id uuid,
  created_at timestamptz
)
language plpgsql as $$
begin
  return query
  select
    c.id,
    c.source_type,
    c.title,
    c.body,
    c.author,
    c.tags,
    c.theme_id,
    c.created_at
  from content c
  where c.digested_at is null
    and c.embedding is not null
    and (source_filter is null or c.source_type = source_filter)
  order by c.created_at asc
  limit batch_limit;
end;
$$;

-- ============================================
-- OVERRIDE: search_content — now returns theme_id
-- ============================================
-- Extends the original to include theme_id + optional theme filter.

create or replace function search_content(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 20,
  filter_source_type text default null,
  filter_tags text[] default null,
  filter_theme_id uuid default null
)
returns table (
  id uuid,
  source_type text,
  title text,
  body text,
  author text,
  tags text[],
  source_url text,
  source_meta jsonb,
  theme_id uuid,
  similarity float,
  created_at timestamptz
)
language plpgsql as $$
begin
  return query
  select
    c.id,
    c.source_type,
    c.title,
    c.body,
    c.author,
    c.tags,
    c.source_url,
    c.source_meta,
    c.theme_id,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.created_at
  from content c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
    and (filter_source_type is null or c.source_type = filter_source_type)
    and (filter_tags is null or c.tags && filter_tags)
    and (filter_theme_id is null or c.theme_id = filter_theme_id)
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================
-- OVERRIDE: search_insights — now returns theme_id
-- ============================================

create or replace function search_insights(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 10,
  filter_theme_id uuid default null
)
returns table (
  id uuid,
  title text,
  body text,
  themes text[],
  tags text[],
  theme_id uuid,
  approved boolean,
  newsletter_section text,
  similarity float,
  created_at timestamptz
)
language plpgsql as $$
begin
  return query
  select
    i.id,
    i.title,
    i.body,
    i.themes,
    i.tags,
    i.theme_id,
    i.approved,
    i.newsletter_section,
    1 - (i.embedding <=> query_embedding) as similarity,
    i.created_at
  from insights i
  where i.embedding is not null
    and 1 - (i.embedding <=> query_embedding) > match_threshold
    and (filter_theme_id is null or i.theme_id = filter_theme_id)
  order by i.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================
-- HELPER: Resolve theme from bookmark category
-- ============================================

create or replace function resolve_theme_from_tags(
  input_tags text[]
)
returns uuid
language plpgsql as $$
declare
  matched_id uuid;
begin
  -- Find the theme with the most overlapping bookmark_categories
  select t.id into matched_id
  from themes t
  where t.hemisphere = 'digest'
    and t.bookmark_categories && input_tags
  order by array_length(
    array(select unnest(t.bookmark_categories) intersect select unnest(input_tags)),
    1
  ) desc nulls last
  limit 1;

  return matched_id;
end;
$$;
