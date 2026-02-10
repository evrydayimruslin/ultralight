-- X Scrape - Supabase BYOS Migration
-- Database: russell-x-research
-- Run this in your Supabase SQL Editor

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "vector";  -- For embeddings/semantic search

-- ============================================
-- CORE TABLES
-- ============================================

-- Tweets
create table if not exists tweets (
  id uuid primary key default uuid_generate_v4(),
  tweet_id text unique not null,  -- Original X/Twitter ID
  author_handle text not null,
  author_name text,
  content text not null,
  url text not null,
  posted_at timestamptz,
  metrics jsonb default '{}',
  media_urls text[] default '{}',
  tags text[] default '{}',
  embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
  notes text,
  created_at timestamptz not null default now()
);

-- Indexes for common queries
create index idx_tweets_tweet_id on tweets(tweet_id);
create index idx_tweets_author on tweets(author_handle);
create index idx_tweets_created on tweets(created_at desc);
create index idx_tweets_tags on tweets using gin(tags);

-- Full-text search index
create index idx_tweets_content_fts on tweets using gin(to_tsvector('english', content));

-- Vector similarity search index (HNSW for fast approximate nearest neighbor)
create index idx_tweets_embedding on tweets using hnsw (embedding vector_cosine_ops);

-- Collections
create table if not exists collections (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  tweet_ids uuid[] default '{}',
  tags text[] default '{}',
  analysis jsonb,  -- Stored collection analysis
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_collections_updated on collections(updated_at desc);
create index idx_collections_tags on collections using gin(tags);

-- Notes
create table if not exists notes (
  id uuid primary key default uuid_generate_v4(),
  tweet_id uuid references tweets(id) on delete set null,
  collection_id uuid references collections(id) on delete set null,
  content text not null,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

create index idx_notes_tweet on notes(tweet_id) where tweet_id is not null;
create index idx_notes_collection on notes(collection_id) where collection_id is not null;
create index idx_notes_created on notes(created_at desc);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
alter table tweets enable row level security;
alter table collections enable row level security;
alter table notes enable row level security;

-- Service role full access (Ultralight uses service key)
create policy "Service role full access" on tweets for all using (true);
create policy "Service role full access" on collections for all using (true);
create policy "Service role full access" on notes for all using (true);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to find similar tweets using vector similarity
create or replace function find_similar_tweets(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 10
)
returns table (
  id uuid,
  tweet_id text,
  author_handle text,
  content text,
  url text,
  similarity float
)
language plpgsql as $$
begin
  return query
  select
    t.id,
    t.tweet_id,
    t.author_handle,
    t.content,
    t.url,
    1 - (t.embedding <=> query_embedding) as similarity
  from tweets t
  where t.embedding is not null
    and 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Function to search tweets with full-text search
create or replace function search_tweets_fts(
  search_query text,
  result_limit int default 20
)
returns table (
  id uuid,
  tweet_id text,
  author_handle text,
  content text,
  url text,
  rank float
)
language plpgsql as $$
begin
  return query
  select
    t.id,
    t.tweet_id,
    t.author_handle,
    t.content,
    t.url,
    ts_rank(to_tsvector('english', t.content), plainto_tsquery('english', search_query)) as rank
  from tweets t
  where to_tsvector('english', t.content) @@ plainto_tsquery('english', search_query)
  order by rank desc
  limit result_limit;
end;
$$;

-- Function to get collection with tweets
create or replace function get_collection_with_tweets(collection_uuid uuid)
returns table (
  collection_id uuid,
  collection_name text,
  collection_description text,
  tweet_id uuid,
  tweet_content text,
  tweet_author text,
  tweet_url text
)
language plpgsql as $$
begin
  return query
  select
    c.id as collection_id,
    c.name as collection_name,
    c.description as collection_description,
    t.id as tweet_id,
    t.content as tweet_content,
    t.author_handle as tweet_author,
    t.url as tweet_url
  from collections c
  cross join lateral unnest(c.tweet_ids) as tweet_uuid
  left join tweets t on t.id = tweet_uuid
  where c.id = collection_uuid;
end;
$$;

-- Function to get stats
create or replace function get_research_stats()
returns table (
  total_tweets bigint,
  total_collections bigint,
  total_notes bigint,
  tweets_this_week bigint,
  unique_authors bigint
)
language plpgsql as $$
begin
  return query
  select
    (select count(*) from tweets)::bigint as total_tweets,
    (select count(*) from collections)::bigint as total_collections,
    (select count(*) from notes)::bigint as total_notes,
    (select count(*) from tweets where created_at > now() - interval '7 days')::bigint as tweets_this_week,
    (select count(distinct author_handle) from tweets)::bigint as unique_authors;
end;
$$;

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- Top authors view
create or replace view top_authors as
select
  author_handle,
  author_name,
  count(*) as tweet_count,
  max(created_at) as latest_saved
from tweets
group by author_handle, author_name
order by tweet_count desc;

-- Recent tweets view
create or replace view recent_tweets as
select
  id,
  tweet_id,
  author_handle,
  left(content, 100) || case when length(content) > 100 then '...' else '' end as content_preview,
  url,
  array_length(tags, 1) as tag_count,
  created_at
from tweets
order by created_at desc
limit 100;

-- Collections summary view
create or replace view collections_summary as
select
  c.id,
  c.name,
  c.description,
  array_length(c.tweet_ids, 1) as tweet_count,
  c.analysis is not null as has_analysis,
  c.updated_at
from collections c
order by c.updated_at desc;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update timestamp trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger collections_updated_at
  before update on collections
  for each row
  execute function update_updated_at();

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Uncomment to insert sample data
/*
-- Sample tweets
insert into tweets (tweet_id, author_handle, author_name, content, url, tags) values
  ('1234567890', 'naval', 'Naval Ravikant', 'Seek wealth, not money or status. Wealth is having assets that earn while you sleep.', 'https://x.com/naval/status/1234567890', array['wealth', 'wisdom']),
  ('1234567891', 'paulg', 'Paul Graham', 'The best way to have good ideas is to have lots of ideas.', 'https://x.com/paulg/status/1234567891', array['startups', 'ideas']),
  ('1234567892', 'sama', 'Sam Altman', 'Have a bias toward action. You can usually fix things later.', 'https://x.com/sama/status/1234567892', array['advice', 'startups']);

-- Sample collection
insert into collections (name, description, tags) values
  ('Startup Wisdom', 'Best advice from founders and VCs', array['startups', 'advice']);

-- Link tweets to collection
update collections
set tweet_ids = array(select id from tweets where 'startups' = any(tags))
where name = 'Startup Wisdom';

-- Sample note
insert into notes (content, tags)
values ('Key theme: Bias for action over analysis paralysis', array['insight']);
*/
