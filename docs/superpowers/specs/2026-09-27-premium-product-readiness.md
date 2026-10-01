# Flowrise — audit de produs și direcție premium

Data: 27 septembrie 2026. Referință de cod: `f585a6d`.
Status: propunere pentru revizuire; nu certificare și nu autorizare de modificări în producție.

## Obiectiv și poziționare

Software nou pentru laboratoare dentare, versatil și cu experiență premium la preț standard. Premium trebuie demonstrat prin predictibilitate, rapiditate, date corecte, colaborare și suport. Configurarea adaptabilă trebuie să folosească același produs, fără ramuri permanente cu funcționalități divergente pentru fiecare client.

Client de referință propus: laborator cu 3–10 tehnicieni, un administrator și medici colaboratori. Primul pilot extern: un laborator apropiat ca flux de Flowrise; al doilea trebuie să aibă diferențe reale de organizare, pentru validarea versatilității.

Ipoteză comercială de lucru: 4.800–6.000 lei/an fără TVA pentru pachetul standard, implementare inițială separată. Nu este o ofertă nouă și nici o validare a disponibilității clienților de a plăti. Condițiile și limitele se validează în pilot.

## Ce s-a verificat și ce nu

Inventar transversal al frontendului, schemei, funcțiilor SQL, politicilor, Edge Functions, celor trei workflow-uri n8n, deploy-ului, uneltelor, testelor și documentației. Inventarul include 32 fișiere de tabele și 113 fișiere de funcții, fără a echivala un fișier cu un singur obiect SQL. Citirea în profunzime a urmărit traseele de identitate, acces, producție, date financiare, fișiere, backup, AI și notificări. Nu s-a efectuat un audit manual linie cu linie al tuturor surselor sau un pentest.

Nu s-au accesat configurațiile live Coolify/Supabase/Google/n8n, nu s-au trimis mesaje și nu s-au făcut operații destructive. Confirmările de funcționare live sunt cele furnizate de utilizator în conversație. Documentele vechi care spun că Turnstile nu există nu sunt folosite ca dovadă despre starea live actuală.

Baseline local executat:
- Node: 187 teste, 185 trecute, 2 eșuate, incluzând testul local neversionat pentru backup.
- Python: 42 teste trecute; verificarea JSC apelată de suită: 26/26.
- Cele 154 teste pentru aplicație, auth și notificări sunt incluse în suita extinsă, nu se adună separat.
- Cele două eșecuri sunt `workflow is inactive, scheduled in Bucharest and does not retain successful backup payloads` și `workflow is n8n-only and contains no server runner or embedded secret`. Primul se oprește la `active=true`; al doilea la existența câmpurilor `credentials`. Referințele la credentiale nu sunt dovadă de secrete expuse.

## Inventar și constatări

