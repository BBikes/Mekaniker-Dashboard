create extension if not exists pg_trgm;

create index if not exists daily_ticket_item_baselines_payment_idx
  on public.daily_ticket_item_baselines (source_payment_id)
  where source_payment_id is not null;

create index if not exists daily_ticket_item_baselines_anomaly_idx
  on public.daily_ticket_item_baselines (anomaly_code)
  where anomaly_code is not null;

create index if not exists daily_ticket_item_baselines_item_no_trgm_idx
  on public.daily_ticket_item_baselines using gin (mechanic_item_no gin_trgm_ops);
