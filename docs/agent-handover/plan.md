## Plan: Korrekt mekaniker-kvarter dashboard

Vi bygger en deterministisk daglig optaellingspipeline, hvor TicketMaterials for mapped mekaniker-SKU er eneste sandhedskilde for kvarterer. Dagens tal beregnes i Europe/Copenhagen, kun for materialer hvor materialets egen dato matcher dagen, og negative korrektioner samme dag tillades eksplicit. Vi bevarer eksisterende arkitektur hvor den hjaelper, men forenkler datamodellen omkring daglige deltas og traceability, saa hvert dashboard-tal kan foeres tilbage til konkrete raa records.

Statusnote: Punkter markeret med `[UDFOERT]` er implementeret eller verificeret i den aktuelle worktree.

**Steps**
1. Phase 1: Fastlaas domaeneregler og datakontrakt som kode-naere acceptance-kriterier.
2. [UDFOERT] Definer en entydig daglig optaellingsregel: medregn kun TicketMaterial rows hvor mapped produktnummer matcher mekaniker, og materialets egen dato er samme Copenhagen-kalenderdag som stat_date.
3. [UDFOERT] Definer korrektionregel: day_delta maa vaere negativ ved senere samme-dag aendringer; ingen clamp til 0.
4. [UDFOERT] Definer deduplikeringsregel: unikhed per stat_date + ticket_material_id, med idempotent upsert og reproducerbar re-koersel uden dobbeltoptaelling.
5. Phase 2: Refaktorer sync-flow til tydelig separering af discovery, normalisering, daglig attribuering og aggregation. Depends on 1-4.
6. [UDFOERT] Flyt/isoler daglig attribueringslogik i dedikerede funktioner i sync-modulet, saa forretningsregler kan testes uden netvaerkskald.
7. [UDFOERT] Revider discovery-vindue til at hente aendringer via updated_after, men filtrere haardt paa materialets egen dato ved daglig bogfoering. Depends on 2.
8. [UDFOERT] Bevar eksisterende lock/cursor-overlap, men goer mismatch-sager (opdateret i dag, materialedato i gaar) til audit events uden daglig medregning. Depends on 7.
9. Phase 3: Datamodel og sporbarhed.
10. [UDFOERT] Udbyg baseline-fakttabellen med eksplicitte felter til source-trace (raa dato, raw updated_at, sync_event_id, beslutningsaarsag) hvor noedvendigt, i stedet for at introducere parallelle sandhedstabeller. Depends on 5-8.
11. [UDFOERT] Sikr at daglige aggregationer i total-tabellen altid kan genberegnes fuldt fra baseline-fakttabellen for en given dato.
12. [UDFOERT] Tilfoej/juster anomaly-kategorier for: negativ korrektion samme dag, opdaget-men-ikke-medregnet pga dato, manglende mapping, og missing/recovered livscyklus.
13. Phase 4: Dashboard/query-lag.
14. [UDFOERT] Juster dataudtraek til dashboardet, saa visningen viser dagens kvarterer/timer direkte fra de nye deterministiske daglige totals uden skjulte efterkorrektioner i UI-laget. Depends on 11.
15. [UDFOERT] Bevar eksisterende board-rotation og konfiguration, men verifiser at mechanic_focus og hovedboards laeser samme daglige sandhedstal.
16. Phase 5: Test og validering.
17. Udvid unit-tests for daglig attribuering: voksende maengde, negativ korrektion, multi-sync samme dag, tvaers-over-midnat, og materialer med dato uden for dag.
18. Udvid integrations/tests for sync-ruter med idempotens-check: to identiske sync-koersler giver samme output og ingen ekstra rows.
19. [UDFOERT] Tilfoej regressions-tests for reports/dashboard, saa 8 kvarter altid vises som 2 timer og summer stemmer per mekaniker per dag.
20. Tilfoej audit-verifikationstest: tilfaeldige dashboard-tal kan spores tilbage til konkrete ticket_material_id og raa sourcefelter.
21. Phase 6: Migration og driftsklar rollout.
22. [UDFOERT] Lav migration(er) for noedvendige nye kolonner/indexer/constraints med rollback-script.
23. Koer kontrolleret backfill/recalc for et afgraenset datointerval og sammenlign foer/efter med afstemningsrapport.
24. Aktiver i produktion med observability: sync_event_log metrics og anomaly-rater monitoreres pr. koersel foerste uge.

