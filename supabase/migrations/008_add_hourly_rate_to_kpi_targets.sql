-- Migration 008: Add hourly_rate to revenue_kpi_targets
-- Arbeidstid revenue = hours_total × hourly_rate (not line_total_incl_vat which is sparse)

INSERT INTO revenue_kpi_targets (metric_key, daily_target)
VALUES ('hourly_rate', 450)
ON CONFLICT (metric_key) DO NOTHING;
