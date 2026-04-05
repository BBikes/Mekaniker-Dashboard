# Admin panel — implementeringsplan til Codex

Lokation på disk: `C:\Users\patri\.gemini\antigravity\playground\B-Bikes\Mekaniker dashboard`

Formål: udvid det eksisterende interne modul med et praktisk admin-panel til historik, søgning,
filtrering og eksport. TV-dashboardet forbliver urørt og simpelt. Ingen tung BI. Ingen overbuild.

---

## 0. Kontekst fra den aktuelle kodebase (VERIFICERET)

Det følgende eksisterer allerede på disk og skal genbruges — ikke duplikeres.

### Database-skema
`supabase/migrations/001_phase1_workshop_stats.sql`
- `mechanic_item_mapping(id, mechanic_name, mechanic_item_no UNIQUE, daily_target_hours, display_order, active, ...)`
- `daily_ticket_item_baselines(id, stat_date, ticket_material_id, ticket_id, mechanic_id, mechanic_item_no, baseline_quantity, current_quantity, today_added_quantity, today_added_hours, source_updated_at, source_payment_id, source_amountpaid, last_seen_at, anomaly_code, ...)`
  - Indeks: `(stat_date)`, `(mechanic_id, stat_date)`, `(ticket_id)`
  - Unik: `(stat_date, ticket_material_id)`
- `daily_mechanic_totals(stat_date, mechanic_id, quarters_total, hours_total, target_hours, variance_hours, ...)`
  - Indeks: `(stat_date)`; Unik: `(stat_date, mechanic_id)`
- `sync_event_log(...)` med indeks på `started_at desc`

### Data-lag
`lib/data/reports.ts` eksporterer allerede:
- `type ReportFilters = { fromDate, toDate, periodMode, exportMode, mechanicId? }`
- `type PeriodMode = "daily" | "weekly_avg" | "monthly_avg"`
- `type ExportMode = "summary" | "detailed"`
- `getActiveMechanics()` — henter `id, mechanic_name` fra `mechanic_item_mapping` hvor `active = true`
- `getSummaryRows(filters)` — joiner `daily_mechanic_totals` × `mechanic_item_mapping`, understøtter daglig / ugesnit / månedssnit
- `getDetailedRows(filters)` — læser `daily_ticket_item_baselines` med join til mechanic name
- `buildCsv(filters)` — UTF‑8 BOM, semikolon-separator, danske decimalkomma
  (bekræftet efter Trin 5, linjer 184‑258 i `lib/data/reports.ts`)

`lib/data/dashboard.ts` — kun TV. Ikke relevant for admin.

### Eksisterende sider
- `app/(authenticated)/page.tsx` — kontrolpanel (metrics + env + sync-knapper)
- `app/(authenticated)/reports/page.tsx` — nuværende meget simple rapport-side: dato-fra/til, periode, summary/detailed toggle, mekaniker-dropdown, chips, tabel-preview, CSV-link.
  **Denne side skal udvides til det fulde admin-panel.**
- `app/dashboard/page.tsx` — TV, røres ikke.
- `app/api/reports/export/route.ts` — GET-endpoint der kalder `buildCsv`

### Auth/layout
`app/(authenticated)/layout.tsx` + `components/app-header.tsx` — admin-panelet bor i denne gruppe
og arver topbar + auth-guard gratis.

### Tid/format
`lib/time.ts` — `da-DK`-formattere, `getCopenhagenDateString`, `getWeekKey`, `getMonthKey`,
`formatHours`, `formatDecimal`, `formatPercent` osv. Skal bruges overalt.

---

## 1. Beslutning om route

Behold URL'en `/reports`. Den eksisterende side bliver selve admin-panelet — der er ingen
grund til at introducere en ny URL, og alle links (`app-header.tsx`, forsiden) peger allerede
derhen. Label i topbaren forbliver "Rapport".

Fil der skal omskrives:
`app/(authenticated)/reports/page.tsx`

Supporterende filer der oprettes i samme mappe (route-lokale komponenter):
```
app/(authenticated)/reports/
├── page.tsx                    # (omskrives)
├── filter-bar.tsx              # Client component — chips, search-input, status-filter
├── kpi-row.tsx                 # Server component — tager præberegnede tal
├── summary-table.tsx           # Server component med sort-links
├── detailed-table.tsx          # Server component med sort-links + paginering
└── detail-drawer.tsx           # Client component — åbnes via ?drawerMechanicId=...
```

