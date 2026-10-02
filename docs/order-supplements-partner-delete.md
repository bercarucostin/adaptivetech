# Deadline, supliment manual și ștergere partener

Fișa exportată afișează data și ora termenului de livrare în fusul
`Europe/Bucharest`. Fișele istorice fără oră păstrează afișarea datei.
Exportul din formular folosește data și ora selectate acolo.

În editarea unei lucrări existente, Admin/Manager poate completa un supliment
în RON și justificarea acestuia lângă total. Pentru sume pozitive, justificarea
este obligatorie. Suplimentul se aplică după discount; suma zero îl elimină.
Modificarea se păstrează în istoricul financiar. Recalcularea prețurilor și
retrimiterea lucrării de către Partner păstrează suplimentul. O editare care nu
modifică suplimentul îl păstrează chiar dacă încărcarea prețurilor este întârziată
sau eșuează. Salvarea editării și a suplimentului reprezintă o tranzacție SQL.

În dialogul unei comenzi Lab Partner, Admin/Manager are aceleași câmpuri și un
buton separat „Salvează suplimentul”. Partner vede suma și justificarea în total,
inclusiv când lucrarea poate fi editată și retrimisă.

Admin poate șterge un partener/laborator din catalog, după confirmare. Operația
elimină partenerul și asocierile conturilor Lab Partner. Lucrările, fișele,
atașamentele, numele partenerului și istoricul financiar rămân; conturile anterior
asociate nu mai au acces prin acea asociere. Dezactivarea rămâne disponibilă.

## Publicare

1. În Supabase, aplică `db/migrations/20261002_order_supplements_partner_delete.sql`
   după `20261002_lab_partner_portal.sql`, într-o tranzacție (`BEGIN;` înainte și
   `COMMIT;` după script).
2. Publică frontendul actualizat din `website/app`. Fișierele au versiuni noi.
3. Verifică în producție exportul cu oră, un supliment de 50 RON pentru transport,
   păstrarea suplimentului la o editare fără schimbarea prețului și ștergerea unui
   partener de test, inclusiv păstrarea lucrărilor și revocarea accesului Partner.

Această modificare nu necesită actualizarea Edge Function
`authorize-work-order-file`. Testele locale nu modifică datele din producție.

## Verificare

- 11 teste noi; suita completă: 298 teste, 294 trecute, aceleași 4 eșecuri
  preexistente documentate în `lab-partner-portal.md`.
- Verificări Chrome cu scripturile/CSS reale și servicii fictive offline la
  1440×1000, 1024×768, 390×844 și 320×740. Acoperă salvarea suplimentului în
  ambele dialoguri, calculul totalului, păstrarea valorii nemodificate, ascunderea
  câmpurilor pentru Doctor și ștergerea din catalog. Geometria, contrastul sumei
  și câmpurile stivuite pe mobil au verificări suplimentare.
- Testele PGlite verifică autorizarea, justificarea obligatorie, auditul,
  recalcularea fără cumul repetat, eliminarea suplimentului, tranzacția atomică
  și păstrarea istoricului la ștergerea partenerului. Testul wrapperului folosește
  un editor vechi fictiv la limita RPC; testul de audit execută funcția reală
  `set_work_order_price_snapshot`.
- Revizie separată a codului, verificări de sintaxă, SQL generat și whitespace.

Capturile și rezultatele Chrome se află în directorul alăturat repository-ului:
`../flowrise-review-supplements-20261002/`.
