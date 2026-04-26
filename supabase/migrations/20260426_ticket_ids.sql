-- ============================================================
-- B-Bikes Mekaniker Dashboard — Add ticket_ids to daily_totals
-- Run this AFTER 20260426_new_schema.sql
-- ============================================================

-- Add ticket_ids column to daily_totals.
-- Stores an array of BikeDesk ticket IDs (arbejdskort) that contributed
-- to a mechanic's quarters on a given day.
alter table daily_totals
  add column if not exists ticket_ids integer[] not null default '{}';

-- ============================================================
-- Done.
-- ============================================================
