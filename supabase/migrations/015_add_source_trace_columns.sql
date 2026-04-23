-- Migration 015: Add sync source traceability and anomaly categories
-- Extends the daily mechanic fact table with sync-run traceability and makes
-- sync_anomaly_log idempotent per stat_date + ticket_material_id + category.

ALTER TABLE public.daily_ticket_item_baselines
  ADD COLUMN IF NOT EXISTS source_stat_date date,
  ADD COLUMN IF NOT EXISTS source_decision_reason text,
  ADD COLUMN IF NOT EXISTS source_sync_event_id uuid REFERENCES public.sync_event_log(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS daily_ticket_item_baselines_source_stat_date_idx
  ON public.daily_ticket_item_baselines (source_stat_date);

CREATE INDEX IF NOT EXISTS daily_ticket_item_baselines_source_sync_event_idx
  ON public.daily_ticket_item_baselines (source_sync_event_id);

ALTER TABLE public.sync_anomaly_log
  ADD COLUMN IF NOT EXISTS category text;

UPDATE public.sync_anomaly_log
SET category = 'missing_lifecycle'
WHERE category IS NULL;

ALTER TABLE public.sync_anomaly_log
  ALTER COLUMN category SET DEFAULT 'missing_lifecycle';

ALTER TABLE public.sync_anomaly_log
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE public.sync_anomaly_log
  DROP CONSTRAINT IF EXISTS sync_anomaly_log_category_check;

ALTER TABLE public.sync_anomaly_log
  ADD CONSTRAINT sync_anomaly_log_category_check
  CHECK (category IN (
    'same_day_negative_correction',
    'material_date_mismatch',
    'missing_mapping',
    'missing_lifecycle'
  ));

WITH ranked_duplicates AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY stat_date, ticket_material_id, category
      ORDER BY created_at DESC, id DESC
    ) AS row_rank
  FROM public.sync_anomaly_log
)
DELETE FROM public.sync_anomaly_log AS log
USING ranked_duplicates AS ranked
WHERE log.id = ranked.id
  AND ranked.row_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS sync_anomaly_log_stat_date_material_category_uidx
  ON public.sync_anomaly_log (stat_date, ticket_material_id, category);

CREATE INDEX IF NOT EXISTS sync_anomaly_log_category_idx
  ON public.sync_anomaly_log (category, stat_date DESC);
