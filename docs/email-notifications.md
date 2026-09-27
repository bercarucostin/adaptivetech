# Notificări email pentru lucrări

## Comportament

Două preferințe per utilizator, implicit false: lucrare nouă/asignată și status de etapă modificat. Utilizatorul le schimbă prin butonul „Notificări email” din zona contului; administratorul le poate seta în configurarea utilizatorilor. Destinația este emailul confirmat din Supabase Auth. Nu se folosește o adresă furnizată de browser.

- Admin/manager activ: toate lucrările laboratorului său.
- Tehnician activ: lucrări asignate; schimbări numai la etapa asignată lui. Asignarea ulterioară este inclusă în prima bifă. Numele tehnicianului trebuie să identifice un singur utilizator activ în laborator, conform modelului existent de asignare.
- Medic activ dintr-o clinică conectată: lucrările partenerului său, conform acelorași identificatori folosiți de doctor_matches_partner.
- Statusul general, plățile și editările fără schimbare de etapă nu emit notificări.
- Etape neaplicabile și lucrări arhivate sunt excluse la emitere. Accesul, preferințele și adresa confirmată sunt reverificate la preluarea mesajului pentru trimitere.
- Migrarea nu trimite evenimente istorice. Preferințele sunt globale per cont, accesul este verificat pentru fiecare laborator.

Triggerul rulează în tranzacția lucrării, fără apel extern. Un rollback elimină și notificările. Evenimentele repetate din aceeași tranzacție sunt reunite; la status se păstrează valoarea inițială și finală. În email nu se includ pacientul, partenerul sau valori financiare. Linkul deschide aplicația autentificată, unde utilizatorul găsește lucrarea după număr.

## Alias Google Workspace

1. admin.google.com → Directory → Users → contact@flowrisedental.ro → Add Alternate Emails.
2. Adaugă app pe domeniul flowrisedental.ro și salvează.
3. Gmail ca contact@flowrisedental.ro → Settings → See all settings → Accounts → Send mail as → Add another email address.
4. Nume: Flowrise Dental — Notificări. Adresă: app@flowrisedental.ro. Păstrează Treat as an alias și finalizează eventuala verificare.
5. Autentificarea OAuth în n8n se face cu contact@flowrisedental.ro. Aliasul nu are parolă/cont propriu. Răspunsurile trimise către alias ajung în inboxul contact.

Surse: https://support.google.com/a/answer/33327 și https://support.google.com/mail/answer/22370

## Activare, în această ordine

1. Rulează `db/migrations/20260927_email_notifications.sql` în SQL Editor. Este reaplicabilă și aditivă. Nu rula întregul bundle de schemă peste producție pentru această schimbare.
2. Actualizează Edge Function `admin-users` cu întregul `db/edge-functions/admin-users/index.ts`. Verificarea sesiunii și rolului admin rămâne în funcție. Nu schimba setările login-with-identifier.
3. Publică frontendul nou. Deschide „Notificări email”, salvează și redeschide pentru a verifica persistența.
4. În proiectul Google Cloud folosit pentru n8n, activează Gmail API. Creează în n8n un credential **Gmail OAuth2 API**, folosind Client ID/Secret și callback-ul afișat de credential; conectează contul contact. Este o autorizare separată de Google Drive. Folosește o aplicație OAuth potrivită pentru utilizarea permanentă, nu un token de test care expiră periodic.
5. Importă `workflows/Flowrise Dental - Email Notifications.json`. Selectează credentialul Postgres Supabase în **Claim notifications** și **Record delivery**; selectează credentialul Gmail în **Send with Gmail**. Workflow-ul nu conține chei sau ID-uri de credentiale.
6. Lasă workflow-ul dezactivat. Activează bifele numai pentru un cont de test; creează o lucrare de test și modifică o etapă. Execută manual și verifică destinatarul, aliasul expeditorului, conținutul și înregistrarea `sent` cu ID Gmail.
7. Activează workflow-ul după verificare. Rulează la un minut și preia maximum 10 mesaje/rulare. Limitele Gmail sunt comune cu traficul normal al contului; monitorizează volumul și numărul mesajelor pending. Nu configura retry automat pe nodul de trimitere.

## Livrare și operare

`FOR UPDATE SKIP LOCKED` și un token de rezervare împiedică două execuții să preia același mesaj. Gmail nu oferă garanție de idempotency pentru send; nu promitem livrare exactly-once.

- `sent`: Gmail a returnat un ID de mesaj; acesta nu dovedește citirea sau livrarea finală în inbox.
- `pending`: în așteptare; HTTP 429 este reluat după 15 minute, maximum 5 încercări.
- `failed`: Gmail a respins explicit cererea (4xx, exceptând 429), sau s-a atins limita încercărilor.
- `uncertain`: timeout, 5xx, răspuns fără ID, ori execuție abandonată peste 15 minute. Nu se retrimite automat: verifică folderul Sent, folosind `rfc822msgid:<ID_COADA@flowrisedental.ro>`, înainte de reprogramare. Message-ID ajută reconcilierea, nu garantează deduplicarea Gmail.
- `suppressed`: cont inactiv, acces/preferințe schimbate, adresă neconfirmată ori schimbare de etapă anulată în aceeași tranzacție.

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

`node --test tests/notifications/*.test.mjs` — PostgreSQL izolat (PGlite), routing pe rol/laborator/etapă, opt-out, reasignare, rollback, coalescing, privilegii, leases, limite de retry, UI și MIME. Setează `PGLITE_MODULE_PATH` către modulul PGlite local dacă nu folosești calea implicită din teste.

`python3 tools/build-email-notification-workflow.py` regenerează JSON-ul din cele două surse Code; `python3 tools/build-supabase-editor-sql.py --check` verifică bundle-ul SQL.

Testele nu contactează Gmail sau baza de producție. Trimiterea reală, OAuth și aliasul trebuie probate în n8n înainte de activare.
