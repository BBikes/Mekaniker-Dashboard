# Backfill and Recalc Runbook

This runbook assumes the deterministic mechanic-day sync changes are already deployed and that `daily_ticket_item_baselines` is the source of truth for recomputing `daily_mechanic_totals`.

## 1. Apply schema changes

Run the migration in order:

```sql
-- supabase/migrations/015_add_source_trace_columns.sql
```

If rollback is needed, use:

```sql
-- supabase/rollbacks/015_rollback.sql
```

## 2. Start with a bounded window

Do not start with full history. Begin with a 30-90 day interval.

Edit the date range in:

```sql
-- supabase/admin/recalculate_mechanic_date_range.sql
```

Then run the full script in the Supabase SQL editor.

## 3. Review the reconciliation output

The recalc script emits three result sets:

1. Before/after row counts and total quarters/hours for the bounded range.
2. Per-day/per-mechanic deltas between the old and rebuilt `daily_mechanic_totals`.
3. Anomaly counts grouped by `category` and `resolution`.

Checks before widening the range:

- `after_row_count` is plausible for the chosen interval.
- `after_quarters_total` and `after_hours_total` match expectations from `daily_ticket_item_baselines`.
- Per-day deltas are explainable, especially rows affected by negative same-day corrections.
- `material_date_mismatch`, `missing_mapping`, and `missing_lifecycle` anomaly counts are stable and unsurprising.

## 4. Widen the range

If the bounded run is acceptable:

1. Expand the date range in the recalc script.
2. Re-run the same SQL.
3. Re-check the three outputs.

Only widen to full history after the limited-window reconciliation is clean.

## 5. Post-run validation

After the recalc:

- Run the app test suite locally.
- Spot-check 3 dashboard totals against `daily_ticket_item_baselines`.
- Confirm detailed exports expose `ticket_material_id`, `source_stat_date`, `source_decision_reason`, and `source_sync_event_id`.
- Monitor the next scheduled syncs for anomaly-rate spikes.
