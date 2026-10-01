# Premium Product Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformarea aplicației într-un produs pentru laboratoare dentare, configurabil și susținut operațional, vandabil la un abonament standard fără personalizări nelimitate.

**Architecture:** Un cod comun și release-uri versionate; configurație și identitate pe laborator. Inițial proiect Supabase separat și credentiale de automatizare separate pentru fiecare client; infrastructura fizică poate fi comună. Refactorizare incrementală, fără rescriere de framework.

**Tech Stack:** JavaScript/HTML/CSS, PostgreSQL/Supabase, Edge Functions, n8n, Google Workspace/Drive, Caddy/Coolify, teste Node/Python/PGlite.

**Spec:** [Inventar, constatări și criterii de produs](../specs/2026-09-27-premium-product-readiness.md).

## Global Constraints

- Plan propus pe baza codului local la `f585a6d`, nu certificare a configurației din producție. Nu autorizează deploy sau schimbări live.
- Păstrăm diagrama dentară, istoricul financiar, modurile de facturare și verificările AI existente.
- Notificarea vizează statusul general al lucrării; recuperarea programată rămâne o dată pe oră.
- Nu cerem backup al bazei n8n: păstrăm workflow-urile în Git și documentăm reconectarea credentialelor.
- Niciun secret sau payload de pacient în repo, telemetrie ori fixture-uri.
- Fiecare livrabil are migrare, verificare și procedură de revenire; migrațiile de date nu se anulează prin simplul rollback al frontendului.
- Estimările sunt zile de inginerie, nu promisiuni calendaristice; accesul la conturi și validarea utilizatorilor sunt dependențe externe.

## Review Focus

- Doi medici/tehnicieni cu același nume: accesul și atribuirea se decid prin ID, testate în T2.
- Două actualizări simultane: utilizatorul vede conflictul, fără suprascriere silențioasă, testat în T6.
- Backup întrerupt sau Drive plin: copia precedentă utilizabilă rămâne disponibilă, testat în T3.
- Providerul acceptă emailul, dar răspunsul se pierde: nu retrimitem automat fără limită, testat în T4.
- Upload întrerupt ori fișier diferit de metadate: nu afișăm un atașament utilizabil înainte de verificare, testat în T5.

## Ordine, resurse și praguri de lansare

| Pachet | Sarcini | Efort estimat | Condiție de ieșire |
|---|---|---:|---|
| Bază reproductibilă și sigură | T1–T5 | 16–23 zile | Instalare repetabilă, acces verificat, restaurare demonstrată, alerte și fișiere verificate |
| Experiență premium și configurare | T6–T9 | 14–20 zile | Fluxuri mobile/desktop, fără conflicte ascunse, onboarding și performanță măsurate |
| Costuri, AI și pilot comercial | T10–T12 | 8–12 zile + observație | Cost per client măsurat, limite clare, două laboratoare validate |

Total: **38–55 zile de inginerie**, cu rezervă de 25% **48–69 zile**, aproximativ **10–14 săptămâni** pentru un inginer dedicat. Pilotul durează minimum 30 de zile de observație și poate suprapune lucrări necritice. Funcțiile opționale din final nu sunt incluse. Reestimăm după T1–T3; nu pornim contracte cu garanții de disponibilitate înainte de dovezi.

Dezvoltatorul deține implementarea și verificările; administratorul infrastructurii furnizează staging, secrete și acces; utilizatorul desemnează cele două laboratoare pilot și validează procesele. Specialistul juridic și furnizorii confirmă contractele/licențele, separat de evaluarea tehnică.

## T1 — Build, teste și release reproductibil

**Prioritate/efort:** P0, 3–4 zile. **Dependențe:** niciuna.

**Fișiere:** creare `package.json`, `package-lock.json`, `.github/workflows/verify.yml`, `tools/normalize-workflow-export.py`, `docs/releases.md`; modificare `tests/sql/`, `tests/workflows/google-drive-backup.test.mjs`, `workflows/`, `README.md`, `db/README.md`, `deploy/README.md`, `docs/client-readiness-deployment.md`.

