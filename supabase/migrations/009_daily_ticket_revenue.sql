-- Migration 009: daily_ticket_revenue table
-- Stores per-ticket cash register totals: mechanic time portion and full ticket total.
-- Populated only when a ticket has been paid (paymentId is not null on any line).

CREATE TABLE IF NOT EXISTS daily_ticket_revenue (
  stat_date               date        NOT NULL,
  ticket_id               bigint      NOT NULL,
  ticket_type             text,
  payment_id              bigint,
  mechanic_total_incl_vat numeric     NOT NULL DEFAULT 0,
  ticket_total_incl_vat   numeric     NOT NULL DEFAULT 0,
  line_count              integer     NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_ticket_revenue_pkey PRIMARY KEY (stat_date, ticket_id)
);

CREATE INDEX IF NOT EXISTS daily_ticket_revenue_stat_date_idx
  ON daily_ticket_revenue (stat_date);

CREATE INDEX IF NOT EXISTS daily_ticket_revenue_ticket_type_idx
  ON daily_ticket_revenue (ticket_type)
  WHERE ticket_type IS NOT NULL;

ALTER TABLE daily_ticket_revenue ENABLE ROW LEVEL SECURITY;
