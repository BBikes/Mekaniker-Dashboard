-- Migration 013: Stable mechanic sync state
-- Tracks whether a mechanic ticket-material row is trusted, unresolved, recovered,
-- adjusted, or replaced so dashboard warnings are based on unresolved sync state.

ALTER TABLE public.daily_ticket_item_baselines
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS last_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS missing_since timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.daily_ticket_item_baselines
  DROP CONSTRAINT IF EXISTS daily_ticket_item_baselines_sync_state_check;

ALTER TABLE public.daily_ticket_item_baselines
  ADD CONSTRAINT daily_ticket_item_baselines_sync_state_check
  CHECK (sync_state IN ('ok', 'unresolved_missing', 'recovered', 'adjusted', 'replaced'));

UPDATE public.daily_ticket_item_baselines
SET
  sync_state = 'unresolved_missing',
  missing_since = COALESCE(missing_since, updated_at),
  last_validated_at = COALESCE(last_validated_at, updated_at)
WHERE anomaly_code = 'missing_in_latest_fetch'
  AND sync_state = 'ok';

CREATE INDEX IF NOT EXISTS daily_ticket_item_baselines_sync_state_idx
  ON public.daily_ticket_item_baselines (stat_date, sync_state);

CREATE INDEX IF NOT EXISTS daily_ticket_item_baselines_unresolved_missing_idx
  ON public.daily_ticket_item_baselines (stat_date, mechanic_id)
  WHERE sync_state = 'unresolved_missing';
