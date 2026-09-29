# QR pe fișa lucrării

## Comportament

Fiecare lucrare salvată primește `qr_token`, UUID aleator persistent, unic. Migrarea completează lucrările existente; cele noi primesc implicit tokenul. Reaplicarea migrării nu schimbă codurile deja printate.

Fișa exportată din lista de lucrări, Producție, fereastra de editare și fișa de caz include QR SVG alb/negru, cu zonă liberă de patru module, dimensiune 32 mm și numărul lucrării. Ciornele fără ID nu primesc link; fișa indică necesitatea salvării. Generarea se face în browser cu biblioteca locală qrcode-generator 2.0.4, licență MIT păstrată în `website/app/vendor/`. Niciun serviciu extern nu primește linkul pentru generare.

Codul conține numai adresa aplicației și fragmentul `#work-order=<uuid>`, fără pacient, preț, parolă ori token de autentificare. Fragmentul nu face parte din cererea HTTP către server. Codul este un identificator, nu un drept de acces.

La scanare, aplicația cere login dacă e necesar, păstrează destinația și verifică accesul prin RPC. Se deschide formularul existent al lucrării, cu acțiunile existente permise rolului: status/date, prescripție și atașamente. Scanarea nu face nicio mutație. Lucrările mai vechi de 90 zile se încarcă individual, fără schimbarea filtrelor sau descărcarea istoricului întreg.

Lucrările arhivate, inexistente, din alt laborator ori fără drept de acces nu se deschid. Masca financiară/asignările sunt aceleași ca în paginația existentă. La închiderea formularului, rândul temporar scanat este eliminat/restabilit; refresh-ul periodic este suspendat cât timp formularul QR este deschis.

## Activare

1. În Supabase → SQL Editor rulează **întreg** `db/migrations/20260929_work_order_qr.sql`. Include tranzacție, coloana/indexul, funcția de paginare cu filtrul exact pe ID și cele două RPC-uri securizate.
2. După succes, publică frontendul, inclusiv cele două module QR și biblioteca din `vendor`. Nu sunt necesare modificări n8n, secrete sau fișiere Edge Function.
3. Exportă o fișă a unei lucrări salvate și scanează QR-ul cu telefonul, din contul potrivit.
4. Verifică login → revenire în lucrarea scanată; repetă pentru o lucrare veche și pentru un cont fără acces.
5. Schimbă statusul în aplicație, apoi scanează aceeași fișă: trebuie să apară datele actuale.
6. Verifică fizic lizibilitatea codului pe imprimanta folosită; nu micșora QR-ul prin „multiple pagini pe foaie”.

Fișele PDF deja generate nu se modifică singure: trebuie reexportate pentru a include QR. Menține domeniul aplicației disponibil cât timp sunt folosite fișele; schimbarea domeniului necesită redirecționare compatibilă sau reprintare.

## Verificări locale

- `node --test tests/app/work-order-qr.test.js tests/app/work-order-qr-ui.test.js tests/app/case-sheet-chart.test.js`
- `PGLITE_MODULE=/path/to/pglite/dist/index.js node tests/sql/run-dashboard-pagination.mjs`
- Testul SQL rulează migrarea de două ori și verifică token stabil, date actualizate, roluri, date financiare mascate, lipsă acces anonim și lipsă acces între laboratoare.
- Testele UI verifică destinația păstrată până la login, răspunsurile neautorizate, închiderea formularului și invalidarea cererilor la schimbarea sesiunii.
- Verificare independentă efectuată local: SVG-ul rasterizat la dimensiunea nativă a fost decodat cu jsQR 1.4.0 și a returnat URL-ul exact. jsQR a fost folosit temporar numai pentru verificare, nu este o dependență a aplicației.

## Revenire

Frontendul anterior poate fi publicat din nou fără eliminarea coloanei QR. Păstrează tokenurile și RPC-urile pentru a nu pierde referințele tipărite; fără frontendul nou linkurile nu vor mai deschide automat lucrările. Nu șterge și nu regenera tokenurile ca metodă de rollback.