**Contract:** `npm run verify` rulează verificările locale fără dependențe în `/tmp`; exporturile distribuibile sunt inactive, fără credentiale/pinned data și cu retenție explicită. Normalizarea nu schimbă logica nodurilor.

- [ ] Adaugă teste ale normalizatorului pentru exporturile reale, păstrând numele/conexiunile și eliminând doar configurația de instanță.
- [ ] Configurează Node/Python și PGlite cu versiuni fixate; fixează versiunea Supabase JS folosită în browser după verificarea compatibilității.
- [ ] Normalizează backup-ul și AI-ul; regenerarea notificărilor trebuie să producă același export logic ca generatorul existent.
- [ ] Rulează `npm ci`, `npm run verify` într-un checkout curat și în CI. Baseline-ul actual: 185/187 teste JS și 42 teste Python trecute; elimină cele două eșecuri reale, nu testele.
- [ ] Documentează matricea release frontend/SQL/Edge/n8n, mediu staging separat, verificări înainte de deploy și rollback pentru fiecare componentă. Corectează afirmațiile depășite din documentație.
- [ ] Commit separat după verificare. Acceptare: alt dezvoltator poate reproduce verificarea și instalarea de test numai din repo și configurația documentată.

## T2 — Identitate pe laborator și permisiuni prin ID

**Prioritate/efort:** P0, 4–6 zile. **Dependențe:** T1.

**Fișiere:** modificare `db/schema/20_functions/get_flowrise_lab_id.sql`, `get_app_identity.sql`, `doctor_matches_partner.sql`, funcțiile AI care apelează identitatea fixă, `db/schema/30_policies/`, `db/edge-functions/`; creare `db/migrations/20260928_lab_identity.sql`, `tests/sql/tenant_identity.test.mjs`, `docs/permissions-matrix.md`. Numele/datele migrațiilor se ajustează la data implementării, fără rescrierea celor aplicate.

**Contract:** organizația autorizată derivă din utilizatorul autentificat/membership verificat; numele afișate nu sunt identificatori de autorizare. Configurația clientului nu poate extinde accesul.

- [ ] Creează matricea rol × citire/scriere/fișiere/financiar/AI și testele negative înainte de schimbări.
- [ ] Adaugă raport de reconciliere pentru relațiile bazate pe nume; blochează migrarea relațiilor ambigue până la mapare explicită, fără alegerea primului rezultat.
- [ ] Migrează legăturile către ID-uri stabile și elimină dependența funcțională de slug-ul Flowrise, păstrând adaptoare temporare doar pentru compatibilitate.
- [ ] Testează doi clienți, omonime, cont dezactivat, schimbare de rol, UUID ghicit și acces direct RPC/Storage/AI; niciun rezultat neautorizat.
- [ ] Verifică loginul direct și prin Edge, limitele la încercări paralele și efectul bucketului comun de rate limit. Documentează sursa IP de încredere înainte de folosirea headerelor proxy.
- [ ] Rulează `npm run verify`; commit după verificare pe staging. Acceptare: instalarea clientului B nu cere modificarea funcțiilor SQL pentru numele lui.

## T3 — Recuperare demonstrată, nu doar fișiere de backup

**Prioritate/efort:** P0, 4–6 zile. **Dependențe:** T1; schema de identitate T2 pentru verificarea restaurării finale.

**Fișiere:** modificare `workflows/Flowrise Dental - Supabase Backup to Google Drive.json`, `tools/backup-supabase-db.sh`, `docs/backup-restore.md`, `tests/workflows/google-drive-backup.test.mjs`; creare `tools/verify-backup-manifest.py`, `docs/restore-drill.md`.

