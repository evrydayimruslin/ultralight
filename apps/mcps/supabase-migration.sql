-- ============================================
-- Research Intelligence Hub — Shared Supabase Schema
-- NEW Supabase project (separate from platform DB)
-- All MCPs (embeds, tweets, digest, sending) share this DB
-- ============================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "vector";

-- ============================================
-- CONTENT — All raw ingested material
-- ============================================
-- Unified table: tweets, notes, chats, and any future source
-- Each MCP writes here with its own source_type

create table if not exists content (
  id uuid primary key default uuid_generate_v4(),

  -- Source classification
  source_type text not null,          -- 'tweet', 'note', 'chat', 'article', 'manual'
  source_id text,                     -- Original ID from source (tweet_id, note block id, etc.)
  source_url text,                    -- Original URL if applicable
  source_meta jsonb default '{}',     -- Source-specific metadata

  -- Core content
  title text,                         -- Optional title (for notes, articles)
  body text not null,                 -- The actual content text
  author text,                        -- Author handle, name, or system name
  tags text[] default '{}',           -- User-assigned or auto-extracted tags

  -- Embedding (filled by Embeds MCP)
  embedding vector(1536),             -- text-embedding-3-small
  embedded_at timestamptz,            -- When embedding was generated

  -- Digest tracking
  digested_at timestamptz,            -- null = not yet digested
  digest_run_id uuid,                 -- Which digest run processed this

  -- Timestamps
  source_created_at timestamptz,      -- When the original content was created
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent duplicate ingestion from same source
create unique index idx_content_source_dedup
  on content (source_type, source_id)
  where source_id is not null;

-- Fast lookups
create index idx_content_source_type on content (source_type);
create index idx_content_created on content (created_at desc);
create index idx_content_tags on content using gin (tags);
create index idx_content_undigested on content (created_at desc) where digested_at is null;
create index idx_content_unembedded on content (created_at desc) where embedding is null;

-- Full-text search
create index idx_content_body_fts on content using gin (to_tsvector('english', body));

-- Vector similarity search (HNSW — fast approximate nearest neighbor)
create index idx_content_embedding_hnsw on content
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================
-- INSIGHTS — Synthesized by Digest MCP
-- ============================================

create table if not exists insights (
  id uuid primary key default uuid_generate_v4(),

  -- What produced this insight
  digest_run_id uuid,
  source_content_ids uuid[] default '{}',   -- Content rows that fed this insight

  -- The insight itself
  title text not null,
  body text not null,
  themes text[] default '{}',               -- Extracted theme labels
  tags text[] default '{}',

  -- Embedding for semantic search across insights too
  embedding vector(1536),

  -- Newsletter pipeline
  newsletter_section text,                  -- 'lead', 'analysis', 'links', 'coda', null
  newsletter_id uuid,                       -- FK once queued into a newsletter draft
  approved boolean not null default false,  -- Human-in-the-loop gate
  approved_at timestamptz,
  rejected boolean not null default false,
  revision_notes text,                      -- Notes from approval/revision

  -- Codebase relevance (filled by agent running locally)
  codebase_relevance jsonb,                 -- { files: [], suggestions: [], priority: 'high'|'medium'|'low' }

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_insights_approved on insights (approved) where approved = true;
create index idx_insights_pending on insights (created_at desc) where approved = false and rejected = false;
create index idx_insights_newsletter on insights (newsletter_id) where newsletter_id is not null;
create index idx_insights_embedding_hnsw on insights
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================
-- NEWSLETTERS — Draft → Approved → Sent
-- ============================================

create table if not exists newsletters (
  id uuid primary key default uuid_generate_v4(),

  title text not null,
  slug text unique,                         -- For ul.markdown.publish URL

  -- Sections stored as ordered JSON
  sections jsonb not null default '[]',     -- [{ section: 'lead', insight_id, content, order }]

  -- Status machine
  status text not null default 'draft',     -- 'draft', 'approved', 'sending', 'sent', 'failed'

  -- Distribution tracking
  published_url text,                       -- ul.markdown.publish URL
  email_sent_at timestamptz,
  email_send_count integer default 0,
  discord_posted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_newsletters_status on newsletters (status);
create index idx_newsletters_created on newsletters (created_at desc);

-- ============================================
-- SUBSCRIBERS — Email list for Sending MCP
-- ============================================

create table if not exists subscribers (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  name text,

  -- Subscription state
  subscribed boolean not null default true,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz,

  -- Segmentation
  tags text[] default '{}',                 -- 'early-adopter', 'developer', etc.
  source text,                              -- How they subscribed: 'manual', 'discord', 'website'

  created_at timestamptz not null default now()
);

create index idx_subscribers_active on subscribers (subscribed) where subscribed = true;

-- ============================================
-- DIGEST_RUNS — Execution log for Digest MCP
-- ============================================

create table if not exists digest_runs (
  id uuid primary key default uuid_generate_v4(),

  -- What was processed
  step text not null,                       -- 'collect', 'embed', 'cluster', 'synthesize', 'queue'
  status text not null default 'running',   -- 'running', 'completed', 'failed'

  -- Metrics
  items_processed integer default 0,
  items_created integer default 0,
  error_message text,
  duration_ms integer,

  -- AI cost tracking
  ai_input_tokens integer default 0,
  ai_output_tokens integer default 0,
  ai_cost_cents numeric(10, 4) default 0,

  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_digest_runs_step on digest_runs (step, started_at desc);

-- ============================================
-- FUNCTIONS — Server-side helpers
-- ============================================

-- Semantic search across all content
create or replace function search_content(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 20,
  filter_source_type text default null,
  filter_tags text[] default null
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
    1 - (c.embedding <=> query_embedding) as similarity,
    c.created_at
  from content c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
    and (filter_source_type is null or c.source_type = filter_source_type)
    and (filter_tags is null or c.tags && filter_tags)
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Semantic search across insights
create or replace function search_insights(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 10
)
returns table (
  id uuid,
  title text,
  body text,
  themes text[],
  tags text[],
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
    i.approved,
    i.newsletter_section,
    1 - (i.embedding <=> query_embedding) as similarity,
    i.created_at
  from insights i
  where i.embedding is not null
    and 1 - (i.embedding <=> query_embedding) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Get undigested content for Digest MCP
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
    c.created_at
  from content c
  where c.digested_at is null
    and c.embedding is not null  -- Must be embedded first
    and (source_filter is null or c.source_type = source_filter)
  order by c.created_at asc      -- Oldest first
  limit batch_limit;
end;
$$;

-- Get unembedded content for Embeds MCP
create or replace function get_unembedded(
  batch_limit int default 20
)
returns table (
  id uuid,
  source_type text,
  title text,
  body text,
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
    c.created_at
  from content c
  where c.embedding is null
  order by c.created_at asc
  limit batch_limit;
end;
$$;

-- ============================================
-- TRIGGERS
-- ============================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger content_updated_at
  before update on content
  for each row execute function update_updated_at();

create trigger insights_updated_at
  before update on insights
  for each row execute function update_updated_at();

create trigger newsletters_updated_at
  before update on newsletters
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
-- Service role has full access (Ultralight uses service key)

alter table content enable row level security;
alter table insights enable row level security;
alter table newsletters enable row level security;
alter table subscribers enable row level security;
alter table digest_runs enable row level security;

create policy "Service role full access" on content for all using (true);
create policy "Service role full access" on insights for all using (true);
create policy "Service role full access" on newsletters for all using (true);
create policy "Service role full access" on subscribers for all using (true);
create policy "Service role full access" on digest_runs for all using (true);
