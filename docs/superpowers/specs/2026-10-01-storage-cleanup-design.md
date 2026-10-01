# Monitorizarea spațiului și curățarea lucrărilor Flowrise

Un tab nou „Spațiu & curățare” în Configurări permite Adminului Flowrise să urmărească spațiul folosit în Supabase și să elimine datele lucrărilor pentru un interval de timp. Organizația Supabase conține doar proiectul Flowrise. Utilizatorul a aprobat două grafice și trei acțiuni separate, inclusiv eliminarea plăților și a istoricului financiar la ștergerea completă.

## Acces și interfață

Tabul este disponibil numai rolului Admin din laboratorul cu slug `flowrise-dental-lab`. Verificarea rolului se face și pe server pentru fiecare cerere; ascunderea tabului nu reprezintă autorizare.

În partea de sus sunt două grafice circulare, cu o alternativă textuală accesibilă. Fiecare afișează consumul, spațiul rămas și totalul în GB, procentele și momentul măsurării. Există un buton „Actualizează”. După curățare, valorile sunt solicitate din nou.

Sub grafice sunt datele „De la” și „Până la”, urmate de trei butoane: „Șterge fișiere”, „Șterge date clinice”, „Șterge toate detaliile despre lucrări”. Fiecare deschide o previzualizare proprie înainte de confirmare. Previzualizarea arată intervalul, tipul operației, numărul lucrărilor, numărul fișierelor și dimensiunea acestora, precum și numărul înregistrărilor afectate pe categorie. Sunt afișate identificatoarele lucrărilor într-o listă paginată.

Confirmarea execută numai selecția previzualizată. Închiderea previzualizării nu șterge nimic. Schimbarea intervalului sau acțiunii invalidează confirmarea anterioară. Ștergerea completă cere introducerea textului „ȘTERGE” și precizează că dispar și plățile tehnicienilor și istoricul financiar.

## Măsurarea spațiului

Graficul Fișiere însumează dimensiunile obiectelor existente în toate bucketurile Flowrise, citite din `storage.objects.metadata.size` cu aritmetică bigint. Nu însumează exclusiv `work_order_files`, deoarece autorizările de upload pot lăsa metadate pentru încărcări eșuate. Consumurile bucketurilor sunt afișate separat sub total.

Cota de referință inițială este 100 GB pentru Supabase Pro, configurată pe server și exprimată în GB zecimali. Textul este „Rămas din cota inclusă”, nu o promisiune de capacitate fizică maximă. Consumul curent diferă de media folosită la facturarea lunară. Dacă este depășită cota, procentul ocupat poate depăși 100%; spațiul rămas este zero și depășirea se afișează explicit. Limita de 1 GiB pentru un singur fișier rămâne o setare distinctă.

Graficul Bază de date folosește Management API `GET /v1/projects/{ref}/config/disk/util`, cu `fs_size_bytes`, `fs_avail_bytes`, `fs_used_bytes` și timestampul furnizat. Se raportează discul real al proiectului, care include și componentele sistemului, nu doar tabelele aplicației. Nu se calculează un procent de disc liber din `pg_database_size`.

Un token Management API cu permisiunea `infra_disk_config_read` se configurează ca secret al Edge Function. Tokenul nu ajunge în browser, repository sau loguri. Dacă lipsește sau API-ul nu răspunde, cardul bazei de date afișează starea indisponibilă și motivul util pentru Admin; monitorizarea fișierelor și curățarea rămân disponibile. Nicio eroare nu produce valori fictive de zero sau 100% disponibil.

## Alegerea intervalului

Decizie propusă pentru implementare: intervalul selectează lucrările după `coalesce(data_receptie, created_at)`, în fusul `Europe/Bucharest`. Prima și ultima zi sunt incluse printr-un interval de timestamp de la începutul primei zile până la începutul zilei următoare ultimei zile. Serverul validează ambele date și ordinea lor.

