-- Targeted Supabase schema rollback to the pre-revenue baseline (79dbc0d).
-- Review before executing against the shared database.

begin;

delete from public.dashboard_view_settings
where board_type in (
  'revenue_today',
  'revenue_current_week',
  'revenue_current_month'
);

alter table if exists public.dashboard_view_settings
  drop constraint if exists dashboard_view_settings_board_type_check;

alter table if exists public.dashboard_view_settings
  add constraint dashboard_view_settings_board_type_check check (
    board_type in (
      'today',
      'last_week',
      'last_month',
      'current_week',
      'current_month',
      'mechanic_focus'
    )
  );

drop table if exists public.daily_payment_summary;
drop table if exists public.ticket_type_cache;
drop table if exists public.daily_ticket_revenue;
drop table if exists public.revenue_kpi_targets;
drop table if exists public.cykelplus_snapshots;

alter table if exists public.daily_ticket_item_baselines
  drop column if exists ticket_type,
  drop column if exists line_total_incl_vat;

commit;
