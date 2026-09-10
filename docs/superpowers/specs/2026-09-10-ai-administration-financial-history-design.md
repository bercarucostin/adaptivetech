# Administrare prin AI și istoric financiar pe lucrare

Data: 2026-09-10

Stare: regulile de produs au fost confirmate în conversație; documentul consolidat este pregătit pentru revizuire. Nu reprezintă o implementare sau o migrare executată.

## Obiectiv

Adminul poate administra datele aplicației prin AI, inclusiv lucrări, tarife, costuri, materiale și calendar. Tehnicienii pot vedea stocul și modifica cantitățile materialelor și pot vedea, crea și edita evenimente personale și comune. Lucrările își păstrează prețurile, iar fiecare atribuire de tehnician își păstrează costurile, indiferent de modificările ulterioare ale grilelor.

Comanda inițială «duplică tehnicianul Denis pentru costuri, noul nume Kiki» trebuie să copieze profilul de costuri. Nu creează o lucrare și nu creează un cont de autentificare.

## Dovezi din repository

- `workflows/Flowrise Dental - AI Client V17.4.json` permite numai intențiile generice create/update/delete pentru lucrări și le trimite la `ai_mutate_work_order_role_safe`. Parserul nu validează categoria de entitate. Acest traseu explică eroarea de pacient obligatoriu la o cerere pentru costuri; execuția reală n8n nu a fost inspectată.
- `website/app/app.js`, `adminDuplicateSelectedTechnician`, copiază deja tipul lucrării, etapa și costul către un nume nou în interfața admin.
- `lab_work_orders` nu are un preț propriu în definiția locală. `get_my_work_orders` și `ai_read_dataset` calculează prețurile folosind grila curentă.
- Există însă un flux pe dinți: `replace_work_order_items` scrie `unit_price` și `line_total` în `lab_work_order_items`, iar `get_my_work_orders_v188` folosește acele valori. Înlocuirea pozițiilor șterge și recreează liniile la tarifele curente. Definiția tabelului nu a fost găsită în schema locală inspectată; reconcilierea dependențelor este necesară înaintea migrării.
- `get_my_salary` și `ai_technician_receivables` citesc costul curent din `lab_technician_costs`. Sumele considerate plătite sunt deduse din marcaje Paid/Not Paid.
- `set_stage_payment_status` modifică numai marcajul plății; nu înregistrează separat suma sau data plății.
- `update_material_quantity` permite deja managementului și tehnicienilor să seteze cantități nenegative.
- Politicile calendarului permit tehnicienilor să citească evenimentele comune, dar să editeze doar evenimentele proprii. Cataloagele AI pentru tehnicieni nu includ încă materiale și calendar.

## Abordarea aleasă

Extindem funcțiile și fluxurile existente cu operații explicite, validate pe server, și evidență financiară persistentă. Același mecanism financiar servește interfața, importurile și AI-ul.

Alternative considerate:

1. Doar schimbarea promptului AI: intervenție mică, dar nu adaugă operațiile lipsă și nu păstrează valorile istorice.
2. Un executor SQL generic: ar accepta mai multe cereri, dar nu exprimă regulile de atribuire, plată și păstrare a istoricului.
3. Operații pe domenii și valori financiare persistente, recomandată: necesită schimbări coordonate, dar permite validarea și verificarea fiecărui efect.

Livrarea se împarte în trei componente: evidență financiară, operații administrative AI, materiale/calendar. Evidența financiară trebuie să fie activă înainte de activarea modificării grilelor prin AI.

## Permisiuni

