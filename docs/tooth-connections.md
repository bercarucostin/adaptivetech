# Legături între dinți

Punctele din exteriorul arcadelor reprezintă cele 30 de perechi FDI vecine.
Verde înseamnă legătură activă; un punct gol înseamnă lipsa legăturii.
Clickul pe punct activează imediat legătura. Dacă un dinte nu este inclus încă,
este adăugat în selecție și pop-up-ul cere tipul lucrării înainte de salvare.
Nu există legături între arcade sau peste dinți lipsă.

În pop-up, „Solidarizează dinții selectați” modifică numai legăturile cu
**ambele** capete în selecție. O selecție discontinuă produce grupuri separate.
Starea mixtă păstrează legăturile existente dacă utilizatorul schimbă doar
culoarea, tipul sau notele. Eliminarea unui dinte elimină legăturile lui.

## Date

Contractul existent `case.tooth_details` acceptă:

```json
{
  "__case": {
    "tooth_connections": [[46, 45], [45, 44]]
  }
}
```

Lista este completă, deduplicată și normalizată în ordinea arcadelor. Exemplul
formează grupul 46–45–44. Dinții fără legături sunt „solo”; grupurile cu minimum
doi dinți sunt „solidarizați”. Aceste stări se derivă din legături, fără câmpuri
duplicate care ar putea deveni contradictorii. Cazurile vechi pornesc fără legături.

- Omiterea `tooth_connections` păstrează legăturile existente.
- `[]` șterge explicit toate legăturile.
- Legăturile explicite invalide sau cu dinți neincluși sunt respinse.
- Modificarea doar a selecției curăță legăturile către dinții eliminați.
- Editările parțiale păstrează celelalte detalii clinice și metadatele.
- Validarea rulează în writer-ul SQL comun, în aceleași tranzacții și cu
  aceleași permisiuni ca salvarea lucrării. Nu schimbă prețurile sau facturarea.

## Publicare

1. Aplică **doar** `db/migrations/20260922_tooth_connections.sql` în Supabase
   SQL Editor, pe baza existentă. Scriptul este tranzacțional și poate fi repetat.
   Pentru această actualizare nu folosi schema completă, care include cutover-uri istorice.
2. Actualizează workflow-ul existent din `workflows/Flowrise Dental - AI Client V17.4.json`.
   Schimbările sunt în `AI - Parse Final`, `AI - Build Final Prompt` și
   `AI - Build Retrieval Plan`. AI citește legăturile existente înainte de editare
   și păstrează perechile neafectate. Nu sunt necesare credențiale noi.
3. Publică fișierele `website/app/app.js`, `styles.css` și `index.html` (18.38).
4. Verifică într-o lucrare de test: două puncte consecutive bifate, salvare,
   redeschidere, debifare și eliminarea dintelui intermediar.

Această schimbare nu aplică automat SQL-ul și nu activează automat workflow-ul n8n.

## Verificare locală

```sh
node --test tests/**/*.test.js
python3 -m unittest discover -s tests/sql -p 'test_*.py'
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node tests/sql/run-tooth-connections.mjs
node tests/app/tooth-connections-browser.mjs /tmp/tooth-connections.html 300
```

Ultima comandă generează o pagină locală cu controalele reale și verificări
DOM pentru click, tastatură, selecție mixtă, aplicare comună, read-only,
eliminare/reintroducere și round trip. Deschide pagina în Chrome; rezultatul
apare în pagină și în `document.body.dataset.result`. PGlite folosește o bază
izolată; harness-ul testează writer-ul real, cu dependențele de rol și tabelele
minimale necesare. Testele de permisiuni Supabase rămân în suita SQL existentă.
