-- ============================================================
-- B-Bikes Mekaniker Dashboard — New Schema Migration
-- Run this in the Supabase SQL editor to set up the new tables.
-- ============================================================

-- 1. Mechanics table
-- Stores each mechanic with their BikeDesk SKU and daily target.
create table if not exists mechanics (
  id                    text primary key,
  name                  text not null,
  sku                   text not null,
  display_order         integer not null default 0,
  active                boolean not null default true,
  daily_target_quarters integer not null default 30,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Unique constraint on SKU to prevent duplicate mappings
create unique index if not exists mechanics_sku_unique on mechanics (upper(sku));

-- 2. Daily totals table
-- One row per mechanic per day. UPSERT on sync.
create table if not exists daily_totals (
  id          bigserial primary key,
  mechanic_id text not null references mechanics(id) on delete cascade,
  work_date   date not null,
  quarters    integer not null default 0,
  synced_at   timestamptz not null default now(),
  constraint daily_totals_mechanic_date_unique unique (mechanic_id, work_date)
);

create index if not exists daily_totals_work_date_idx on daily_totals (work_date);
create index if not exists daily_totals_mechanic_id_idx on daily_totals (mechanic_id);

-- 3. Sync log table
-- Tracks each sync run for monitoring.
create table if not exists sync_log (
  id                  uuid primary key default gen_random_uuid(),
  status              text not null default 'running',  -- running | completed | failed
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  tickets_fetched     integer,
  materials_processed integer,
  error_message       text
);

create index if not exists sync_log_started_at_idx on sync_log (started_at desc);

-- 4. Seed mechanics from existing mechanic_item_mapping (if it exists)
-- This migrates existing mechanic data to the new table.
-- Only runs if the old table exists.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
    and table_name = 'mechanic_item_mapping'
  ) then
    insert into mechanics (id, name, sku, display_order, active, daily_target_quarters)
    select
      gen_random_uuid()::text,
      mechanic_name,
      mechanic_item_no,
      coalesce(display_order, 0),
      coalesce(active, true),
      30  -- default daily target of 30 quarters (7.5 hours)
    from mechanic_item_mapping
    on conflict do nothing;
  end if;
end $$;

-- 5. Row Level Security
-- daily_totals and sync_log are read-only for anon (TV dashboard reads via API)
-- mechanics are read-only for anon
-- All writes go through service role key (API routes)

alter table mechanics enable row level security;
alter table daily_totals enable row level security;
alter table sync_log enable row level security;

-- Allow service role to do everything (bypasses RLS automatically)
-- Allow anon/authenticated to read
create policy "mechanics_read" on mechanics for select using (true);
create policy "daily_totals_read" on daily_totals for select using (true);
create policy "sync_log_read" on sync_log for select using (true);

-- ============================================================
-- Done. Next step: run setup_supabase_cron.sql.example
-- to set up the daily 16:00 cron job.
-- ============================================================