Sunt incluse lucrările active și arhivate din laboratorul Flowrise. Nu există filtrare implicită după status. Lucrările fără ambele timestampuri nu sunt selectate, iar previzualizarea indică numărul lor. Toate cele trei operații folosesc aceeași selecție de lucrări: fișierele se aleg prin lucrarea asociată, indiferent de data încărcării.

## Ce șterge fiecare acțiune

### Șterge fișiere

Elimină obiectele din bucketul `work-order-files` asociate lucrărilor selectate și metadatele corespunzătoare din `work_order_files`. Fișa clinică, lucrarea și înregistrările financiare se păstrează. Obiectele se șterg prin Storage API, niciodată prin DELETE direct în `storage.objects`.

Metadatele cu laborator NULL sunt atribuite Flowrise numai dacă obiectul are un traseu valid pentru lucrarea selectată și nu există ambiguitate cu alte laboratoare. Orice asociere ambiguă blochează lucrarea respectivă și apare în rezultate. Obiectele fără rând în `work_order_files` sunt incluse numai dacă traseul lor valid din bucket identifică neechivoc lucrarea Flowrise selectată. Alte bucketuri sunt măsurate, dar nu sunt curățate de această acțiune.

### Șterge date clinice

Elimină fișele asociate din `lab_patient_cases` și golește `lab_work_orders.nume_pacient`. Dispar astfel numele pacientului, nuanța, metoda, observațiile clinice și de producție, conexiunile și detaliile suplimentare ale fișei clinice. Fișierele se păstrează, inclusiv eventualele informații clinice din conținutul sau numele lor.

Pozițiile lucrării din `lab_work_order_items` se păstrează deoarece sunt folosite pentru obiectul lucrării și calculele financiare. Acțiunea nu reprezintă ștergerea tuturor informațiilor clinice din întregul sistem sau anonimizarea documentelor. Previzualizarea explică faptul că dinții și tipurile de lucrări din pozițiile comerciale se păstrează.

Un timestamp `clinical_cleared_at` pe lucrare indică eliminarea fișei. Interfața golește cache-ul clinic al lucrărilor afectate, afișează această stare și nu reconstruiește automat o fișă din pozițiile comerciale. O salvare clinică nouă și explicită poate crea o fișă nouă și resetează indicatorul în aceeași tranzacție. Cererile de salvare cu versiuni anterioare curățării sunt respinse, pentru a evita restaurarea accidentală dintr-un formular deschis.

Această operație nu elimină plăți, prețuri, costuri sau istoricul financiar. Copiile istorice din auditul financiar nu sunt modificate de această acțiune; pentru eliminarea integrală a detaliilor unei lucrări se folosește al treilea buton.

### Șterge toate detaliile despre lucrări

Elimină fișierele și metadatele, fișele clinice, pozițiile și liniile de preț, plățile și reversările aferente, ajustările și liniile de cost ale alocărilor, alocările tehnicienilor, istoricul din `work_order_financial_audit` și rândurile din `lab_work_orders`. Nu folosește operația existentă de arhivare. Tokenul QR dispare odată cu lucrarea, astfel încât linkul vechi nu o mai poate rezolva.

Ordinea ștergerii respectă cheile externe. O reversare legată de un payment din afara selecției blochează lucrarea, fără extinderea automată a selecției. Identificatoarele lucrărilor eliminate nu se reutilizează.

Catalogul partenerilor, utilizatorii, configurațiile prețurilor și costurilor și conversațiile independente se păstrează. Curățarea vizează datele operaționale Supabase ale lucrărilor; nu modifică backupurile externe, mesajele istorice independente sau logurile infrastructurii.

## Operații pe server și progres

O Edge Function dedicată gestionează măsurătorile și ștergerea obiectelor. Funcții SQL și tabele de operații gestionează selecția, verificarea accesului, starea și ștergerea relațională. Cheia service role rămâne pe server. Funcțiile interne de execuție nu sunt apelabile direct de rolurile browserului.