| Domeniu | Admin | Tehnician |
| --- | --- | --- |
| Lucrări | Creare, editare, ștergere cu păstrarea istoricului financiar | Crearea permisă în prezent; celelalte restricții existente rămân |
| Prețul unei lucrări | Modificare explicită, auditată | Fără acces comercial |
| Tarife, contracte, tipuri de lucrări, costuri tehnicieni, parteneri | Adăugare, editare, duplicare unde are sens, ștergere validată | Fără administrare |
| Materiale | Administrare și cantități | Citire stoc și setare/adăugare/scădere cantitate |
| Calendar comun | Citire, creare, editare și ștergere | Citire, creare și editare, inclusiv evenimente create de colegi |
| Calendar personal | Operații asupra calendarului propriu | Citire, creare și editare în calendarul propriu |
| Costuri și plăți istorice | Toți tehnicienii laboratorului | Numai propriile atribuiri și plăți |
| Utilizatori și alte configurații administrative | Operații dedicate care respectă validările existente | Fără acces nou |

Accesul la calendarele personale ale altor utilizatori nu se extinde implicit. Ștergerea evenimentelor de către tehnicieni păstrează drepturile existente; cererea nouă extinde editarea calendarului comun.

Rolul Manager păstrează drepturile existente. Extinderile administrative cerute pentru Admin nu i se acordă automat. Doctor și Dashboard nu primesc acces AI nou.

«Orice informație din tabele» se traduce prin administrarea datelor funcționale ale laboratorului: fiecare entitate primește operații și câmpuri permise, inclusiv configurații și administrarea utilizatorilor prin mecanismul dedicat existent. Identificatorii de autentificare, secretele și jurnalul de audit nu devin câmpuri editabile generic. Relațiile între organizații păstrează regulile existente de autorizare.

## Prețul lucrării

La crearea lucrării se salvează prețul unitar, cantitatea, discountul, totalul și proveniența tarifului. Pentru lucrările pe dinți se păstrează valorile fiecărei poziții; totalul rezultă din pozițiile salvate. Un preț zero explicit este diferit de lipsa unui tarif.

Modificarea sau ștergerea unui tarif nu recalculează lucrările existente. Citirea, rapoartele, exporturile și AI-ul folosesc aceleași valori persistente. O estimare pentru o lucrare nouă poate folosi grila curentă, dar nu rescrie o lucrare existentă.

Editarea datelor nefinanciare nu modifică prețurile. Pentru o modificare explicită de cantitate sau discount, totalul poate fi recalculat folosind prețul unitar păstrat, cu istoric înainte/după. O schimbare de contract nu reaplică automat tariful. O schimbare de tip sau de poziții prezintă impactul financiar: liniile neschimbate își păstrează prețurile, iar liniile noi primesc tarifele curente. Modificarea explicită a unui preț existent este disponibilă adminului.

Operațiile pe dinți nu mai șterg și recreează financiar toate pozițiile fără a distinge liniile păstrate de cele modificate. Răspunsul la salvare trebuie să reflecte valorile salvate, nu o nouă estimare din catalog.

## Atribuiri și costuri ale tehnicienilor

Fiecare atribuire are o identitate proprie, laborator, lucrare, etapă, identitatea tehnicianului, numele afișat la atribuire, cost unitar, baza de cantitate, suma convenită, proveniența și data stabilirii costului. Identitatea stabilă este folosită unde există; numele legacy rămâne o valoare istorică și mapările ambigue nu se ghicesc.

Costul se fixează la atribuirea tehnicianului, nu la finalizare sau plată. Modificarea grilei nu schimbă atribuirea. Pentru lucrări cu tipuri multiple, componentele costului se păstrează pe tip/poziție și etapă, fără a aplica arbitrar costul primului tip tuturor pozițiilor.

O etapă are cel mult o atribuire activă. Schimbarea tehnicianului închide atribuirea precedentă și creează una nouă, cu costul valabil atunci. Istoricul și plățile vechi rămân legate de atribuirea veche. Reatribuirea nu transferă automat soldul: dacă există sume restante, operația cere o decizie explicită asupra lor înainte de finalizare, pentru a evita dublarea neintenționată a obligațiilor.

Editările ulterioare de cantitate nu rescriu tacit suma convenită cu tehnicianul. O ajustare a costului sau cantității remunerate este o operație explicită de admin, auditată. Etapele neaplicabile nu generează obligații noi.

