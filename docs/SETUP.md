# B-Bikes Mekaniker Dashboard — Opsætningsvejledning

## Hvad er nyt

Den nye version er bygget fra bunden med en fundamentalt anderledes og korrekt sync-arkitektur:

| Gammel app | Ny app |
|---|---|
| Baseline + delta-sync (kompleks) | Dagligt snapshot (simpelt og korrekt) |
| Dobbelttælling på samme dag | Ingen dobbelttælling — UPSERT overskriver |
| Manglende kvarterer ved sync | Alle kvarterer med — henter alle tickets opdateret i dag |
| Mange tabeller og kompleks logik | 3 tabeller: `mechanics`, `daily_totals`, `sync_log` |

---

## Trin 1: Kør database-migrationen i Supabase

1. Gå til [Supabase Dashboard](https://supabase.com) → dit projekt → **SQL Editor**
2. Åbn filen `supabase/migrations/20260426_new_schema.sql`
3. Kopier hele indholdet og kør det i SQL-editoren
4. Det opretter 3 tabeller og migrerer eksisterende mekanikere automatisk

**Tabeller der oprettes:**
- `mechanics` — mekanikere med navn, SKU og dagligt mål
- `daily_totals` — én række pr. mekaniker pr. dag med antal kvarterer
- `sync_log` — log over alle sync-kørsler

---

## Trin 2: Verificer mekanikere i indstillinger

1. Log ind på appen og gå til **Indstillinger**
2. Verificer at alle mekanikere er importeret korrekt med rigtige SKU'er:
   - Yasin: `2403B15`
   - Max: `3826B15`
   - Nick: `0064B15`
   - Frederik: `0113B15`
   - Mathias: `3485B15`
   - Tilbud: `BB15`
3. Sæt dagligt mål for hver mekaniker (standard: 30 kvarterer = 7,5 timer)
4. Klik **Gem**

---

## Trin 3: Kør en manuel sync

1. Gå til **Kontrolpanel**
2. Klik **Sync**
3. Vent på resultatet — du bør se antal opgaver hentet og kvarterer pr. mekaniker
4. Gå til **Rapporter** for at se tallene

---

## Trin 4: Opsæt automatisk daglig sync kl. 16:00

1. Gå til Supabase → **Database** → **Extensions**
2. Aktiver `pg_cron` og `pg_net` (hvis ikke allerede aktiveret)
3. Gå til **SQL Editor** og åbn `supabase/admin/setup_supabase_cron.sql.example`
4. Erstat `<DIN_APP_URL>` med din Vercel-URL (f.eks. `https://mekaniker-dashboard.vercel.app`)
5. Erstat `<DIN_CRON_SECRET>` med din `CRON_SECRET` fra Vercel Environment Variables
6. Kør SQL'en

---

## Daglig drift

| Hvornår | Hvad sker der |
|---|---|
| Kl. 16:00 | Automatisk sync — henter alle BikeDesk-tickets opdateret i dag og gemmer kvarterer |
| TV-dashboard | Roterer automatisk: I går → Aktuel uge → Aktuel måned (hvert 15. sekund) |
| Rapporter | Viser de 3 perioder med opfyldelsesprocent og fremgangsbjælker |

---

## Sådan fungerer sync-logikken

```
Kl. 16:00 →
  1. Hent alle tickets med updated_at >= i dag 00:00
  2. For hver ticket: hent alle materialer
  3. Filtrer materialer på mekaniker-SKU (client-side)
  4. Sum amount pr. mekaniker
  5. UPSERT i daily_totals (mechanic_id, work_date=i dag, quarters=sum)
```

**Hvorfor dette er korrekt:**
- `amount` på en material-linje er altid det faktiske antal kvarterer (ikke en ændring)
- UPSERT betyder at re-kørsel altid giver det rigtige resultat
- Kl. 16:00 er arbejdsdagen slut, så alle kvarterer for i dag er registreret

---

## Fejlfinding

**Sync returnerer 0 kvarterer:**
- Tjek at mekanikernes SKU'er er korrekte i Indstillinger
- Tjek at BikeDesk-tickets faktisk er opdateret i dag (mekanikerne skal have registreret tid i dag)

**TV-dashboard viser ingen data:**
- Kør en manuel sync fra Kontrolpanelet
- Husk at dashboardet viser "i går" som første periode — data for i dag vises først fra i morgen

**Cron-job kører ikke:**
- Tjek at `CRON_SECRET` er sat i Vercel og matcher det der er brugt i cron-SQL'en
- Tjek Supabase → Database → Cron Jobs for at se om jobbet er oprettet
- Se kørselslog: `select * from cron.job_run_details order by start_time desc limit 10;`
