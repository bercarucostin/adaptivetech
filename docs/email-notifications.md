# Notificări email pentru lucrări

## Comportament

Două preferințe per utilizator, implicit false: lucrare nouă/asignată și status general al lucrării modificat. Utilizatorul le schimbă prin butonul „Notificări email” din zona contului; administratorul le poate seta în configurarea utilizatorilor. Destinația este emailul confirmat din Supabase Auth. Nu se folosește o adresă furnizată de browser.

- Admin/manager activ: toate lucrările laboratorului său.
- Tehnician activ: lucrări asignate; schimbări de status general la oricare dintre lucrările asignate lui. Asignarea ulterioară este inclusă în prima bifă. Numele tehnicianului trebuie să identifice un singur utilizator activ în laborator, conform modelului existent de asignare.
- Medic activ dintr-o clinică conectată: lucrările partenerului său, conform acelorași identificatori folosiți de doctor_matches_partner.
- Schimbările statusului general (Neînceput, În lucru, Finalizat, Expediat, Listă trimisă, Plătit) emit notificări. Modificările etapelor sau câmpurilor de plată, fără schimbarea statusului general, nu emit notificări.
- Lucrările arhivate sunt excluse la emitere; asignările tehnicienilor la etape neaplicabile nu acordă acces. Accesul, preferințele și adresa confirmată sunt reverificate la preluarea mesajului pentru trimitere.
- Migrarea nu trimite evenimente istorice. Preferințele sunt globale per cont, accesul este verificat pentru fiecare laborator.

Triggerul rulează în tranzacția lucrării, fără apel extern. Un rollback elimină și notificările. Evenimentele repetate din aceeași tranzacție sunt reunite; la status se păstrează valoarea inițială și finală. În email nu se includ pacientul, partenerul sau valori financiare. Linkul deschide aplicația autentificată, unde utilizatorul găsește lucrarea după număr.

## Trecerea de la notificări de etapă la statusul general

1. Oprește temporar workflow-ul de email și așteaptă terminarea execuțiilor deja pornite.
2. Actualizează workflow-ul cu JSON-ul nou (sau copiază întregul `workflows/code/prepare-notification-email.js` în nodul **Prepare email**, păstrând celelalte noduri și credentialele). Păstrează-l oprit până după SQL. La import selectează din nou credentialele Postgres/Gmail/Header Auth.
3. Rulează **doar** `db/migrations/20260927_work_order_status_notifications.sql` în SQL Editor, ca postgres. Migrarea este tranzacțională și reaplicabilă, păstrează bifele existente și marchează vechile notificări de etapă încă pending drept suppressed. Nu retrimite istoricul. Nu rula vechea migrare peste aceasta.
4. Salvează/publică și reactivează workflow-ul. Webhook-ul Supabase rămâne INSERT pe aceeași coadă, cu același URL și secret. Dacă ai importat o copie, lasă workflow-ul vechi oprit.
5. Publică frontendul pentru noul text al bifei. Schimbă statusul general al unei lucrări de test și verifică emailul; schimbarea exclusivă a unei etape nu trebuie să creeze notificări.

Pentru compatibilitate, coloana `notify_stage_status` și numele parametrilor RPC rămân neschimbate, dar controlează acum statusul general. Evenimentul nou este `work_order_status`, cu `stage_key=NULL`. Admin/manager primesc evenimente din laboratorul lor, tehnicienii pentru oricare dintre etapele aplicabile asignate lor, medicii pentru lucrările lor. Evenimentele legacy `stage_status` nu mai sunt eligibile pentru claim.

## Alias Google Workspace

1. admin.google.com → Directory → Users → contact@flowrisedental.ro → Add Alternate Emails.
2. Adaugă app pe domeniul flowrisedental.ro și salvează.
3. Gmail ca contact@flowrisedental.ro → Settings → See all settings → Accounts → Send mail as → Add another email address.
4. Nume: Flowrise Dental — Notificări. Adresă: app@flowrisedental.ro. Păstrează Treat as an alias și finalizează eventuala verificare.
5. Autentificarea OAuth în n8n se face cu contact@flowrisedental.ro. Aliasul nu are parolă/cont propriu. Răspunsurile trimise către alias ajung în inboxul contact.

Surse: https://support.google.com/a/answer/33327 și https://support.google.com/mail/answer/22370

