-- Migration 008: Payment-based revenue tracking
-- Replaces the sync-date approach in daily_ticket_revenue with a
-- payment-date approach sourced directly from /pospayments.

-- Cache of ticket types so we can determine repair vs. sale for payments
CREATE TABLE IF NOT EXISTS ticket_type_cache (
  ticket_id  bigint      PRIMARY KEY,
  ticket_type text,                        -- 'repair' | 'sale' | null
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-payment revenue summary keyed on the actual payment date
CREATE TABLE IF NOT EXISTS daily_payment_summary (
  payment_id             bigint      PRIMARY KEY,
  payment_date           date        NOT NULL,
  mechanic_total_incl_vat numeric    NOT NULL DEFAULT 0,  -- sum of mechanic-item articles
  ticket_total_incl_vat  numeric    NOT NULL DEFAULT 0,   -- full payment sum (all articles)
  is_repair              boolean     NOT NULL DEFAULT false,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_payment_summary_date_idx
  ON daily_payment_summary (payment_date);

-- Also insert hourly_rate into revenue_kpi_targets if not already there
INSERT INTO revenue_kpi_targets (metric_key, daily_target) VALUES
  ('hourly_rate', 450)
ON CONFLICT (metric_key) DO NOTHING;
