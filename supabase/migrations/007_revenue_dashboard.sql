-- Migration 007: Revenue dashboard
-- Adds ticket_type and line_total_incl_vat to baselines,
-- CykelPlus snapshot table, revenue KPI targets, and new board types.

-- 1a. Nye kolonner på daily_ticket_item_baselines
ALTER TABLE daily_ticket_item_baselines
  ADD COLUMN IF NOT EXISTS ticket_type text,            -- 'repair' | 'sale' | null
  ADD COLUMN IF NOT EXISTS line_total_incl_vat numeric; -- total_incl_vat fra Bikedesk API

-- 1b. CykelPlus snapshots – opdateres ved hver sync
CREATE TABLE IF NOT EXISTS cykelplus_snapshots (
  snapshot_date date        PRIMARY KEY,
  customer_count integer    NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 1c. Revenue KPI targets – daglige mål (skaleres til uge/måned via arbejdsdage)
CREATE TABLE IF NOT EXISTS revenue_kpi_targets (
  metric_key   text        PRIMARY KEY, -- 'arbeidstid' | 'repair' | 'cykelplus'
  daily_target numeric     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO revenue_kpi_targets (metric_key, daily_target) VALUES
  ('arbeidstid', 0),
  ('repair',     0),
  ('cykelplus',  0)
ON CONFLICT (metric_key) DO NOTHING;

-- 1d. Nye board-typer i dashboard_view_settings (inaktive som standard)
ALTER TABLE dashboard_view_settings DROP CONSTRAINT IF EXISTS dashboard_view_settings_board_type_check;
ALTER TABLE dashboard_view_settings ADD CONSTRAINT dashboard_view_settings_board_type_check CHECK (
  board_type in (
    'today',
    'last_week',
    'last_month',
    'current_week',
    'current_month',
    'mechanic_focus',
    'revenue_today',
    'revenue_current_week',
    'revenue_current_month'
  )
);

INSERT INTO dashboard_view_settings
  (board_type, board_title, display_order, duration_seconds, active, selected_mechanic_ids, selected_focus_metric_keys)
VALUES
  ('revenue_today',         'Omsætning i dag',        6, 20, false, '{}', '{}'),
  ('revenue_current_week',  'Omsætning aktuel uge',   7, 20, false, '{}', '{}'),
  ('revenue_current_month', 'Omsætning aktuel måned', 8, 20, false, '{}', '{}')
ON CONFLICT (board_type) DO NOTHING;