**Contract:** manifest versionat cu schema/release, obiecte, dimensiuni și checksum; backup incomplet nu devine complet. RPO propus ≤24h și RTO ≤4h, acceptate numai după măsurare.

- [ ] Testează Drive plin, transfer întrerupt, fișier lipsă, checksum greșit și o nouă încercare; păstrează ultima copie restaurabilă în toate cazurile.
- [ ] Stabilește consistența exportului: același snapshot pentru tabelele relaționale, cu inventar și verificare ulterioară a obiectelor Storage; dacă workflow-ul actual nu poate garanta asta, folosim job-ul de dump existent ori backup gestionat pentru DB și n8n pentru Storage/orchestrare.
- [ ] Implementează manifestul și validarea lui înainte de marcarea completă. Retenție țintă 7 copii zilnice + 4 săptămânale, numai după calculul spațiului; 10GB nu reprezintă o capacitate garantată suficientă.
- [ ] Restaurează într-un proiect gol: schema, date, relații, fișiere, acces pe roluri și pașii Auth. Documentează explicit că exportul actual Auth nu păstrează parole/sesiuni și definește recuperarea/resetarea lor.
- [ ] Măsoară durata, numără rânduri/obiecte și verifică checksum-uri; atașează raport fără date personale. Testează reconectarea credentialelor n8n din procedură, fără backup DB n8n.
- [ ] Rulează `npm run verify`; commit cu procedura și raportul. Acceptare: restaurare executată, nu doar descrisă, și alertă pentru backup absent/incomplet.

## T4 — Observabilitate și notificări operabile

**Prioritate/efort:** P0, 3–4 zile. **Dependențe:** T1.

**Fișiere:** modificare `deploy/docker-compose.yml`, `deploy/Caddyfile`, `db/schema/70_email_notifications.sql`, `tools/build-email-notification-workflow.py`, `workflows/code/notification-delivery-result.js`, `docs/email-notifications.md`; creare `docs/operations-runbook.md`, `tests/notifications/recovery.test.mjs`.

**Contract:** telemetrie cu ID de corelare, tip operație și durată, fără payload de pacient; stare de email distinctă între acceptat de provider și livrat. Webhook prin ruta publică documentată, fallback orar.

- [ ] Testează webhook duplicat, worker oprit, lease expirat, acceptare Gmail cu răspuns pierdut și coadă peste limita unui batch.
- [ ] Adaugă healthchecks și monitor extern independent pentru aplicație și execuțiile așteptate; alertarea nu depinde exclusiv de workflow-ul monitorizat.
- [ ] Definește alerte: lipsă backup reușit >26h, email pending >10min în regim normal, failed/uncertain și serviciu indisponibil; agregă alertele pentru a evita spamul.
- [ ] Configurează retenție explicită minimă în AI/backup și secrete în credentiale; păstrează diagnostic fără corpul emailului sau dump-ul bazei.
- [ ] Simulează incidentele pe staging și măsoară p95 notificare <2min când providerul funcționează. Verifică recuperarea orară și instrucțiunile pentru cazurile uncertain.
- [ ] Rulează `npm run verify`, regenerează JSON-ul notificărilor, verifică diff-ul și commit.

## T5 — Atașamente cu ciclu de viață verificat

**Prioritate/efort:** P0, 2–3 zile. **Dependențe:** T2.

**Fișiere:** modificare `db/edge-functions/authorize-work-order-file/index.ts`, `db/schema/10_tables/23_work_order_files.sql`, `db/schema/30_policies/23_work_order_files.sql`, `website/app/app.js`; creare `db/migrations/20260928_file_upload_lifecycle.sql`, `tests/files/upload-lifecycle.test.mjs`.

**Contract:** `pending → ready/failed`, cu finalizare autorizată ce verifică existența și dimensiunea obiectului; doar `ready` este descărcabil în UI.

