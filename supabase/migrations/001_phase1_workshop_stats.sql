create extension if not exists pgcrypto;

create table if not exists public.mechanic_item_mapping (
  id uuid primary key default gen_random_uuid(),
  mechanic_name text not null,
  mechanic_item_no text not null unique,
  daily_target_hours numeric(6,2) not null default 8.0,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_ticket_item_baselines (
  id uuid primary key default gen_random_uuid(),
  stat_date date not null,
  ticket_material_id bigint not null,
  ticket_id bigint not null,
  mechanic_id uuid not null references public.mechanic_item_mapping(id) on delete cascade,
  mechanic_item_no text not null,
  baseline_quantity numeric(10,2) not null default 0,
  current_quantity numeric(10,2) not null default 0,
  today_added_quantity numeric(10,2) not null default 0,
  today_added_hours numeric(10,2) not null default 0,
  source_updated_at timestamptz,
  source_payment_id bigint,
  source_amountpaid numeric(10,2),
  last_seen_at timestamptz,
  anomaly_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_ticket_item_baselines_date_material_unique unique (stat_date, ticket_material_id)
);

create index if not exists daily_ticket_item_baselines_stat_date_idx
  on public.daily_ticket_item_baselines (stat_date);

create index if not exists daily_ticket_item_baselines_mechanic_date_idx
  on public.daily_ticket_item_baselines (mechanic_id, stat_date);

create index if not exists daily_ticket_item_baselines_ticket_idx
  on public.daily_ticket_item_baselines (ticket_id);

create table if not exists public.daily_mechanic_totals (
  id uuid primary key default gen_random_uuid(),
  stat_date date not null,
  mechanic_id uuid not null references public.mechanic_item_mapping(id) on delete cascade,
  quarters_total numeric(10,2) not null default 0,
  hours_total numeric(10,2) not null default 0,
  target_hours numeric(6,2) not null default 8.0,
  variance_hours numeric(10,2) not null default 0,
  last_recalculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_mechanic_totals_date_mechanic_unique unique (stat_date, mechanic_id)
);

create index if not exists daily_mechanic_totals_stat_date_idx
  on public.daily_mechanic_totals (stat_date);

create table if not exists public.sync_event_log (
  id uuid primary key default gen_random_uuid(),
  sync_type text not null,
  status text not null,
  window_start timestamptz,
  window_end timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  http_calls integer not null default 0,
  tickets_seen integer not null default 0,
  materials_seen integer not null default 0,
  rows_upserted integer not null default 0,
  rows_corrected integer not null default 0,
  anomaly_count integer not null default 0,
  message text,
  details_json jsonb not null default '{}'::jsonb
);

create index if not exists sync_event_log_started_at_idx
  on public.sync_event_log (started_at desc);