Hold det fladt. Ingen `components/admin/*` under repo-roden; kun det der deles med andre sider
flyttes senere.

---

## 2. URL-state = filter-state (ingen client-state-bibliotek)

Alle filtre lever som search params på `/reports?...`. Det giver os gratis bogmærker, delbare
links, og full-reload-stabile filtre. Formen submittes med `method="GET"`, og chips/sort-headers
er `<Link>`-elementer.

Søgeparametre (alle valgfrie, defaults i parentes):
```
fromDate        ISO YYYY-MM-DD          (i dag)
toDate          ISO YYYY-MM-DD          (i dag)
periodMode      daily|weekly_avg|monthly_avg    (daily)
view            summary|detailed        (summary)
mechanicIds     komma-separeret uuid-liste      (tom = alle)
status          all|paid|open|anomaly   (all)
q               fritekst-søgning        (tom)
sort            felt-nøgle              (view-specifik default)
dir             asc|desc                (desc)
page            heltal ≥ 1              (1)
pageSize        25|50|100|200           (50)
drawerMechanicId uuid                   (tom)
```

Bemærk: vi erstatter det eksisterende enkelt-`mechanicId` med `mechanicIds` (multi-select).
`app/api/reports/export/route.ts` skal opdateres til at læse den nye parameter, men skal også
understøtte den gamle (bagudkompatibel) så eksterne bogmærker ikke brækker.

---

## 3. Filter-bar (sektion A)

Layout (top af siden, under `AppHeader`):

Linje 1 — chip-række (presets):
- I dag, I går, Denne uge, Sidste uge, Denne måned, Sidste måned, Sidste 30 dage

Linje 2 — inputs (CSS grid, wraps på smal skærm):
- Fra (date)
- Til (date)
- Periode (select: Dagligt / Ugentligt snit / Månedligt snit)
- Visning (select: Summeret / Detaljeret)
- Mekaniker (multi-select — se nedenfor)
- Status (select: Alle / Betalt og låst / Åben / Anomalier)
- Søgning (text — placeholder: "Søg mekaniker, ticket-ID eller varenummer")

Linje 3 — actions:
- Primær knap: "Opdater" (form submit)
- Sekundær: "Nulstil filtre" (Link til `/reports`)
- Eksportér CSV (Link til `/api/reports/export?...` med samme params)

### Multi-select-mekaniker uden bibliotek
Behold det simpelt: brug en native `<select multiple size="5">`. Det virker perfekt til 5‑20
mekanikere og kræver ingen klient-afhængigheder. Hvis det føles klodset, erstat senere med en
lille custom "chips + checkbox"-klient-komponent — men ikke i første iteration.

### Status-filter
- `all` — ingen filtrering
- `paid` — `source_payment_id IS NOT NULL`
- `open` — `source_payment_id IS NULL`
- `anomaly` — `anomaly_code IS NOT NULL`

Status gælder kun for detaljeret visning og for eksport af detaljeret CSV. I summary-modus skal
valget være synligt men disabled med tooltip-tekst "Status gælder kun detaljeret visning".

### Søgefelt
Anvendes som `ilike` over `mechanic_name`, `ticket_id::text`, `mechanic_item_no` i detaljeret
visning. I summary-visning filtrerer det kun på `mechanic_name`.

---

## 4. KPI-række (sektion B)

En horisontal række `panel`-kort (genbrug eksisterende `.panel-grid` og `.panel`-klasser fra
`app/globals.css`). 4‑6 kort, aldrig mere:

1. **Timer i perioden** — sum `daily_mechanic_totals.hours_total`
2. **Kvarterer** — sum `quarters_total`
3. **Mål i perioden** — sum `target_hours` for alle arbejdsdage × valgte mekanikere
4. **Opfyldelse** — `hours / target` som procent, fed hvis <80% eller >100%
5. **Snit pr. mekaniker** — `hours / antal_unikke_mekanikere` (hvis multi)
6. **Snit pr. dag** — `hours / antal_arbejdsdage_i_periode`