- [ ] Testează upload întrerupt, finalizare repetată, dimensiune peste limită, extensie/conținut neconcordant și acces după retragerea rolului.
- [ ] Implementează finalizarea server-side, validări și mesaje de retry; păstrează compatibilitatea cu atașamentele existente verificate.
- [ ] Adaugă reconciliere raportată pentru obiecte/metadate orfane; ștergerea automată are perioadă de grație și nu atinge obiectele restaurate recent.
- [ ] Rulează testele și o încărcare/descărcare reală pe staging; commit. Acceptare: un upload eșuat nu apare ca fișier disponibil.

## T6 — Actualizări fără pierderi și istoric operațional

**Prioritate/efort:** P1, 3–4 zile. **Dependențe:** T2.

**Fișiere:** modificare `db/schema/20_functions/update_management_work_order_v188.sql`, `set_work_order_status.sql`, `website/app/app.js`; creare migrare pentru versiune/istoric și `tests/sql/work-order-conflicts.test.mjs`.

**Contract:** mutațiile UI primesc versiunea citită; versiunea veche produce conflict explicit. Istoricul operațional păstrează actor/timp/schimbare, fără a înlocui istoricul financiar existent.

- [ ] Testează două editări simultane și retry după timeout; modificarea mai nouă nu se pierde și notificarea nu se dublează.
- [ ] Implementează versionarea tranzacțională pentru toate rutele de scriere relevante, inclusiv AI și schimbarea statusului.
- [ ] Adaugă UI de conflict cu reîncărcare/comparare și timeline lizibil; corectarea unei greșeli produce un eveniment nou, nu șterge auditul.
- [ ] Rulează testele financiare, de notificări și conflict; commit. Acceptare: scenariul cu doi operatori este demonstrat în browser.

## T7 — Experiență premium în fluxurile zilnice

**Prioritate/efort:** P1, 5–7 zile. **Dependențe:** T5–T6.

**Fișiere:** modificare `website/app/app.js`, `styles.css`, `index.html`, `dashboard-ui.js`; creare `website/app/ui-tokens.css`, module dedicate formularelor atinse și `tests/e2e/daily-workflows.spec.js`.

**Contract:** aceleași acțiuni pe desktop/mobil, status general distinct de etape; design compact și feedback imediat pentru salvare/eroare.

- [ ] Documentează cinci scenarii: creare lucrare, asignare, schimbare status, încărcare fișier, găsire istoric; măsoară timpul inițial cu utilizatori reali.
- [ ] Definește token-uri de spațiere/culori/font/focus și aplică-le componentelor acestor fluxuri; elimină suprascrierile CSS doar în zonele atinse.
- [ ] Simplifică formularele cu valori implicite, validări lângă câmp, șabloane și rezumat înaintea operațiilor în masă; nu ascunde detaliile financiare esențiale.
- [ ] Adaugă filtre salvate și stări loading/empty/error coerente. Păstrează agregatele numai în taburile stabilite, inclusiv Parteneri și salarii, fără reintroducere în Producție.
- [ ] Rulează E2E la 360px/390px și desktop, tastatură/focus și print. Ținte: prima lucrare <3min după instruire, una uzuală <60sec fără upload mare, fără overflow de pagină.
- [ ] Rulează `npm run verify` și `npx playwright test tests/e2e/daily-workflows.spec.js`; commit după validarea scenariilor, nu doar a capturilor de ecran.

## T8 — Configurare și onboarding fără fork per client

**Prioritate/efort:** P1, 3–5 zile. **Dependențe:** T1–T2; integrare vizuală T7.

**Fișiere:** creare `deploy/client-config.example.json`, `tools/validate-client-config.mjs`, `docs/client-onboarding.md`, `tests/onboarding/config-import.test.mjs`; modificare `website/app/`, `deploy/README.md` și RPC-urile de import administrativ existente.

**Contract:** configurație validată pentru nume/logo/culori, domeniu, fus orar, sender și referințe de servicii; secretele sunt separate. Import cu dry-run, mapare explicită și idempotency.