Previzualizarea creează o selecție persistentă legată de Admin, laborator, acțiune și interval. Expiră după 15 minute dacă nu este confirmată. Se salvează identificatoarele și versiunile lucrărilor, nu conținut clinic sau financiar. După confirmare, operația rulează în loturi și păstrează progresul; browserul afișează starea și poate relua o operație întreruptă. Nu se creează selecții noi la reluare.

O lucrare modificată între previzualizare și execuție este omisă cu motiv explicit și necesită o previzualizare nouă. În timpul procesării unei lucrări, operațiile de editare, upload, modificare financiară și ștergere concurente verifică blocarea de curățare. Verificarea este aplicată și în autorizarea fișierelor. Execuția revalidează pe server dreptul Adminului înainte de fiecare lot.

Ștergerea Storage și cea SQL nu formează o tranzacție comună. Pentru o ștergere completă, obiectele sunt eliminate întâi; ștergerea relațională urmează într-o tranzacție pentru lucrarea respectivă numai după succesul Storage. Erorile păstrează starea recuperabilă, cu rândurile necesare reluării. Obiectele deja absente sunt tratate idempotent. Rândurile pentru fișierele eliminate cu succes pot fi finalizate separat la operația numai fișiere.

URL-urile semnate înainte de blocare pot permite încărcări întârziate. Operația păstrează traseele afectate și efectuează o reconciliere după expirarea ferestrei maxime de valabilitate a acestor URL-uri, inclusiv pentru tokenurile emise înainte de deploy. O sarcină programată pe server finalizează reconcilierea chiar dacă browserul este închis. Până atunci, interfața indică „În așteptarea verificării încărcărilor”; ștergerea fișierelor nu este raportată definitiv finalizată. Doar traseele confirmate în operație sunt reverificate, fără a include fișiere noi din alte selecții.

Se păstrează un jurnal minimal al operației: Admin, interval, acțiune, momente, număr de lucrări și fișiere procesate, octeți eliminați și erori tehnice. Nu se copiază datele șterse în acest jurnal. Rezultatul distinge succesul complet, succesul parțial și eșecul; niciun lot eșuat nu este raportat ca șters.

## Validare și livrare

Testele SQL reale verifică Admin versus celelalte roluri, izolarea laboratorului, datele și schimbarea orei, lucrările arhivate, timestampurile lipsă, selecțiile expirate sau modificate, păstrarea finanțelor la curățarea clinică și ordinea ștergerii complete cu reversări și toate dependențele.

Testele Edge Function folosesc răspunsuri Storage și Management API controlate pentru măsurători, lipsa tokenului, obiecte absente, eșecuri parțiale, idempotentă, loturi și reluare. Testele frontend verifică cele două grafice, procente peste cotă, date indisponibile, cele trei previzualizări, confirmarea și invalidarea acesteia, progresul și cache-ul clinic după curățare.

Livrarea include o migrare idempotentă, actualizarea schemei canonice și a fișierelor SQL generate, Edge Function, frontend și instrucțiuni pentru secret și deploy. Validarea izolată folosește PGlite și teste locale fără ștergeri în producție. Nicio operație reală de curățare nu este executată ca parte a implementării sau verificării.

Ștergerea rândurilor PostgreSQL poate elibera spațiu reutilizabil fără reducerea imediată a dimensiunii fizice a discului. Interfața raportează măsurătorile disponibile și timestampul lor; nu scade artificial o estimare din graficul bazei de date.

## Surse Supabase

- [Storage size și cota inclusă în Pro](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)
- [Utilizarea discului și permisiunea Management API](https://supabase.com/docs/reference/api/v1-get-disk-utilization)
- [Diferența dintre dimensiunea datelor și discul bazei de date](https://supabase.com/docs/guides/platform/database-size)