Valgfrit 7.: **Antal tickets** — `count(distinct ticket_id)` fra `daily_ticket_item_baselines`
i perioden (kun hvis det kan tilføjes uden ekstra roundtrip).

Design: samme `metric`-tal-stil som forsiden bruger i dag (`app/(authenticated)/page.tsx`
l. 62‑80). Ingen sparklines, ingen farvede badges.

KPI beregnes server-side i `page.tsx` ud fra en ny helper `getKpiSnapshot(filters)` i
`lib/data/reports.ts`. Den SKAL genbruge samme grundquery som `getSummaryRows` for at undgå
drift. Implementering: hent rådata én gang, beregn både summary-rows og KPI'er fra samme array.

---

## 5. Summary-tabel (sektion C, mode = summary)

Kilde: `daily_mechanic_totals` × `mechanic_item_mapping` (eksisterende join i `getSummaryRows`).

Gruppering: ALTID pr. mekaniker over den valgte periode (ikke pr. dag). Det er den mest nyttige
admin-visning. Brugeren vælger selv detaljeret hvis de vil se dag-for-dag.

Kolonner:
| # | Kolonne               | Felt / beregning                                          | Sort-nøgle |
|---|-----------------------|-----------------------------------------------------------|------------|
| 1 | Mekaniker             | `mechanic_name`                                           | `mechanic` |
| 2 | Kvarterer             | sum(`quarters_total`)                                     | `quarters` |
| 3 | Timer                 | sum(`hours_total`)                                        | `hours`    |
| 4 | Mål (t)               | sum(`target_hours`)                                       | `target`   |
| 5 | Difference (t)        | `hours − target`                                          | `variance` |
| 6 | Opfyldelse            | `hours / target`                                          | `pct`      |
| 7 | Arbejdsdage           | antal unikke `stat_date` i perioden for mekanikeren       | `days`     |
| 8 | Tickets               | `count(distinct ticket_id)` fra `daily_ticket_item_baselines` | `tickets`  |
| 9 | Snit pr. dag (t)      | `hours / days`                                            | `avgDay`   |
| 10| Snit pr. ticket (t)   | `hours / tickets` (0 hvis tickets = 0)                    | `avgTicket`|

Kolonne-overskrifter er `<Link>`-elementer der toggle'r `sort` og `dir` i URL.

Default-sort: `hours desc`.

Opfyldelse vises som `formatPercent(...)`, emphasised `font-weight: 700` hvis <80% eller >100%
(samme logik som den eksisterende side har nu).

Klik på en række → sæt `?drawerMechanicId=<id>` → åbn detail-drawer (sektion E).

### Backend-ændring
Tilføj i `lib/data/reports.ts`:
```ts
export type AdminSummaryRow = {
  mechanicId: string;
  mechanicName: string;
  quarters: number;
  hours: number;
  targetHours: number;
  varianceHours: number;
  fulfillmentPct: number;   // 0..n
  workdays: number;
  tickets: number;
  avgHoursPerDay: number;
  avgHoursPerTicket: number;
};

export async function getAdminSummary(filters: AdminFilters): Promise<AdminSummaryRow[]>;
```

Implementering:
1. Hent `daily_mechanic_totals` for perioden (genbrug query fra `getSummaryRows` linjer 65‑92).
2. Hent `daily_ticket_item_baselines` for perioden med kun `mechanic_id, ticket_id, stat_date`
   (lille payload). Byg map `mechanicId → Set<ticketId>` og `mechanicId → Set<statDate>`.
3. Aggregér pr. `mechanic_id`.
4. Sortér i JS baseret på `sort`/`dir` params.

Dette er hurtigt nok til forventet data-volumen (få mekanikere, <31 dage typisk). Ingen
materialized view nødvendig i Phase 2.

---

## 6. Detailed-tabel (sektion C, mode = detailed)

Kilde: `daily_ticket_item_baselines` (eksisterende `getDetailedRows`).

