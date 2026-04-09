# B-Bikes Workshop Statistics

Minimal intern workshop-statistik app til B-Bikes.

## Scope i denne fase

- Supabase schema for mechanic item mappings, daily baselines, daily totals og sync logs
- Customers 1st probe og manuel sync
- TV-dashboard side
- Rapport/export side
- Automatisk sync via Supabase Cron
- Ingen historisk backfill; appen samler data fra aktuel dag og frem

## Environment

Kopier `.env.example` til `.env.local` og udfyld:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `C1ST_API_TOKEN`
- `CRON_SECRET`

Valgfrit:

- `SUPABASE_URL`
- `C1ST_API_BASE_URL`
- `C1ST_DEFAULT_PAGE_LENGTH`
- `C1ST_EXTRA_TICKET_MATERIAL_QUERY`

Bemark:

- serveren bruger `SUPABASE_URL`, hvis den er sat
- ellers falder serveren tilbage til `NEXT_PUBLIC_SUPABASE_URL`
- efter andringer i Vercel environment variables skal appen redeployes

## Supabase setup

1. Kor SQL-filen `supabase/migrations/001_phase1_workshop_stats.sql` mod det rigtige Supabase-projekt.
2. Opret mindst en intern bruger i Supabase Auth for forste login.
3. Aktivér `pg_cron`, `pg_net` og `vault` i Supabase.
4. Kor SQL-template i `supabase/admin/setup_supabase_cron.sql.example` efter du har indsat rigtig app-URL og `CRON_SECRET`.

## Kor lokalt

```bash
npm install
npm run dev
```

Aabn:

- `/` for internt kontrolpanel
- `/dashboard` for TV-dashboard
- `/reports` for rapport/export
- `/settings` for mekaniker-opsaetning og TV-board rotation

## Manuel verificering

1. Log ind med Supabase Auth-brugeren.
2. Aabn `/`.
3. Kor `Probe API` for at se live Customers 1st-normalisering.
4. Aabn `/settings` og opret mekaniker-mappings.
5. Vaelg hvilke TV-boards der skal vaere aktive, deres raekkefoelge og hvor laenge hvert board skal vises.
6. Kor `Opret dagens baseline` en gang ved dagens start hvis du vil teste manuelt.
7. Kor `Kor sync nu` for at hente aktuelle ticket-material maengder.
8. Aabn `/dashboard`.

## Noter

- Automatisk 10-minutters sync korer via Supabase Cron og kalder `/api/cron/sync` med `CRON_SECRET`.
- Scheduled route korer baseline plus normal sync uden historisk import.
- Manuel sync er stadig tilgaengelig fra kontrolpanelet.
- KPI beregnes kun ud fra de mekaniker-varenumre, der er oprettet under `/settings`.
- Hvis Customers 1st-kontrakten afviger fra antagelserne, juster normalizeren i `lib/c1st/normalize-ticket-material.ts`.