| Zonă | Ce avem | Limită verificată / ce rămâne de demonstrat | Prioritate |
|---|---|---|---|
| Lucrări și producție | Kanban, etape, roluri, termene, prescripție pe dinți, solidarizări, print | Etape fixate în câmpurile model/modelare/cer_fin; UX trebuie validat cu utilizatori noi | P1 |
| Financiar | Prețuri înghețate, linii per dinte/arcadă/bucată, asignări și plăți, audit financiar | Nu am identificat integrare fiscală; auditul financiar nu reprezintă întreg istoricul operațional | P1/P2 |
| Identitate și client nou | Organizații, memberships, RLS, permisiuni pe rol | `get_flowrise_lab_id()` caută slug fix; identitatea și operații AI îl folosesc | P0 |
| Identificarea medicilor/tehnicienilor | Profile și istoric cu unele UUID-uri | `doctor_matches_partner()` și alte trasee folosesc încă nume; ambiguitățile trebuie eliminate, nu ghicite | P0 |
| Login | Turnstile, limiter atomic, mesaje generice, sesiune în browser | Audit live al Auth direct și al granturilor necesar; fallback global de 60/min poate bloca utilizatori legitimi | P0 |
| Fișiere | Buckets private, verificare acces, URL semnat 600 secunde | Metadatele se creează înainte de upload; finalizare/reconciliere și mărime reală trebuie probate | P0/P1 |
| Dashboard | 90 zile implicit, filtre recepție/livrare, RPC paginat, export limitat | Offset și totaluri nu sunt dovadă de performanță; exportul nu este snapshot tranzacțional | P1 |
| Notificări | Coadă persistentă, lease, webhook protejat, recuperare orară, status general | Lipsesc dovezi de alertare independentă; un răspuns Gmail nu dovedește primirea în inbox | P0 |
| Backup | Export n8n public/Auth recuperabil/Storage, două copii, marker complet | Fără dovadă de restore; citiri separate nu asigură snapshot coerent; două copii insuficiente pentru incidente descoperite târziu | P0 |
| AI | Preview, permisiuni, operații aprobate, idempotency, instrumente specializate | Fără buget măsurat per client și set de evaluare complet pentru date ostile/izolare/conflicte | P1 |
| Frontend | HTML/JS existent, module separate pentru dashboard/login/preferințe | app.js 10.084 linii, CSS 9.355 linii și 1.642 `!important`; Supabase JS încărcat ca `@2`, fără versiune exactă | P1 |
| Publicare | Git → Coolify, Caddy, imagini versionate parțial | Nu există pipeline GitHub Actions în repo; verificarea de blocare a deploy-ului în Coolify nu este cunoscută | P0 |
| Workflow-uri | Exporturi funcționale, generator pentru email | AI/backup au referințe la credentiale; setările lor nu suprascriu retenția globală `all` din compose | P0 |
| Documentație | Ghiduri de activare și acceptanță | README încă declară scaffolding; db/README descrie login fără rate limit; documente backup/test sunt neversionate | P0 |

## Dovezi în cod

- `db/schema/20_functions/get_flowrise_lab_id.sql`, `get_app_identity.sql`, `ai_execute_operation.sql`: cuplarea la Flowrise.
- `db/schema/20_functions/doctor_matches_partner.sql`, `current_technician_name.sql`, `db/schema/70_email_notifications.sql`: potriviri legacy bazate pe nume.
- `db/schema/30_policies/`, `db/schema/40_grants.sql`: baza de autorizare de păstrat și verificat sistematic, nu înlocuită cu verificări doar în interfață.
- `db/schema/10_tables/27_work_order_financial_audit.sql`, `25_work_order_stage_assignments.sql`: bază financiară reutilizabilă.
- `db/edge-functions/authorize-work-order-file/index.ts`: înregistrare de metadate înainte de upload, 45 MB la autorizare versus 50 MB în bucket.
- `website/app/dashboard-data.js`: citiri de maximum 200 și export maximum 10.000; detecția unor schimbări între pagini, fără snapshot complet.
- `deploy/docker-compose.yml`: execuții salvate global pe succes/eroare; `WEBHOOK_URL` diferit de intrarea publică reală documentată în Caddy.
- `workflows/Flowrise Dental - Complete Backup to Google Drive.json`: retenție, limită 4 GiB, export pe tabele și Auth fără parole.
- `website/app/index.html`: dependență CDN la versiune majoră și cache busting manual.

## Arhitectură propusă, fără rescriere integrală

1. Același cod și aceeași versiune de release pentru toate laboratoarele; configurație de branding, domenii, organizație și integrări separată de cod. Nu se amestecă celelalte produse/ramuri din repo cu produsul dental.
2. Primele implementări noi: proiect Supabase separat și automatizări/credentiale separate per client, generate din aceleași șabloane. Infrastructura fizică poate fi comună, cu resurse și acces delimitate. Aceasta reduce riscul migrării rapide la o bază comună; costul per client trebuie măsurat.
3. O bază comună pentru mai mulți clienți rămâne o decizie ulterioară, după teste de izolare, migrare de identități și dovezi economice. Nu numim produsul SaaS multi-client matur doar pentru că tabelele conțin organization_id.
4. Supabase păstrează regulile de business și autorizarea. n8n orchestrează integrări; browserul nu deține chei privilegiate. Frontendul se modularizează incremental, fără schimbare de framework ca scop în sine.
5. Păstrăm fluxurile financiare cu istoric și regulile de idempotency deja existente; migrațiile sunt aditive și compatibile înainte de eliminarea câmpurilor legacy.

