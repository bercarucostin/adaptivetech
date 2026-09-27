# Activare: login protejat, backup complet, dashboard paginat

Implementarea este locală. Nicio migrare, funcție Edge, configurație Auth sau automatizare de backup nu a fost aplicată în producție. Nu este suficient un push pentru activarea completă.

## Ce este pregătit

- Login: limitare atomică înainte de căutarea utilizatorului, contorizare comună nickname/email, CAPTCHA Turnstile în aplicație și editorul prețurilor publice, mesaje 429 cu interval de reîncercare. Configurația lipsă blochează loginurile noi.
- Date: 90 de zile calendaristice după recepție, inclusiv ziua curentă în fusul Europe/Bucharest; dacă recepția lipsește se folosește data creării. Intervalele de recepție și livrare pot fi schimbate/eliminate independent. Selectarea istoricului cere alte date din baza de date.
- Lista: 100 de lucrări/pagină, maximum 200/RPC; filtre și sortare pe server, totaluri pentru întregul interval. Producția prioritizează termenele apropiate și păstrează statusurile vizibile pentru fiecare rol. Detaliile grupate pe partener și coloanele de producție sunt etichetate ca fiind pentru pagina curentă.
- Export: toate rezultatele filtrate, în cereri de câte 200; maximum 10.000 de lucrări/export, cu mesaj de restrângere a perioadei peste acest prag. Un set modificat detectabil între pagini anulează exportul. Nu este un snapshot tranzacțional al modificărilor simultane; pentru un raport contabil înghețat se folosește o perioadă fără modificări.
- Backup: workflow exclusiv n8n, fără configurare pe server, care exportă toate tabelele `public`, metadatele recuperabile Auth, configurația bucket-urilor și toate obiectele Storage în folderul Google Drive privat. Schema și automatizările sunt restaurate din Git. Păstrează două copii complete în bugetul rezervat de 8 GiB și marchează un backup drept complet numai după toate uploadurile.

## Informații încă lipsă, confirmate de utilizator

Nu există încă un widget Turnstile. Folderul Google Drive și credentialul OAuth au fost create, dar workflow-ul, monitorizarea și restaurarea nu au fost încă probate în producție. Nu există dovada unui backup complet restaurat. Aceste puncte blochează declararea pregătirii pentru un client nou.

## Ordinea de activare

1. **Backup înaintea schimbărilor de producție.** Importați și configurați workflow-ul exclusiv în n8n conform [backup-restore.md](backup-restore.md). Credentialele Supabase și Google Drive se salvează în n8n, nu în Git/chat. Executați o copie completă și testul de restaurare într-un proiect Supabase izolat.
2. **Turnstile.** Creați widgetul pentru domeniile reale folosite de aplicație și editorul listei de prețuri. Cheia publică se pune în `website/app/supabase-config.js`, proprietatea `turnstileSiteKey`. Cheia secretă se pune exclusiv în Supabase Auth CAPTCHA. Pașii și limitele sunt în [login-security.md](login-security.md).
3. **SQL.** În staging, apoi într-o fereastră de mentenanță în producție, rulați ca owner:
   - [20260927_login_rate_limit.sql](../db/migrations/20260927_login_rate_limit.sql)
   - [20260927_dashboard_pagination.sql](../db/migrations/20260927_dashboard_pagination.sql)
   Migrațiile sunt reaplicabile și nu rescriu lucrările existente. Pentru o instalare nouă, bundle-urile `db/schema/apply.sql` și `apply.supabase.sql` includ aceleași definiții.
4. **Edge Function + frontend.** Configurați `LOGIN_RATE_LIMIT_SECRET`, publicați întregul director `db/edge-functions/login-with-identifier/` (include `handler.mjs`) cu verificarea JWT dezactivată și activați CAPTCHA în Supabase Auth. Publicați frontendul cu cheia publică reală, coordonat cu această schimbare. Frontendul vechi nu trimite CAPTCHA; de aceea pașii Auth/Edge/frontend trebuie coordonați. SQL-ul nou este aditiv, astfel încât cititorii existenți să rămână compatibili în timpul tranziției.
5. **Verificări live înainte de client nou.** Testați login valid/invalid, nickname/email, CAPTCHA invalid/expirat, limitare 429 și acces direct Supabase Auth. Confirmați accesul pe roluri/laboratoare, istoricul, datele de la capetele intervalului, pagina a doua și exportul complet. Măsurați interogarea pe un volum reprezentativ și verificați planul cu `EXPLAIN (ANALYZE, BUFFERS)` într-un mediu adecvat. Confirmați alerta de backup și restaurarea inclusiv a autentificării, fișierelor și credentialelor n8n.

## Dovezi locale

- Teste Node pentru interfață, fluxuri și autentificare.
- PostgreSQL izolat (PGlite): paginare, granițe de zi/DST, istoric, totaluri, salarii istorice, permisiuni și reaplicarea migrării.
- Teste pentru contractul workflow-ului de backup: inventarierea dinamică a tabelelor și Storage, export Auth fără parole/tokenuri, retenție, limită de capacitate și marker de finalizare.
- Fixture offline cu scripturile reale ale aplicației: `python3 tests/app/build-dashboard-browser-fixture.py`; deschidere în browser a fișierului `/tmp/dashboard-browser.html`. Folosește 305 lucrări fictive și interzice accesul la rețea.

Testele locale nu dovedesc că protecțiile sau backup-urile sunt active în producție. Păstrați ora ultimei copii reușite și procesul-verbal al restaurării ca dovezi de operare.
