-- Recalculate daily_mechanic_totals for a bounded date range from
-- daily_ticket_item_baselines only.
--
-- How to use:
-- 1. Edit the two dates in the _recalc_params temp table below.
-- 2. Run the full script in the Supabase SQL editor.
-- 3. Review the reconciliation output before widening the range.

BEGIN;

CREATE TEMP TABLE _recalc_params ON COMMIT DROP AS
SELECT
  DATE '2026-04-01' AS from_date,
  DATE '2026-04-30' AS to_date;

CREATE TEMP TABLE _recalc_previous_totals ON COMMIT DROP AS
SELECT
  stat_date,
  mechanic_id,
  quarters_total,
  hours_total,
  target_hours,
  variance_hours
FROM public.daily_mechanic_totals
WHERE stat_date BETWEEN
  (SELECT from_date FROM _recalc_params)
  AND (SELECT to_date FROM _recalc_params);

CREATE TEMP TABLE _recalc_source_totals ON COMMIT DROP AS
SELECT
  b.stat_date,
  b.mechanic_id,
  ROUND(COALESCE(SUM(b.today_added_quantity), 0), 2) AS quarters_total,
  ROUND(COALESCE(SUM(b.today_added_hours), 0), 2) AS hours_total
FROM public.daily_ticket_item_baselines AS b
WHERE b.stat_date BETWEEN
  (SELECT from_date FROM _recalc_params)
  AND (SELECT to_date FROM _recalc_params)
GROUP BY b.stat_date, b.mechanic_id;

DELETE FROM public.daily_mechanic_totals
WHERE stat_date BETWEEN
  (SELECT from_date FROM _recalc_params)
  AND (SELECT to_date FROM _recalc_params);

INSERT INTO public.daily_mechanic_totals (
  stat_date,
  mechanic_id,
  quarters_total,
  hours_total,
  target_hours,
  variance_hours,
  last_recalculated_at,
  created_at,
  updated_at
)
SELECT
  source.stat_date,
  source.mechanic_id,
  source.quarters_total,
  source.hours_total,
  COALESCE(previous.target_hours, mapping.daily_target_hours, 0) AS target_hours,
  ROUND(source.hours_total - COALESCE(previous.target_hours, mapping.daily_target_hours, 0), 2) AS variance_hours,
  clock_timestamp() AS last_recalculated_at,
  clock_timestamp() AS created_at,
  clock_timestamp() AS updated_at
FROM _recalc_source_totals AS source
LEFT JOIN _recalc_previous_totals AS previous
  ON previous.stat_date = source.stat_date
 AND previous.mechanic_id = source.mechanic_id
LEFT JOIN public.mechanic_item_mapping AS mapping
  ON mapping.id = source.mechanic_id
ON CONFLICT (stat_date, mechanic_id) DO UPDATE
SET
  quarters_total = EXCLUDED.quarters_total,
  hours_total = EXCLUDED.hours_total,
  target_hours = EXCLUDED.target_hours,
  variance_hours = EXCLUDED.variance_hours,
  last_recalculated_at = EXCLUDED.last_recalculated_at,
  updated_at = EXCLUDED.updated_at;

CREATE TEMP TABLE _recalc_after_totals ON COMMIT DROP AS
SELECT
  stat_date,
  mechanic_id,
  quarters_total,
  hours_total,
  target_hours,
  variance_hours
FROM public.daily_mechanic_totals
WHERE stat_date BETWEEN
  (SELECT from_date FROM _recalc_params)
  AND (SELECT to_date FROM _recalc_params);

SELECT
  (SELECT from_date FROM _recalc_params) AS from_date,
  (SELECT to_date FROM _recalc_params) AS to_date,
  (SELECT COUNT(*) FROM _recalc_previous_totals) AS before_row_count,
  (SELECT COUNT(*) FROM _recalc_after_totals) AS after_row_count,
  COALESCE((SELECT ROUND(SUM(quarters_total), 2) FROM _recalc_previous_totals), 0) AS before_quarters_total,
  COALESCE((SELECT ROUND(SUM(quarters_total), 2) FROM _recalc_after_totals), 0) AS after_quarters_total,
  COALESCE((SELECT ROUND(SUM(hours_total), 2) FROM _recalc_previous_totals), 0) AS before_hours_total,
  COALESCE((SELECT ROUND(SUM(hours_total), 2) FROM _recalc_after_totals), 0) AS after_hours_total;

SELECT
  COALESCE(after_totals.stat_date, previous.stat_date) AS stat_date,
  COALESCE(after_totals.mechanic_id, previous.mechanic_id) AS mechanic_id,
  COALESCE(previous.quarters_total, 0) AS before_quarters_total,
  COALESCE(after_totals.quarters_total, 0) AS after_quarters_total,
  COALESCE(previous.hours_total, 0) AS before_hours_total,
  COALESCE(after_totals.hours_total, 0) AS after_hours_total,
  ROUND(COALESCE(after_totals.quarters_total, 0) - COALESCE(previous.quarters_total, 0), 2) AS quarter_delta,
  ROUND(COALESCE(after_totals.hours_total, 0) - COALESCE(previous.hours_total, 0), 2) AS hour_delta
FROM _recalc_previous_totals AS previous
FULL OUTER JOIN _recalc_after_totals AS after_totals
  ON after_totals.stat_date = previous.stat_date
 AND after_totals.mechanic_id = previous.mechanic_id
ORDER BY stat_date, mechanic_id;

SELECT
  category,
  resolution,
  COUNT(*) AS anomaly_rows
FROM public.sync_anomaly_log
WHERE stat_date BETWEEN
  (SELECT from_date FROM _recalc_params)
  AND (SELECT to_date FROM _recalc_params)
GROUP BY category, resolution
ORDER BY category, resolution;

COMMIT;
