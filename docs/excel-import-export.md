# Import și export Excel

Disponibil administratorilor în Configurare: prețuri, tipuri de lucrări și costuri de tehnician.

1. Descarcă Excel (.xlsx).
2. Editează valorile în Excel și salvează în același format. Păstrează antetele și identificatorii existenți; pentru rânduri noi lasă identificatorul gol (Source_Row_No pentru costuri).
3. Importă Excel / CSV, verifică previzualizarea și confirmă. Nicio modificare nu este trimisă înainte de confirmare.

MERGE adaugă și actualizează rânduri. REPLACE înlocuiește întreaga secțiune și necesită o bifă de confirmare suplimentară. Ștergerea unui rând din fișier nu îl șterge prin MERGE.

Identificatorii se exportă ca text, iar prețurile și costurile ca numere. Păstrează coloanele de identificatori ca text pentru a conserva zerourile inițiale. Identificatorii numerici interni ai tipurilor și Source_Row_No sunt normalizați la numere întregi la import.

Maximum 10 MB, 10000 de rânduri și o singură foaie per import. Formulele și datele calendaristice nu sunt acceptate în aceste configurații; pentru formule, copiază și lipește doar valorile. Erorile indică rândul sau celula. Previzualizarea arată primele 15 rânduri, dar validarea verifică întregul fișier.

CSV rămâne disponibil separat. Importul recunoaște virgula, punctul și virgula sau TAB, cu UTF-8 și diacritice. Nu este necesară reconversia unui fișier Excel în CSV.

Procesarea fișierelor are loc local în browser, într-un Web Worker. Salvarea folosește RPC-ul existent `admin_bulk_config_import` și drepturile de administrator. Nu sunt necesare modificări SQL sau n8n.