- [ ] Testează două configurații distincte pe același release; lipsa unei valori obligatorii produce eroare clară înainte de deploy.
- [ ] Scoate brandingul clientului din logica de business; păstrează numele produsului separat de identitatea laboratorului.
- [ ] Adaugă import CSV cu preview pentru parteneri, utilizatori și catalog/prețuri; raportează duplicate, diacritice, zecimale, ID-uri ambigue și rânduri respinse.
- [ ] Documentează instalarea, contul inițial, credentialele, configurarea notificărilor și exportul de ieșire cu relații/fișiere utilizabile.
- [ ] Execută instalarea clientului pilot B din zero: țintă tehnică ≤2h după furnizarea acceselor și onboarding ≤1 zi, fără curățarea datelor sursă. Commit după raportul de probă.

## T9 — Performanță măsurată și export predictibil

**Prioritate/efort:** P1, 3–4 zile. **Dependențe:** T1–T2.

**Fișiere:** modificare `website/app/dashboard-data.js`, `dashboard-ui.js` și funcțiile RPC din `db/migrations/20260927_dashboard_pagination.sql` prin migrare nouă; creare `tests/performance/dashboard.mjs`, fixture-uri sintetice și `docs/performance-baseline.md`.

**Contract:** paginație rămâne pe server; implicit ultimele 90 zile, intervale independente recepție/livrare și istoric accesibil. Nicio optimizare nu schimbă drepturile sau sensul agregatelor.

- [ ] Generează 50.000 lucrări sintetice/laborator și benchmark cu 10 utilizatori concurenți; documentează hardware, plan Supabase și rețea.
- [ ] Măsoară p95 pentru paginare, filtrare, agregate și browser; ținte propuse API <1s și răspuns vizibil <2s în condițiile declarate.
- [ ] Inspectează planurile SQL; adaugă indecși/cache/keyset numai unde măsurarea arată beneficiu. Izolează cache-ul după identitate, rol și filtre.
- [ ] Verifică exportul la modificări concurente; livrează snapshot coerent ori avertizare și reluare explicită, nu fișier prezentat fals ca snapshot.
- [ ] Repetă benchmark-ul și testele de date/date-limită, inclusiv schimbarea orei Europe/Bucharest; commit cu rezultate înainte/după.

## T10 — AI util, controlat și cu buget

**Prioritate/efort:** P1, 3–4 zile. **Dependențe:** T2, T4, T6.

**Fișiere:** modificare `workflows/Flowrise Dental - AI Client V17.4.json`, funcțiile `ai_preview_operation`, `ai_execute_operation`, `ai_read_dataset`; creare `tests/ai/evaluation-cases.json`, `tools/run-ai-evaluations.mjs`, `docs/ai-budget.md`.

**Contract:** păstrăm preview, expirare, checksum, autorizare și idempotency. Operațiile sensibile cer confirmare; bugetul este pe client, nu promisiune de AI nelimitat.

- [ ] Definește minimum 30 cazuri cu rezultat verificabil: citire, modificare permisă, refuz, text malițios în date, rol schimbat, preview expirat, dublă executare și cerere ambiguă.
- [ ] Rulează evaluarea inițială; corectează numai eșecurile demonstrate. Cazurile de acces neautorizat și execuție neconfirmată trebuie toate refuzate.
- [ ] Adaugă măsurarea utilizării/costului fără prompturi cu date personale, plafon lunar și mesaj clar când limita este atinsă.
- [ ] Rulează regresiile după schimbarea modelului/promptului și documentează costul unui set reprezentativ; commit.

## T11 — Pachet standard, operare și economie per client

**Prioritate/efort:** P1, 3–5 zile. **Dependențe:** T3–T4, T8, T10.

**Fișiere:** creare `docs/product/package-and-limits.md`, `docs/product/unit-economics.csv`, `docs/product/service-policy.md`; actualizare onboarding și runbook.