## Activare, în această ordine

1. La instalare nouă, rulează `db/migrations/20260927_email_notifications.sql`, apoi `db/migrations/20260927_work_order_status_notifications.sql` în SQL Editor. Este reaplicabilă și aditivă. Nu rula întregul bundle de schemă peste producție pentru această schimbare.
2. Actualizează Edge Function `admin-users` cu întregul `db/edge-functions/admin-users/index.ts`. Verificarea sesiunii și rolului admin rămâne în funcție. Nu schimba setările login-with-identifier.
3. Publică frontendul nou. Deschide „Notificări email”, salvează și redeschide pentru a verifica persistența.
4. În proiectul Google Cloud folosit pentru n8n, activează Gmail API. Creează în n8n un credential **Gmail OAuth2 API**, folosind Client ID/Secret și callback-ul afișat de credential; conectează contul contact. Este o autorizare separată de Google Drive. Folosește o aplicație OAuth potrivită pentru utilizarea permanentă, nu un token de test care expiră periodic.
5. Importă `workflows/Flowrise Dental - Email Notifications.json`. Selectează credentialul Postgres Supabase în **Claim notifications** și **Record delivery**; selectează credentialul Gmail în **Send with Gmail**. Workflow-ul nu conține chei sau ID-uri de credentiale.
6. Lasă workflow-ul dezactivat. Activează bifele numai pentru un cont de test; creează o lucrare de test și modifică statusul general. Execută manual și verifică destinatarul, aliasul expeditorului, conținutul și înregistrarea `sent` cu ID Gmail.
7. Configurează webhook-ul protejat și verificarea orară conform secțiunii următoare. Limitele Gmail sunt comune cu traficul normal al contului; monitorizează volumul și numărul mesajelor pending. Nu configura retry automat pe nodul de trimitere.

## Webhook imediat și recuperare o dată pe oră

Nu este necesară o nouă migrare SQL sau modificarea aplicației web. Configurarea webhook-ului se face în proiectul Supabase; simplul import al JSON-ului nu o creează.

1. Importă JSON-ul actualizat într-un workflow **inactiv**. Selectează din nou credentialele Postgres și Gmail dacă n8n nu le păstrează.
2. În **Notification webhook**, creează un credential **Header Auth**: Name `X-Flowrise-Webhook-Secret`, Value un secret aleator de minimum 32 bytes, generat într-un password manager. Păstrează-l doar în credentialul n8n și configurația Supabase; nu îl adăuga în Git, browser sau conversații.
3. Verifică nodul **Hourly recovery**: interval Hours, 1. Dezactivează vechiul workflow care rulează la minut, apoi activează/publică versiunea nouă. Pentru deploy-ul Flowrise cu `deploy/Caddyfile`, folosește URL-ul public `https://app.flowrisedental.ro/api/ai/flowrise-email-notifications`. Proxy-ul îl rescrie către `/webhook/flowrise-email-notifications` în n8n. URL-ul afișat de editor pe domeniul n8n este blocat intenționat cu 404 și mesajul „Not here. Use …/api/ai/”. Nu folosi Test URL și nu dezactiva această regulă de proxy.
4. În **Supabase → Integrations → Database Webhooks**, activează Database Webhooks dacă este necesar și creează `email-notifications-n8n`:
   - Table: `public.email_notification_queue`.
   - Events: **INSERT numai**. Nu selecta UPDATE: Claim/Record actualizează coada și ar produce apeluri inutile în buclă.
   - Type: HTTP Request; Method: POST; URL: `https://app.flowrisedental.ro/api/ai/flowrise-email-notifications` pentru deploy-ul Flowrise.
   - Headers: `Content-Type: application/json` și `X-Flowrise-Webhook-Secret` cu exact valoarea din credential.
   - Timeout: 5000 ms. n8n răspunde imediat; răspunsul confirmă pornirea, nu livrarea emailului.
5. Activează preferința pe contul de test și schimbă statusul general al unei lucrări de test. Fără rulare manuală în n8n, verifică emailul și `state='sent'` în coadă. Verifică și că un apel fără header este respins și nu pornește procesarea.
6. Pentru proba recuperării, dezactivează temporar doar webhook-ul din Supabase, generează un eveniment de test și verifică `pending`. Rulează manual workflow-ul pentru a verifica aceeași cale de recuperare, apoi reactivează webhook-ul. Confirmă separat următoarea execuție programată orară.

