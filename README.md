# B-Bikes Workshop Statistics

Minimal internal workshop statistics app for B-Bikes.

## Scope in this phase

- Supabase schema for mechanic item mappings, daily baselines, daily totals, and sync logs
- Customers 1st ticket-material probe and manual sync
- TV dashboard page
- Report/export page

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `C1ST_API_TOKEN`

Optional:

- `C1ST_API_BASE_URL`
- `C1ST_DEFAULT_PAGE_LENGTH`
- `C1ST_USE_UPDATED_AFTER`
- `C1ST_UPDATED_AFTER_PARAM`
- `C1ST_EXTRA_TICKET_MATERIAL_QUERY`

## Supabase setup

Run the SQL in `supabase/migrations/001_phase1_workshop_stats.sql` against the target Supabase project.

Seed `mechanic_item_mapping` with one row per mechanic item number before syncing.

## Run locally

```bash
npm install
npm run dev
```

Open:

- `/` for the internal control page
- `/dashboard` for the TV dashboard
- `/reports` for report/export

## Manual verification flow

1. Seed `mechanic_item_mapping`.
2. Open `/`.
3. Run `Probe API` to inspect live Customers 1st normalization.
4. Run `Seed Today Baseline` once at the start of day.
5. Run `Sync Now` to pull current ticket-material quantities.
6. Open `/dashboard`.

## Notes

- Phase 1 is poll-first. There is no automatic 10-minute scheduler or webhook ingestion yet.
- If the Customers 1st contract differs from the documented assumptions, adjust the normalizer in `lib/c1st/normalize-ticket-material.ts`.