## Ce înseamnă premium: criterii propuse, de măsurat

- Utilizator nou: creează prima lucrare fără ajutor în maximum 3 minute după instruire; flux uzual completat în maximum 60 secunde, fără uploaduri mari.
- La 360/390 px: acțiunile esențiale disponibile, fără derulare orizontală a paginii; excepții explicite pentru tabele complexe.
- Tastatură: creare/editare, dialoguri și notificări accesibile; focus vizibil, mesaje de eroare concrete, salvare și conflict explicite.
- Medicul vede doar lucrările sale, tehnicianul doar datele permise; numele identice și URL-urile ghicite nu schimbă accesul.
- Pilot benchmark: 50.000 lucrări/laborator, 10 utilizatori concurenți; listă filtrată p95 sub 1 secundă la API și utilizabilă în sub 2 secunde în browser, pe hardware/rețea consemnate. Sunt ținte, nu măsurători actuale.
- După salvare reușită, modificarea nu dispare la reîncărcare; două editări concurente nu se suprascriu fără avertizare.
- Notificare normală: p95 sub 2 minute în condiții normale ale furnizorilor; recuperare orară păstrată. `failed/uncertain`, coadă îmbătrânită și lipsă de execuție produc alertă către operator, nu către pacient.
- Recuperare: țintă inițială RPO ≤24h și RTO ≤4h, validate prin restore al bazei, Storage și accesului. Retenție țintă 7 zilnice + 4 săptămânale, cu buget calculat; nu încape garantat în 10 GB. Nu promitem zero pierderi sau SLA înainte de măsurare.
- Instalare tehnică standard ≤2h după primirea acceselor/DNS, fără editare de surse; onboarding client ≤1 zi de lucru, excluzând curățarea datelor și validările externe.

## Economie și limite comerciale

La 500 lei/lună venit, ținta propusă de cost direct recurent este ≤175 lei/lună/client, incluzând infrastructura alocată, AI, email, backup și timpul de suport. Aceasta ar însemna marjă de contribuție ≥65%, înainte de dezvoltare, vânzări, taxe și administrare. Nu este profit net și nu este costul actual măsurat.

Bugetul trebuie calculat pentru 1, 5 și 20 de clienți; costul primei instalări dedicate nu se împarte fictiv la clienți inexistenți. Dacă nu încape: reducem consumul, delimităm serviciile și reevaluăm pachetul, nu eliminăm backup-ul sau izolarea.

Core inclus: flux lucrări, colaboratori, producție, situații financiare, fișiere, notificări, actualizări, export și suport standard. Limite transparente pentru stocare/AI, importuri complexe și personalizări. Onboardingul asistat este avantaj comercial; suportul și dezvoltarea nelimitate nu sunt sustenabile.

## Limite și verificări comerciale externe

- Confirmați contractual responsabilitățile privind datele, furnizorii, retenția, exportul la încetare și incidentele; această analiză de cod nu stabilește conformitatea juridică.
- Verificați licența aplicabilă n8n pentru modelul efectiv de furnizare, inclusiv conturile Gmail/Drive ale clienților. Nu presupunem că orice backend comercial este gratuit sau că orice utilizare cere licență plătită. Cereți confirmare pentru arhitectura aleasă înainte de a o include în costul standard. Referință: https://n8n.io/legal/eula/ (termenii aplicabili ediției folosite trebuie confirmați).
- Supabase separă backup-ul bazei de fișierele Storage: https://supabase.com/docs/guides/platform/backups . Planul nostru trebuie să restaureze ambele.
- Nicio certificare, disponibilitate garantată sau avantaj competitiv exclusiv nu este afirmat fără dovadă.

## În afara primului release premium

Marketplace, aplicații native, Kubernetes, ERP fiscal complet propriu, editor arbitrar de workflow, diagnostic medical AI, rescriere completă React și personalizări nelimitate. Viewer STL, QR și conector fiscal intră numai după validarea utilității și a costului, în etapa de extindere.
