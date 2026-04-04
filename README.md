# B-Bikes Workshop Statistics

Minimal intern workshop-statistik app til B-Bikes.

## Scope i denne fase

- Supabase schema for mechanic item mappings, daily baselines, daily totals og sync logs
- Customers 1st ticket-material probe og manuel sync
- Initial 90-dages backfill ved første vellykkede automatiske sync
- TV-dashboard side
- Rapport/export side
- Automatisk sync via Supabase Cron

## Environment

Kopiér `.env.example` til `.env.local` og udfyld:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `C1ST_API_TOKEN`
- `CRON_SECRET`

Valgfrit:

- `SUPABASE_URL`
- `C1ST_API_BASE_URL`
- `C1ST_DEFAULT_PAGE_LENGTH`
- `C1ST_USE_UPDATED_AFTER`
- `C1ST_UPDATED_AFTER_PARAM`
- `C1ST_EXTRA_TICKET_MATERIAL_QUERY`

Bemærk:

- serveren bruger `SUPABASE_URL`, hvis den er sat
- ellers falder serveren tilbage til `NEXT_PUBLIC_SUPABASE_URL`
- efter ændringer i Vercel environment variables skal appen redeployes

## Supabase setup

1. Kør SQL-filen `supabase/migrations/001_phase1_workshop_stats.sql` mod det rigtige Supabase-projekt.
2. Opret mindst én intern bruger i Supabase Auth før første login.
3. Aktivér `pg_cron`, `pg_net` og `vault` i Supabase.
4. Kør SQL-template i `supabase/admin/setup_supabase_cron.sql.example` efter du har indsat rigtig app-URL og `CRON_SECRET`.

## Kør lokalt

```bash
npm install
npm run dev
```

Åbn:

- `/` for internt kontrolpanel
- `/dashboard` for TV-dashboard
- `/reports` for rapport/export
- `/settings` for mekaniker-opsætning

## Manuel verificering

1. Log ind med Supabase Auth-brugeren.
2. Åbn `/`.
3. Kør `Probe API` for at se live Customers 1st-normalisering.
4. Åbn `/settings` og opret mekaniker-mappings.
5. Kør `Opret dagens baseline` én gang ved dagens start hvis du vil teste manuelt.
6. Kør `Kør sync nu` for at hente aktuelle ticket-material mængder.
7. Åbn `/dashboard`.

## Noter

- Automatisk 10-minutters sync kører via Supabase Cron og kalder `/api/cron/sync` med `CRON_SECRET`.
- Scheduled route laver første 90-dages backfill én gang og fortsætter derefter med baseline plus normal sync.
- Manuel sync er stadig tilgængelig fra kontrolpanelet.
- Hvis Customers 1st-kontrakten afviger fra antagelserne, justér normalizeren i `lib/c1st/normalize-ticket-material.ts`.