Kolonner:
| # | Kolonne           | Felt                                                      | Sort-nøgle |
|---|-------------------|-----------------------------------------------------------|------------|
| 1 | Dato              | `stat_date`                                               | `date`     |
| 2 | Mekaniker         | join `mechanic_name`                                      | `mechanic` |
| 3 | Ticket-ID         | `ticket_id`                                               | `ticket`   |
| 4 | Varenummer        | `mechanic_item_no`                                        | `item`     |
| 5 | Baseline (kv)     | `baseline_quantity`                                       | `baseline` |
| 6 | Aktuel (kv)       | `current_quantity`                                        | `current`  |
| 7 | Tilføjet (kv)     | `today_added_quantity`                                    | `added`    |
| 8 | Timer             | `today_added_hours`                                       | `hours`    |
| 9 | Låst              | pill "Betalt" hvis `source_payment_id IS NOT NULL` ellers "–" | `paid`     |
| 10| Opdateret         | `source_updated_at` via `formatCopenhagenTime`            | `updated`  |
| 11| Anomali           | `anomaly_code` eller "–"                                  | `anomaly`  |

Default-sort: `date desc, ticket asc`.

### Paginering
Server-side paginering via `page` + `pageSize`. Brug Supabase `.range(from, to)` og `count: 'exact'`
fra `getDetailedRows`'s query. UI: "Viser 1‑50 af 812 · [Forrige] [Næste]" nederst i tabellen.
Ingen virtualisering, ingen infinite scroll i Phase 2.

### Søgning
`q`-parameteren skal oversættes til:
```ts
query = query.or(
  `mechanic_item_no.ilike.%${q}%,ticket_id.eq.${parseIntOrNull(q)}`
);
```
Samt klient-side filter på `mechanic_name` efter fetch (fordi det er en join). Accepter at det
kører post-filter på page-resultatet — god nok i praksis. Hvis `q` matcher et heltal bruges
`ticket_id.eq`, ellers udelades det led.

### Status-filter
Sættes på query-niveau:
- `paid`: `.not("source_payment_id", "is", null)`
- `open`: `.is("source_payment_id", null)`
- `anomaly`: `.not("anomaly_code", "is", null)`

### Backend-ændring
Udvid `getDetailedRows` til at tage nye optionelle felter:
```ts
export type AdminDetailedFilters = ReportFilters & {
  mechanicIds?: string[];
  status?: "all" | "paid" | "open" | "anomaly";
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export async function getDetailedPage(
  filters: AdminDetailedFilters,
): Promise<{ rows: DetailedRow[]; total: number }>;
```

Behold den eksisterende `getDetailedRows(filters)` signatur (uden paginering) til CSV-eksport,
som skal dumpe HELE det filtrerede sæt — ikke kun aktuelle side. Intern implementering kan dele
en privat query-builder.

---

## 7. Sektion D — Eksport-actions

Eksport må ALTID respektere de aktuelle filtre, inklusive paginering → nej. Eksporten ignorerer
`page`/`pageSize` og dumper hele det filtrerede sæt.

Filer:
- `app/api/reports/export/route.ts` — opdateres til at læse `mechanicIds`, `status`, `q`, `view`
  (mappes til `exportMode`), og til at validere max-rækker (fx hard cap 100 000 for sikkerhed).
- `lib/data/reports.ts` — `buildCsv` udvides til at tage det samme udvidede filterobjekt og
  internt bruge `getAdminSummary` / `getDetailedRows(filtered, unpaginated)`.

Filnavn på download:
`b-bikes-{view}-{fromDate}_til_{toDate}.csv`

Eksempel UI under tabellen:
```
[Eksportér CSV]  [Eksportér kun låste lines]  [Eksportér anomalier]
```
De to sidste knapper er blot `<Link>`-shortcuts der overskriver `status` i query-stringen. Ingen
ekstra backend-arbejde.

---

## 8. Sektion E — Detail-drawer (klik på mekaniker-række)

Minimal implementering uden portal-bibliotek:
- En `<aside className="drawer">` der renderes betinget når `drawerMechanicId` er sat i URL.
- Positioneret `fixed right: 0; top: 0; height: 100vh; width: 480px;` i `globals.css`.
- "Luk"-link der peger tilbage på `/reports` med samme params men uden `drawerMechanicId`.
- Backdrop = semi-transparent div der også er en Link der lukker.

Indhold i drawer:
- Mekaniker-navn som h2
- Perioden (`formatShortCopenhagenDate(fromDate)` – `formatShortCopenhagenDate(toDate)`)
- Miniature-KPI: timer, mål, opfyldelse
- Tabel med dag-for-dag-opsummering (stat_date, quarters, hours, target, variance) — hentes
  via `getSummaryRows({ ...filters, periodMode: 'daily', mechanicId: drawerMechanicId })`
  (den eksisterende funktion dækker allerede dette)
