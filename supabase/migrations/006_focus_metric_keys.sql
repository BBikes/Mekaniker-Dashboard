alter table public.dashboard_view_settings
add column if not exists selected_focus_metric_keys text[] not null default '{today,current_week,current_month}';

update public.dashboard_view_settings
set selected_focus_metric_keys = '{today,current_week,current_month}'
where board_type = 'mechanic_focus'
  and (
    selected_focus_metric_keys is null
    or cardinality(selected_focus_metric_keys) = 0
  );