# B-Bikes Mekaniker Dashboard — Agent Instructions

## Architecture (New — April 2026)

This app has been rebuilt from scratch. The new architecture is simple and correct.

### Core concept: Daily snapshot sync

At 16:00 each day, the sync engine:
1. Fetches all BikeDesk tickets with `updated_at >= today 00:00`
2. For each ticket, fetches all materials
3. Filters materials client-side by mechanic SKU (API filter is unreliable)
4. Sums `amount` per mechanic
5. UPSERTs into `daily_totals` (mechanic_id, work_date=today, quarters=sum)

This is correct because `amount` is always the actual count, and UPSERT is idempotent.

### Database tables (Supabase)

- `mechanics` — id, name, sku, display_order, active, daily_target_quarters
- `daily_totals` — mechanic_id, work_date (date), quarters (int), synced_at
- `sync_log` — id, status, started_at, finished_at, tickets_fetched, materials_processed, error_message

### Key files

| File | Purpose |
|---|---|
| `lib/sync/bikedesk.ts` | BikeDesk API client + sync logic |
| `lib/sync/save.ts` | Save sync results to Supabase |
| `lib/data/mechanics.ts` | CRUD for mechanics table |
| `lib/data/totals.ts` | Aggregate daily_totals for 3 periods |
| `app/api/sync/manual/route.ts` | Manual sync (authenticated) |
| `app/api/cron/sync/route.ts` | Cron sync (CRON_SECRET) |
| `app/api/dashboard/data/route.ts` | Dashboard data API (public) |
| `app/api/settings/mechanics/route.ts` | Settings CRUD API |
| `app/dashboard/page.tsx` | TV dashboard (public, rotates 3 periods) |
| `app/(authenticated)/page.tsx` | Control panel |
| `app/(authenticated)/reports/page.tsx` | Reports (3 period tables) |
| `app/(authenticated)/settings/page.tsx` | Settings (mechanics management) |
| `supabase/migrations/20260426_new_schema.sql` | DB migration |
| `supabase/admin/setup_supabase_cron.sql.example` | Cron setup |
| `docs/SETUP.md` | Full setup guide |

### Three display periods

All periods end at **yesterday** (data is only reliable after 16:00 sync):
- **I går**: yesterday only
- **Aktuel uge**: Monday to yesterday
- **Aktuel måned**: 1st of month to yesterday

### Do NOT modify

- The sync strategy (daily snapshot + UPSERT) — it is correct by design
- The SKU filtering (must be client-side — BikeDesk API filter is unreliable)
- The period end date (must be yesterday, not today)