**Relevant files**
- [lib/sync/run-phase-one-sync.ts](lib/sync/run-phase-one-sync.ts) - hovedrefaktor for daglig attribuering, idempotent upsert, anomaly-flow og aggregation trigger.
- [lib/c1st/client.ts](lib/c1st/client.ts) - sikre korrekt endpoint- og parameterbrug for incremental discovery og pagination.
- [lib/data/dashboard.ts](lib/data/dashboard.ts) - ensretning af dashboard-queries mod deterministiske daglige totals.
- [app/api/cron/sync/route.ts](app/api/cron/sync/route.ts) - bevare sekvens/locking, men sikre korrekt haandtering af nye audit-resultater.
- [app/api/sync/manual/route.ts](app/api/sync/manual/route.ts) - samme adfaerd som cron for manuel koersel.
- [supabase/migrations/001_phase1_workshop_stats.sql](supabase/migrations/001_phase1_workshop_stats.sql) - reference for eksisterende constraints og noeglemoenstre, justeres via ny migration.
- [supabase/migrations/012_add_sync_anomaly_log.sql](supabase/migrations/012_add_sync_anomaly_log.sql) - reference for anomaly-log udvidelser.
- [tests/sync.test.ts](tests/sync.test.ts) - udvides med idempotens og datoafgraensning.
- [tests/time-and-reporting.test.ts](tests/time-and-reporting.test.ts) - udvides med daggraense og kvarter->timer konsistens.
- [tests/dashboard-status.test.ts](tests/dashboard-status.test.ts) - regressionssikring af dashboard-tal efter refaktor.
- [tests/reports.test.ts](tests/reports.test.ts) - rapportafstemning mod daglige mekanikertal.

**Verification**
1. [UDFOERT] Koer eksisterende test-suite og nye tests for sync, reporting og dashboard.
2. [UDFOERT] Koer maalrettet scenarie-test med syntetiske cases: 8->10, 10->8 samme dag, og opdatering i dag med materialedato i gaar.
3. [UDFOERT] Verificer idempotens: koer samme sync-vindue to gange og sammenlign row counts/checksums i baseline- og total-tabeller.
4. Verificer sporbarhed: vaelg 3 dashboard-tal og foelg dem tilbage til ticket_material_id samt sourcefelter i databasen.
5. Verificer tidszone: tests omkring midnat Europe/Copenhagen inkl. weekend/helligdage paavirker ikke dagens materialefiltrering forkert.
6. Verificer drift: ingen samtidige cron-koersler overlapper, og anomaly-rate er inden for forventet niveau efter rollout.

**Decisions**
- Daggraense: Europe/Copenhagen 00:00-23:59.
- Korrektioner: negative korrektioner samme dag tillades i hovedtallet.
- Dagsattribuering: kun materialer hvis materialets egen dato matcher dagen medregnes.
- Sandhedskilde: TicketMaterials amount paa mapped mekaniker-SKU.
- Scope inkluderet: sync-logik, datamodel-justeringer, dashboard/reports-queries, testudvidelser, migration/backfill.
- Scope ekskluderet: aendringer i ekstern BikeDesk-datakilde, nye forretnings-KPI'er uden for mekaniker-kvarter/timer.

**Further Considerations**
1. Backfill-vindue anbefales foerst 30-90 dage for hurtig validering, derefter fuld historik hvis checksums holder.
2. Hvis performance bliver en flaskehals ved stor historik, tilfoejes materialiseret daglig aggregation som read-model, men ikke som primaer sandhedskilde.
3. Hvis revision kraever staerkere revisionsspor, kan sync_event_id knyttes konsekvent til alle opdaterede fact rows i samme koersel.
