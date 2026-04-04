# B-Bikes Workshop Statistics

Minimal internal workshop statistics app for B-Bikes.

## Scope in this phase

- Supabase schema for mechanic item mappings, daily baselines, daily totals, and sync logs
- Customers 1st ticket-material probe and manual sync
- Initial 90-day backfill on first successful cron run
- TV dashboard page
- Report/export page

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `C1ST_API_TOKEN`
- `CRON_SECRET`

Optional:

- `C1ST_API_BASE_URL`
- `C1ST_DEFAULT_PAGE_LENGTH`
- `C1ST_USE_UPDATED_AFTER`
- `C1ST_UPDATED_AFTER_PARAM`
- `C1ST_EXTRA_TICKET_MATERIAL_QUERY`

## Supabase setup

Run the SQL in `supabase/migrations/001_phase1_workshop_stats.sql` against the target Supabase project.

Create at least one internal user in Supabase Auth before first login.

## Run locally

```bash
npm install
npm run dev
```

Open:

- `/` for the internal control page
- `/dashboard` for the TV dashboard
- `/reports` for report/export
- `/settings` for mechanic setup

## Manual verification flow

1. Log in with the Supabase Auth user.
2. Open `/`.
3. Run `Probe API` to inspect live Customers 1st normalization.
4. Open `/settings` and add the mechanic item mappings.
5. Run `Opret dagens baseline` once at the start of day.
6. Run `Kør sync nu` to pull current ticket-material quantities.
7. Open `/dashboard`.

## Notes

- Automatic 10-minute sync is configured through `vercel.json` and `/api/cron/sync`. It requires `CRON_SECRET` on the production deployment.
- The cron route creates the initial 90-day backfill once, then continues with daily baseline plus current sync.
- Manual sync remains available from the control panel.
- If the Customers 1st contract differs from the documented assumptions, adjust the normalizer in `lib/c1st/normalize-ticket-material.ts`.
