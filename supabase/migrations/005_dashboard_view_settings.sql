create table if not exists public.dashboard_view_settings (
  board_type text primary key,
  board_title text not null,
  display_order integer not null default 0,
  duration_seconds integer not null default 20,
  active boolean not null default true,
  selected_mechanic_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_view_settings_board_type_check check (
    board_type in (
      'today',
      'last_week',
      'last_month',
      'current_week',
      'current_month',
      'mechanic_focus'
    )
  ),
  constraint dashboard_view_settings_duration_check check (duration_seconds >= 5)
);

insert into public.dashboard_view_settings (board_type, board_title, display_order, duration_seconds, active)
select board_type, board_title, display_order, duration_seconds, active
from (
  values
    ('today', 'I dag', 0, 20, true),
    ('last_week', 'Seneste uge', 1, 20, true),
    ('last_month', 'Seneste måned', 2, 20, true),
    ('current_week', 'Aktuel uge', 3, 20, true),
    ('current_month', 'Aktuel måned', 4, 20, true),
    ('mechanic_focus', 'Mekaniker-fokus', 5, 20, false)
) as seed(board_type, board_title, display_order, duration_seconds, active)
on conflict (board_type) do nothing;