- Link "Se alle ticketlinjer" → `/reports?view=detailed&mechanicIds=<id>&...`

Ingen animation, ingen JavaScript udover Next's server-rendering. Drawer fungerer med full reload
— det er fint for intern brug.

---

## 9. Indeks og performance

Eksisterende indeks fra `001_phase1_workshop_stats.sql` dækker de fleste queries:
- `daily_ticket_item_baselines_stat_date_idx`
- `daily_ticket_item_baselines_mechanic_date_idx`
- `daily_ticket_item_baselines_ticket_idx`
- `daily_mechanic_totals_stat_date_idx`

Ny migration `supabase/migrations/004_admin_indexes.sql` (003 er reserveret til RLS fra forrige plan):
```sql
-- Hurtig filtrering på låste/anomali-linjer
create index if not exists daily_ticket_item_baselines_payment_idx
  on public.daily_ticket_item_baselines (source_payment_id)
  where source_payment_id is not null;

create index if not exists daily_ticket_item_baselines_anomaly_idx
  on public.daily_ticket_item_baselines (anomaly_code)
  where anomaly_code is not null;

-- Understøtter søgning på varenummer i detaljeret visning
create index if not exists daily_ticket_item_baselines_item_no_trgm_idx
  on public.daily_ticket_item_baselines using gin (mechanic_item_no gin_trgm_ops);

-- Kræver extension
create extension if not exists pg_trgm;
```

Kun tilføj trigram-indekset hvis Codex bekræfter at `pg_trgm` er tilgængelig i Supabase-projektet
(det er den som standard). Ellers fald tilbage til simpel `btree(mechanic_item_no)`.

---

## 10. Implementeringsrækkefølge (konkret for Codex)

Rækkefølgen er valgt så hver commit er kørebar og testbar.

### Trin A — Data-lag
1. Redigér `lib/data/reports.ts`:
   - Tilføj `AdminFilters` og `AdminDetailedFilters`.
   - Udvid `getDetailedRows` internt; eksportér ny `getDetailedPage(filters)` der returnerer
     `{ rows, total }`.
   - Tilføj `getAdminSummary(filters)`.
   - Tilføj `getKpiSnapshot(filters)` der returnerer `{ totalHours, totalQuarters, totalTarget,
     fulfillmentPct, mechanicsCount, workdaysCount, ticketsCount, avgPerMechanic, avgPerDay }`.
   - Udvid `buildCsv` så den accepterer den nye filterform.
2. Tilføj enhedstests i `tests/reports.test.ts` (ny fil) med Vitest: sortering, status-filter,
   paginerings-offset. Mock Supabase-klienten.

### Trin B — API
1. Opdater `app/api/reports/export/route.ts` til at læse nye params, kalde `buildCsv` med udvidet
   filter, håndtere `mechanicIds` og `status`. Behold bagudkompatibilitet med `mechanicId`.
2. Lav `app/api/reports/status/route.ts` hvis detail-drawer får brug for en lille separat
   fetch — men kun hvis drawer renderes klient-side. Hvis drawer forbliver server-rendered, drop
   dette punkt.

### Trin C — UI
1. Omskriv `app/(authenticated)/reports/page.tsx`:
   - Parse alle nye search params i `getAdminFilters(searchParams)`.
   - Kald `Promise.all([getKpiSnapshot, getAdminSummary | getDetailedPage, getActiveMechanics])`.
   - Render `<FilterBar>`, `<KpiRow>`, `<SummaryTable>` ELLER `<DetailedTable>`, `<DetailDrawer>`.
2. `filter-bar.tsx` — client component kun hvis nødvendigt. Start som server-component med
   `<form method="GET">`; kun hvis multi-select bliver for klodset konverteres den til client.
3. `kpi-row.tsx` — server component, rent præsentation.
4. `summary-table.tsx` — server component; sort-headers som `<Link>` der swapper `dir`.
5. `detailed-table.tsx` — server component; paginerings-links som `<Link>`; søgning går igennem
   URL-formens `q`.
