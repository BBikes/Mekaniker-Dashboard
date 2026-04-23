-- Rollback for 015_add_source_trace_columns.sql

DROP INDEX IF EXISTS public.sync_anomaly_log_category_idx;
DROP INDEX IF EXISTS public.sync_anomaly_log_stat_date_material_category_uidx;

ALTER TABLE public.sync_anomaly_log
  DROP CONSTRAINT IF EXISTS sync_anomaly_log_category_check;

ALTER TABLE public.sync_anomaly_log
  ALTER COLUMN category DROP DEFAULT;

ALTER TABLE public.sync_anomaly_log
  DROP COLUMN IF EXISTS category;

DROP INDEX IF EXISTS public.daily_ticket_item_baselines_source_sync_event_idx;
DROP INDEX IF EXISTS public.daily_ticket_item_baselines_source_stat_date_idx;

ALTER TABLE public.daily_ticket_item_baselines
  DROP COLUMN IF EXISTS source_sync_event_id,
  DROP COLUMN IF EXISTS source_decision_reason,
  DROP COLUMN IF EXISTS source_stat_date;