**Contract:** ofertă cu limite măsurabile și responsabilități explicite; estimarea 4.800–6.000 lei/an plus setup este ipoteză comercială, nu preț validat de piață.

- [ ] Definește nucleul: lucrări/producție, acces roluri, diagramă/print, atașamente, financiar operațional, notificări, backup și suport. Separă migrările dificile și integrările personalizate.
- [ ] Calculează la 1/5/20 clienți costurile reale pentru DB/hosting/backup/email/AI/licențe și suport. La 500 lei/lună, prag de lucru: cost direct ≤175 lei/client/lună; include costul orelor de suport, nu doar serverul.
- [ ] Dimensionează limitele de stocare, AI și suport din rezultate; nu amortiza investiția pe clienți inexistenți și nu promite nelimitat.
- [ ] Obține confirmarea condițiilor n8n pentru modelul ales și verificarea contractuală a datelor, subcontractorilor, retenției, exportului și incidentelor. Nu publica afirmații de conformitate din simpla existență a RLS.
- [ ] Separă prezentarea produsului de site-ul laboratorului; pregătește demo cu date sintetice, preț transparent și limitele reale. Commit al documentelor fără date contractuale confidențiale.

## T12 — Două laboratoare pilot și decizie de lansare

**Prioritate/efort:** P1, 2–3 zile inginerie plus minimum 30 zile observație. **Dependențe:** T1–T9; T10 necesar dacă AI intră în pachet, T11 înainte de ofertă.

**Fișiere:** creare `docs/product/pilot-scorecard.md`, `docs/product/release-readiness.md`.

- [ ] Alege un laborator apropiat de Flowrise și unul cu organizare diferită; folosește același release și configurații separate.
- [ ] Înregistrează săptămânal: lucrări reale introduse, succesul celor cinci fluxuri, timpul de onboarding, incidente, notificări, backup, cost și minute de suport.
- [ ] Execută un exercițiu de recuperare și unul de rollback înainte de acceptarea finală; confirmă că operatorul poate urma runbook-ul.
- [ ] Gate comercial: zero defecte critice de acces/pierdere de date deschise; țintele tehnice demonstrate; ambii clienți finalizează fluxurile fără intervenția dezvoltatorului; țintă suport stabil ≤1h/client/lună după onboarding, cost încadrat în T11.
- [ ] Clasifică cererile în configurație, îmbunătățire comună sau dezvoltare separată. Orice funcție nouă obligatorie reestimează planul, nu se ascunde în mentenanță.
- [ ] Publică raportul de go/no-go cu dovezi și abateri acceptate explicit; commit. Vânzarea generală începe după acest prag, nu după simplul deploy.

## Extensii după primul release premium

Nu sunt condiții pentru T12 și nu sunt incluse în estimare. Fiecare primește un plan separat, după observarea utilizării și acceptarea costului:

1. QR pentru identificare rapidă: prioritar dacă reduce timpul tehnicienilor, cu test în atelier.
2. Șabloane suplimentare de etape/termene: configurație validată înaintea unui editor de workflow generic.
3. Viewer STL și prezentare pentru medic: numai cu cerere reală, limite fișiere și performanță demonstrate.
4. Un conector fiscal/contabil ales de clienții pilot; nu construim ERP fiscal propriu.
5. Infrastructură comună cu multi-tenancy în aceeași bază doar după demonstrarea izolării și avantajului economic.

## Verificarea acestui plan

Inventarul din spec este acoperit de T1–T12; cele cinci situații din Review Focus au verificări dedicate. Estimările însumează 38–55 zile înainte de rezervă. Evaluarea live de securitate, confirmările juridice/licențiere și disponibilitatea furnizorilor sunt dependențe externe, nu rezultate declarate ca obținute. Planul se execută pe pachete, fiecare livrabil fiind revizuibil și testabil separat.