## Plăți și istoric

Plata este o înregistrare distinctă: atribuire, sumă, monedă, data efectivă a plății, data înregistrării și autor. Totalul plătit rezultă din înregistrările de plată; soldul rezultă din obligația salvată și plățile nete.

Interfața existentă «Paid» înregistrează stingerea soldului curent când utilizatorul confirmă plata. Repetarea aceleiași cereri nu dublează plata. Revenirea la «Not Paid» este o corecție explicită cu înregistrare de reversare, nu ștergerea unei plăți. Plățile parțiale pot fi reprezentate de model; nu este necesară o interfață financiară separată pentru a livra istoricul solicitat.

Istoricul unei lucrări arată atribuirea, etapa, costul convenit, plățile și corecțiile. Adminul poate întreba «cât i-am plătit lui Denis pentru lucrarea 123?» și primește sumele înregistrate, fără consultarea grilei curente. Tehnicianul are acces la propriul istoric și după o reatribuire, prin date limitate la propria remunerație.

Ștergerea unei lucrări sau dezactivarea unui utilizator nu șterge în cascadă istoricul financiar; lucrările cu istoric sunt arhivate din punct de vedere operațional. Înregistrările de audit și plăți nu pot fi rescrise direct de clienți.

## Contractul operațiilor AI

AI-ul produce o propunere structurată cu entitate, operație, identificatori și câmpuri. Serverul verifică schema, rolul, laboratorul, țintele și starea curentă înainte de execuție. Rolul și laboratorul sunt derivate din identitatea autentificată. Un payload destinat costurilor nu este acceptat ca lucrare.

Catalogul din bootstrap prezintă separat datele citibile și operațiile disponibile. Citirile pentru tehnicieni adaugă stocul și calendarul autorizat, fără a expune prețurile clienților sau remunerația colegilor. Toate citirile noi și reutilizate sunt verificate pentru filtrarea laboratorului și proprietarului, inclusiv funcțiile SECURITY DEFINER.

Operațiile administrative acoperă lucrări, prețuri individuale, tarife, costuri, contracte, tipuri, parteneri, materiale și calendar. Celelalte configurații administrative și utilizatorii folosesc adaptoare către validările existente, fără un executor SQL liber. Catalogul enumeră exhaustiv capabilitățile implementate; AI-ul explică o operație indisponibilă în loc să o convertească într-o operație asupra altei entități.

Duplicarea Denis → Kiki copiază toate rândurile de cost ale sursei în aceeași tranzacție. Sursa absentă sau ambiguă cere clarificare. Dacă destinația are costuri, operația nu combină sau suprascrie automat datele; prezintă conflictul și cere alegerea explicită a comportamentului. Identificatorii sunt alocați pe server, inclusiv la cereri concurente.

Modificările în masă și ștergerile folosesc o previzualizare persistentă cu ținte și valori, legată de utilizator și laborator. Confirmarea execută exact propunerea previzualizată; o schimbare relevantă a datelor o invalidează. Un mesaj «da» fără o propunere validă nu autorizează o operație nouă. Identificatorul cererii previne dublarea efectelor la retry, în special pentru plăți, duplicări și ajustări de stoc.

Serverul returnează un rezultat structurat cu entitate, operație, ținte, număr de rânduri și valori salvate. AI-ul confirmă succesul numai după commit. Erorile de validare sunt explicate în limba utilizatorului; nu se inventează pacienți sau alte câmpuri pentru a trece validarea greșită.

## Materiale și calendar

Stocul permite trei operații distincte: setează cantitatea, adaugă și scade. Ajustările se aplică atomic asupra valorii curente. Setarea absolută detectează o schimbare concurentă față de valoarea consultată. Cantitățile negative și unitățile incompatibile sunt respinse; materialele cu nume ambigue cer identificare.

