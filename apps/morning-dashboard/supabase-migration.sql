-- Morning Dashboard - Supabase BYOS Migration
-- Database: russell-personal-metrics
-- Run this in your Supabase SQL Editor

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- HEALTH TRACKING TABLES
-- ============================================

-- Weight logs
create table if not exists weight_logs (
  id uuid primary key default uuid_generate_v4(),
  weight numeric(5,2) not null,
  unit text not null default 'kg' check (unit in ('kg', 'lbs')),
  notes text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_weight_logs_logged_at on weight_logs(logged_at desc);

-- Sleep logs
create table if not exists sleep_logs (
  id uuid primary key default uuid_generate_v4(),
  hours numeric(3,1) not null check (hours >= 0 and hours <= 24),
  quality smallint not null check (quality between 1 and 5),
  notes text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_sleep_logs_logged_at on sleep_logs(logged_at desc);

-- Energy logs
create table if not exists energy_logs (
  id uuid primary key default uuid_generate_v4(),
  level smallint not null check (level between 1 and 5),
  time_of_day text not null check (time_of_day in ('morning', 'afternoon', 'evening')),
  notes text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_energy_logs_logged_at on energy_logs(logged_at desc);

-- Daily snapshots (aggregated daily data)
create table if not exists daily_snapshots (
  date date primary key,
  weight numeric(5,2),
  sleep_hours numeric(3,1),
  sleep_quality smallint,
  energy_avg numeric(2,1),
  reminders_completed integer default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- CRYPTO TRACKING
-- ============================================

-- Price alerts
create table if not exists price_alerts (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null,
  target_price numeric(20,8) not null,
  direction text not null check (direction in ('above', 'below')),
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);

create index idx_price_alerts_active on price_alerts(symbol) where triggered_at is null;

-- ============================================
-- REMINDERS & TASKS
-- ============================================

-- Reminders
create table if not exists reminders (
  id uuid primary key default uuid_generate_v4(),
  text text not null,
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_reminders_pending on reminders(priority desc, due_at asc) where completed = false;

-- ============================================
-- GOALS
-- ============================================

-- Goals
create table if not exists goals (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  target_value numeric,
  current_value numeric default 0,
  unit text,
  deadline timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  created_at timestamptz not null default now()
);

create index idx_goals_active on goals(created_at desc) where status = 'active';

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
alter table weight_logs enable row level security;
alter table sleep_logs enable row level security;
alter table energy_logs enable row level security;
alter table daily_snapshots enable row level security;
alter table price_alerts enable row level security;
alter table reminders enable row level security;
alter table goals enable row level security;

-- For service role access (Ultralight uses service key)
-- These policies allow full access when using service_role key
create policy "Service role full access" on weight_logs for all using (true);
create policy "Service role full access" on sleep_logs for all using (true);
create policy "Service role full access" on energy_logs for all using (true);
create policy "Service role full access" on daily_snapshots for all using (true);
create policy "Service role full access" on price_alerts for all using (true);
create policy "Service role full access" on reminders for all using (true);
create policy "Service role full access" on goals for all using (true);

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- Weekly health summary view
create or replace view weekly_health_summary as
select
  date_trunc('week', logged_at)::date as week_start,
  round(avg(weight), 1) as avg_weight,
  count(*) as weight_entries
from weight_logs
where logged_at > now() - interval '8 weeks'
group by date_trunc('week', logged_at)
order by week_start desc;

-- Active reminders with due status
create or replace view active_reminders as
select
  id,
  text,
  due_at,
  priority,
  case
    when due_at is null then 'no_deadline'
    when due_at < now() then 'overdue'
    when due_at < now() + interval '1 day' then 'due_today'
    when due_at < now() + interval '7 days' then 'this_week'
    else 'upcoming'
  end as due_status
from reminders
where completed = false
order by
  case priority when 'high' then 1 when 'medium' then 2 else 3 end,
  due_at nulls last;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to get health trends
create or replace function get_health_trends(days_back integer default 7)
returns table (
  metric text,
  day date,
  value numeric
) language sql as $$
  select 'weight' as metric, logged_at::date as day, weight as value
  from weight_logs
  where logged_at > now() - (days_back || ' days')::interval
  union all
  select 'sleep_hours', logged_at::date, hours
  from sleep_logs
  where logged_at > now() - (days_back || ' days')::interval
  union all
  select 'sleep_quality', logged_at::date, quality::numeric
  from sleep_logs
  where logged_at > now() - (days_back || ' days')::interval
  union all
  select 'energy', logged_at::date, level::numeric
  from energy_logs
  where logged_at > now() - (days_back || ' days')::interval
  order by day, metric
$$;

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Uncomment to insert sample data
/*
insert into weight_logs (weight, unit, logged_at) values
  (75.5, 'kg', now() - interval '6 days'),
  (75.3, 'kg', now() - interval '5 days'),
  (75.1, 'kg', now() - interval '4 days'),
  (75.4, 'kg', now() - interval '3 days'),
  (75.0, 'kg', now() - interval '2 days'),
  (74.8, 'kg', now() - interval '1 day'),
  (74.6, 'kg', now());

insert into sleep_logs (hours, quality, logged_at) values
  (7.5, 4, now() - interval '6 days'),
  (6.0, 3, now() - interval '5 days'),
  (8.0, 5, now() - interval '4 days'),
  (7.0, 4, now() - interval '3 days'),
  (5.5, 2, now() - interval '2 days'),
  (7.5, 4, now() - interval '1 day'),
  (8.0, 5, now());

insert into energy_logs (level, time_of_day, logged_at) values
  (4, 'morning', now() - interval '2 days'),
  (3, 'afternoon', now() - interval '2 days'),
  (4, 'morning', now() - interval '1 day'),
  (4, 'afternoon', now() - interval '1 day'),
  (5, 'morning', now());

insert into reminders (text, priority, due_at) values
  ('Review quarterly goals', 'high', now() + interval '1 day'),
  ('Call dentist', 'medium', now() + interval '3 days'),
  ('Order supplements', 'low', now() + interval '1 week');

insert into goals (title, description, target_value, current_value, unit, deadline) values
  ('Lose 5kg', 'Target weight: 70kg', 5, 2.4, 'kg', now() + interval '3 months'),
  ('Read 12 books', 'One book per month', 12, 3, 'books', '2024-12-31');

insert into price_alerts (symbol, target_price, direction) values
  ('BTC', 100000, 'above'),
  ('ETH', 3000, 'below');
*/
