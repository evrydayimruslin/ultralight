-- Morning Dashboard - Supabase Schema
-- Database: russell-personal-metrics
-- Run this in your Supabase SQL Editor

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- DROP EXISTING TABLES (if rebuilding)
-- ============================================

drop table if exists weight_logs cascade;
drop table if exists sleep_logs cascade;
drop table if exists energy_logs cascade;
drop table if exists reminders cascade;
drop table if exists goals cascade;

-- ============================================
-- HEALTH TRACKING TABLES
-- Uses date as primary key for one entry per day
-- ============================================

-- Weight logs (one per day)
create table weight_logs (
  id uuid primary key default uuid_generate_v4(),
  date date not null unique,
  weight numeric(5,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index idx_weight_logs_date on weight_logs(date desc);

-- Sleep logs (one per day)
create table sleep_logs (
  id uuid primary key default uuid_generate_v4(),
  date date not null unique,
  hours numeric(3,1) not null check (hours >= 0 and hours <= 24),
  quality smallint check (quality is null or (quality between 1 and 10)),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index idx_sleep_logs_date on sleep_logs(date desc);

-- Energy logs (one per day)
create table energy_logs (
  id uuid primary key default uuid_generate_v4(),
  date date not null unique,
  level smallint not null check (level between 1 and 10),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index idx_energy_logs_date on energy_logs(date desc);

-- ============================================
-- REMINDERS
-- ============================================

create table reminders (
  id uuid primary key default uuid_generate_v4(),
  text text not null,
  due_at timestamptz,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_reminders_pending on reminders(created_at desc) where completed = false;

-- ============================================
-- GOALS
-- ============================================

create table goals (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  target numeric not null,
  current numeric not null default 0,
  unit text not null,
  deadline timestamptz,
  created_at timestamptz not null default now()
);

create index idx_goals_active on goals(created_at desc);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
alter table weight_logs enable row level security;
alter table sleep_logs enable row level security;
alter table energy_logs enable row level security;
alter table reminders enable row level security;
alter table goals enable row level security;

-- Service role full access (Ultralight uses service key)
create policy "Service role full access" on weight_logs for all using (true);
create policy "Service role full access" on sleep_logs for all using (true);
create policy "Service role full access" on energy_logs for all using (true);
create policy "Service role full access" on reminders for all using (true);
create policy "Service role full access" on goals for all using (true);

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- Weekly health summary view
create or replace view weekly_health_summary as
select
  date_trunc('week', date)::date as week_start,
  round(avg(weight), 1) as avg_weight,
  count(*) as weight_entries
from weight_logs
where date > current_date - interval '8 weeks'
group by date_trunc('week', date)
order by week_start desc;

-- Daily health snapshot
create or replace view daily_health as
select
  coalesce(w.date, s.date, e.date) as date,
  w.weight,
  s.hours as sleep_hours,
  s.quality as sleep_quality,
  e.level as energy_level,
  e.notes as energy_notes
from weight_logs w
full outer join sleep_logs s on w.date = s.date
full outer join energy_logs e on coalesce(w.date, s.date) = e.date
order by date desc;

-- Active reminders with due status
create or replace view active_reminders as
select
  id,
  text,
  due_at,
  case
    when due_at is null then 'no_deadline'
    when due_at < now() then 'overdue'
    when due_at < now() + interval '1 day' then 'due_today'
    when due_at < now() + interval '7 days' then 'this_week'
    else 'upcoming'
  end as due_status
from reminders
where completed = false
order by due_at nulls last;

-- ============================================
-- SAMPLE DATA (optional - for testing)
-- ============================================

-- Uncomment to add sample data:
/*
insert into weight_logs (date, weight) values
  (current_date - 6, 175.5),
  (current_date - 5, 175.2),
  (current_date - 4, 174.8),
  (current_date - 3, 175.0),
  (current_date - 2, 174.5),
  (current_date - 1, 174.3),
  (current_date, 174.0);

insert into sleep_logs (date, hours, quality) values
  (current_date - 6, 7.5, 7),
  (current_date - 5, 6.0, 5),
  (current_date - 4, 8.0, 8),
  (current_date - 3, 7.0, 6),
  (current_date - 2, 7.5, 7),
  (current_date - 1, 6.5, 6),
  (current_date, 8.0, 9);

insert into energy_logs (date, level, notes) values
  (current_date - 6, 7, null),
  (current_date - 5, 5, 'Tired after poor sleep'),
  (current_date - 4, 8, 'Great day!'),
  (current_date - 3, 6, null),
  (current_date - 2, 7, null),
  (current_date - 1, 6, 'Need more coffee'),
  (current_date, 8, 'Feeling great');

insert into reminders (text, due_at) values
  ('Buy groceries', now() + interval '1 day'),
  ('Call mom', now() + interval '3 days'),
  ('Gym session', now() + interval '1 hour'),
  ('Read book chapter', null);

insert into goals (title, target, current, unit, deadline) values
  ('Lose weight', 170, 174, 'lbs', now() + interval '30 days'),
  ('Read books', 12, 3, 'books', now() + interval '6 months'),
  ('Run miles', 100, 25, 'miles', now() + interval '90 days');
*/