Evenimentele cer titlu, dată și calendar personal/comun; ora este opțională. Datele relative sunt interpretate în fusul laboratorului, Europe/Bucharest pentru configurația curentă. Dacă destinația personal/comun nu este clară din cerere sau context, AI-ul întreabă înainte să creeze evenimentul.

Tehnicienii pot edita conținutul evenimentelor comune, inclusiv ale colegilor. Această permisiune nu permite schimbarea proprietarului, accesarea evenimentelor personale ale altuia sau transformarea lor în evenimente comune. Aceleași reguli se aplică în interfață și în baza de date.

## Migrare și compatibilitate

1. Reconciliem schema locală și schema țintă pentru tabelele de poziții și toate punctele de creare/editare, inclusiv importurile și scrierile directe din interfață.
2. Adăugăm structurile persistente și istoricul fără a activa încă noile mutații AI.
3. Păstrăm prețurile existente recuperabile, inclusiv pozițiile pe dinți. Pentru celelalte lucrări fixăm tariful curent, cu proveniență «stabilit la migrare», conform acordului utilizatorului. Lipsa tarifului rămâne explicită, nu devine automat zero.
4. Creăm atribuiri istorice pentru etapele existente și fixăm costurile recuperabile sau, în lipsa lor, costurile actuale marcate ca migrare. Marcajele vechi Paid sunt păstrate ca solduri inițiale estimate distincte de plăți documentate; nu inventăm o dată istorică a plății. Rapoartele separă această componentă de plățile înregistrate ulterior.
5. Trecem simultan citirile financiare și toate scrierile relevante la noua sursă de adevăr. Migrarea folosește blocare/tranzacții sau o fereastră controlată astfel încât grilele și atribuirile să nu se schimbe în timpul stabilirii valorilor inițiale.
6. Activăm operațiile AI și permisiunile noi numai după verificările financiare și pe roluri. Reexecutarea migrării nu rescrie valori deja fixate și nu dublează plăți ori atribuiri.

Schema canonică și runnerul generat rămân sincronizate. Instrucțiunile de livrare trebuie să distingă actualizarea bazei de date, a aplicației și importul workflow-ului n8n. Acest document nu autorizează în sine o execuție în producție.

## Verificări de acceptare

- Comanda Denis → Kiki creează numai costurile așteptate și este atomică și idempotentă. Nu ajunge la validarea Nume_Pacient.
- O lucrare la 100 RON rămâne la 100 după schimbarea grilei la 150; o lucrare nouă primește 150. Interfața, AI-ul și rapoartele sunt de acord.
- Salvarea unui detaliu nefinanciar sau a unor poziții neschimbate nu reaplică tarifele curente.
- Un cost de 20 RON fixat la atribuire rămâne 20 după schimbarea grilei la 30. O atribuire nouă primește 30.
- O plată înregistrată rămâne identică după schimbarea grilei, cantității sau tehnicianului; corecțiile au urme separate. Repetarea cererii nu dublează plata.
- Reatribuirea păstrează plățile vechi și nu transferă tacit solduri; numele schimbat al unui tehnician nu pierde istoricul său.
- Migrarea păstrează pozițiile cu preț salvat, identifică valorile estimate și tarifele lipsă și este sigură la reexecutare.
- Tehnicianul poate edita stocul și evenimentele comune ale colegilor, dar nu calendarul personal al altuia, prețurile clienților sau costurile altui tehnician.
- Cererile din alt laborator, rolurile fără acces, payload-urile cu câmpuri nepermise și confirmările expirate sunt respinse pe server.
- Două ajustări concurente de stoc nu pierd actualizări; o scădere sub zero este respinsă fără efecte parțiale.
- Crearea și editarea obișnuită de lucrări pentru rolurile existente funcționează în continuare; fluxul per dinte este acoperit explicit.

Validarea necesită teste SQL de integrare pentru bani, permisiuni, tranzacții și migrare, teste ale parserului/rutării workflow-ului și verificări ale fluxurilor UI afectate. Verificările statice singure nu dovedesc corectitudinea financiară sau a politicilor RLS.