Webhook-ul este doar un semnal: destinatarul și conținutul sunt citite din baza de date, nu din payloadul HTTP. Webhook-urile Supabase folosesc apeluri asincrone. Mai multe inserări pot porni execuții concurente; mecanismul existent de claim cu lease și SKIP LOCKED evită preluarea simultană a aceluiași mesaj. Payloadul implicit Supabase conține metadatele rândului din coadă; păstrează dezactivată salvarea datelor de execuție.

Fiecare execuție procesează loturi de 10, cu maximum 20 de loturi (200 de notificări). **Next batch** continuă numai după **Record delivery**. Un claim fără rezultate oprește fluxul; nu activa **Always Output Data** pe Claim notifications. Un backlog peste această limită este continuat la un webhook ulterior sau la următoarea verificare orară. Claim examinează cel mult 100 de candidați pe lot; dacă toți sunt excluși, restul așteaptă următoarea execuție.

Verificarea orară recuperează apelurile ratate și mesajele `pending` eligibile pentru retry. Pragul SQL de 15 minute pentru HTTP 429 rămâne un minim: fără alt webhook, retry-ul are loc la următoarea execuție orară. `uncertain` rămâne pentru reconciliere manuală, nu este retrimis automat. După o întrerupere n8n, webhook-ul nu garantează livrarea; coada persistentă și recuperarea orară asigură posibilitatea reluării.

Surse: [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks), [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/).

## Livrare și operare

`FOR UPDATE SKIP LOCKED` și un token de rezervare împiedică două execuții să preia același mesaj. Gmail nu oferă garanție de idempotency pentru send; nu promitem livrare exactly-once.

- `sent`: Gmail a returnat un ID de mesaj; acesta nu dovedește citirea sau livrarea finală în inbox.
- `pending`: în așteptare; HTTP 429 este reluat după 15 minute, maximum 5 încercări.
- `failed`: Gmail a respins explicit cererea (4xx, exceptând 429), sau s-a atins limita încercărilor.
- `uncertain`: timeout, 5xx, răspuns fără ID, ori execuție abandonată peste 15 minute. Nu se retrimite automat: verifică folderul Sent, folosind `rfc822msgid:<ID_COADA@flowrisedental.ro>`, înainte de reprogramare. Message-ID ajută reconcilierea, nu garantează deduplicarea Gmail.
- `suppressed`: cont inactiv, acces/preferințe schimbate, adresă neconfirmată ori schimbare de status general anulată în aceeași tranzacție.

Nu relua manual execuția direct de la nodul Gmail. Reprogramarea controlată, doar după confirmarea că mesajul nu a fost trimis:

```sql
UPDATE public.email_notification_queue
SET state='pending', attempts=0, available_at=now(), lease_token=NULL, leased_at=NULL
WHERE id='UUID_VERIFICAT' AND state IN ('failed','uncertain');
```

Monitorizare în SQL Editor:

```sql
SELECT state,count(*),min(created_at) AS oldest
FROM public.email_notification_queue GROUP BY state;
SELECT id,event_kind,work_order_id,state,attempts,created_at,provider_message_id
FROM public.email_notification_queue
WHERE state IN ('failed','uncertain') ORDER BY created_at DESC LIMIT 100;
```

Execuțiile automate nu păstrează payloadurile în istoricul n8n; exportul workflow-ului nu include credentiale. Coada păstrează metadate de livrare, fără corpul MIME sau adresa email. Configurează monitorizarea n8n și verifică periodic failed/uncertain: nu toate refuzurile Gmail apar ca execuții n8n eșuate.

## Verificare locală

`node --test tests/notifications/*.test.mjs` — PostgreSQL izolat (PGlite), routing pe rol/laborator/asignare, opt-out, reasignare, rollback, coalescing, privilegii, leases, limite de retry, UI și MIME. Setează `PGLITE_MODULE_PATH` către modulul PGlite local dacă nu folosești calea implicită din teste.

`python3 tools/build-email-notification-workflow.py` regenerează JSON-ul din cele două surse Code; `python3 tools/build-supabase-editor-sql.py --check` verifică bundle-ul SQL.

Testele nu contactează Gmail sau baza de producție. Trimiterea reală, OAuth și aliasul trebuie probate în n8n înainte de activare.