6. `detail-drawer.tsx` — server component; renderes kun hvis `drawerMechanicId` er sat.

### Trin D — Styling
1. Udvid `app/globals.css` med klasser:
   - `.admin-grid` (layout for filter/kpi/tabel)
   - `.admin-table` (stramt border-collapse, kompakt padding, hover)
   - `.sort-link` / `.sort-link.is-active` med lille pil (▲/▼ som textContent)
   - `.pill--paid`, `.pill--open`, `.pill--anomaly`
   - `.drawer`, `.drawer__backdrop`, `.drawer__body`
   - `.pagination` (forrige/næste + "Viser X–Y af Z")
2. Genbrug eksisterende `.panel`, `.metric`, `.chip`, `.button`, `.button--accent`,
   `.button--ghost` fra `app/globals.css`.

### Trin E — Migration og verifikation
1. `supabase/migrations/004_admin_indexes.sql` som beskrevet i afsnit 9.
2. Manuel verifikation af eksport mod dansk Excel (BOM + semikolon virker allerede).
3. Kør `npm run test` og `npm run lint`.

---

## 11. Hvad planen bevidst UDELADER

- Ingen klientside-state-library (Zustand, Redux, Jotai).
- Ingen data-grid-bibliotek (TanStack Table, AG Grid). Vanilla `<table>` + `<Link>`-sort.
- Ingen "gem filter-preset som favorit" — URL-bogmærker dækker behovet.
- Ingen drag-and-drop af kolonner. Ingen kolonne-vis/skjul.
- Ingen charts i admin-panel. Kun tal og tabeller.
- Ingen realtime-opdatering. Siden refreshes manuelt.
- Ingen materialized views. Direkte queries mod eksisterende indekserede tabeller.
- Ingen separate `/api/admin/*`-endpoints til tabel-data — Server Components henter direkte
  via `lib/data/reports.ts`.
- Ingen ændringer til TV-dashboardet (`app/dashboard/*`).

---

## 12. Acceptance-kriterier

Planen er gennemført korrekt når alle disse er grønne:

1. Åbn `/reports?fromDate=2026-03-01&toDate=2026-03-31` → KPI-række viser martsens totaler.
2. Klik "Denne uge" → URL opdateres, filter-bar reflekterer chip-state.
3. Vælg 2 mekanikere i multi-select → kun disse 2 vises i summary-tabel.
4. Skift til Detaljeret, sæt status=Betalt → kun rækker med `source_payment_id` vises.
5. Søg "MATHIAS15" → detaljeret tabel viser kun linjer med det varenummer.
6. Klik på "Timer"-kolonneoverskrift i summary → rækker sorterer på timer desc; klik igen → asc.
7. Tryk Eksportér CSV → fil indeholder PRÆCIS samme filter som tabellen + UTF-8 BOM + semikolon.
8. Klik en række i summary → drawer åbner med dag-for-dag-tabel for den mekaniker.
9. `npm run test` og `npm run lint` passerer.
10. TV-dashboard (`/dashboard`) er uændret.

---

## 13. Filer der SKAL ændres eller oprettes (fuld liste med absolutte stier)

Ændres:
- `lib/data/reports.ts`
- `app/(authenticated)/reports/page.tsx`
- `app/api/reports/export/route.ts`
- `app/globals.css`

Oprettes:
- `app/(authenticated)/reports/filter-bar.tsx`
- `app/(authenticated)/reports/kpi-row.tsx`
- `app/(authenticated)/reports/summary-table.tsx`
- `app/(authenticated)/reports/detailed-table.tsx`
- `app/(authenticated)/reports/detail-drawer.tsx`
- `tests/reports.test.ts`
- `supabase/migrations/004_admin_indexes.sql`

Røres IKKE:
- `app/dashboard/*`
- `components/dashboard-refresh.tsx`
- `lib/data/dashboard.ts`
- `app/(authenticated)/page.tsx` (kontrolpanel)
- `app/(authenticated)/layout.tsx`
- `components/app-header.tsx`

---

Slut. Planen er bevidst smal, konservativ og bygger 1:1 ovenpå det der allerede findes i repoet.
Ingen nye dependencies. Ingen ny auth-model. Ingen nye tabeller. Kun udvidelse af eksisterende
`reports`-route og `lib/data/reports.ts`.
