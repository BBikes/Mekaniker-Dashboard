-- ============================================================
-- B-Bikes Mekaniker Dashboard — Board Settings Migration
-- Run this AFTER 20260426_new_schema.sql
-- ============================================================

-- board_settings: controls which boards are shown on TV dashboard and reports.
-- One row per board type. Seeded with defaults below.
create table if not exists board_settings (
  board_type  text primary key,  -- 'today' | 'yesterday' | 'current_week' | 'current_month'
  active      boolean not null default true,
  label       text not null,
  sort_order  integer not null default 0
);

-- Seed defaults
insert into board_settings (board_type, active, label, sort_order) values
  ('today',         false, 'I dag',        1),
  ('yesterday',     true,  'I går',        2),
  ('current_week',  true,  'Aktuel uge',   3),
  ('current_month', true,  'Aktuel måned', 4)
on conflict (board_type) do nothing;

-- RLS: readable by all, writable only via service role
alter table board_settings enable row level security;
create policy "board_settings_read" on board_settings for select using (true);

-- ============================================================
-- Done.
-- ============================================================
