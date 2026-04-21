-- Rollback for 013_stable_mechanic_sync_state.sql

DROP INDEX IF EXISTS public.daily_ticket_item_baselines_unresolved_missing_idx;
DROP INDEX IF EXISTS public.daily_ticket_item_baselines_sync_state_idx;

ALTER TABLE public.daily_ticket_item_baselines
  DROP CONSTRAINT IF EXISTS daily_ticket_item_baselines_sync_state_check;

ALTER TABLE public.daily_ticket_item_baselines
  DROP COLUMN IF EXISTS sync_state,
  DROP COLUMN IF EXISTS last_validated_at,
  DROP COLUMN IF EXISTS missing_since,
  DROP COLUMN IF EXISTS resolved_at;
