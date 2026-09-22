// Disposable PostgreSQL (PGlite) harness. Never connects to a live database.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node tests/sql/run-tooth-connections.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite();
// Only dependencies of the real clinical writer are stubbed. Financial/role RPCs
// have their own Supabase integration suite; this harness tests persistence itself.
await db.exec(`CREATE ROLE authenticated;
CREATE TABLE lab_work_orders(lab_organization_id uuid,id bigint,nume_pacient text,nume_partener text,deadline date);
CREATE TABLE lab_work_order_items(lab_organization_id uuid,work_order_id bigint,tooth_number integer,work_type text);
CREATE TABLE lab_patient_cases(lab_organization_id uuid,id bigint,work_order_id bigint,nume_pacient text,nume_partener text,
 deadline date,selected_teeth text,tooth_details_json text,shade text,method text,clinic_note text,production_notes text,
 created_by_user_id text,created_at timestamptz,updated_by_user_id text,updated_at timestamptz,PRIMARY KEY(lab_organization_id,id));
CREATE FUNCTION is_lab_management(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION current_legacy_user_id() RETURNS text LANGUAGE sql AS $$SELECT 'test'::text$$;
INSERT INTO lab_work_orders VALUES('00000000-0000-0000-0000-000000000001',1,'Test','Test',current_date);
INSERT INTO lab_work_order_items SELECT '00000000-0000-0000-0000-000000000001',1,t,'Crown' FROM unnest(ARRAY[11,21,46,45,44]) t;`);
await db.exec(fs.readFileSync('db/schema/20_functions/sanitize_tooth_details.sql','utf8'));
await db.exec(fs.readFileSync('db/schema/20_functions/save_work_order_clinical_case.sql','utf8'));
const save=async data=>db.query('SELECT save_work_order_clinical_case($1,1,$2::jsonb)', ['00000000-0000-0000-0000-000000000001',JSON.stringify(data)]);
const read=async()=>JSON.parse((await db.query('SELECT tooth_details_json FROM lab_patient_cases')).rows[0].tooth_details_json);
await save({tooth_details:{46:{shade:'A2'},__case:{custom:'keep',tooth_connections:[[45,46],[45,44],[21,11],[11,21]]}}});
assert.deepEqual((await read()).__case.tooth_connections,[[11,21],[46,45],[45,44]],'canonical direction/order and deduplication');
for(const value of [null,{},[[18,48]],[[46,44]],[[11,11]],[[11,21,22]],[["11",21]],[[11.1,21]],[[21,22]]]){
 await assert.rejects(save({tooth_details:{__case:{tooth_connections:value}}}),undefined,JSON.stringify(value));
}
await save({tooth_details:{46:{shade:'A3'}}});
assert.deepEqual((await read()).__case.tooth_connections,[[11,21],[46,45],[45,44]],'old clients omitting connections must preserve them');
assert.equal((await read()).__case.custom,'keep');
await save({tooth_details:{__case:{tooth_connections:[[46,45]]}}});
assert.equal((await read())['46'].shade,'A3','connection-only AI edit must preserve tooth shades');
await db.exec('DELETE FROM lab_work_order_items WHERE tooth_number=45');
await save({clinic_note:'scope shrank'});
assert.deepEqual((await read()).__case.tooth_connections,[],'scope removal prunes stale connections');
assert.equal((await read())['45'],undefined);
await save({tooth_details:{__case:{tooth_connections:[[11,21]]}}});
await save({tooth_details:{__case:{tooth_connections:[]}}});
assert.deepEqual((await read()).__case.tooth_connections,[],'empty array explicitly clears connections');
assert.equal((await read()).__case.custom,'keep');
await db.exec(fs.readFileSync('db/migrations/20260922_tooth_connections.sql','utf8'));
await db.exec(fs.readFileSync('db/migrations/20260922_tooth_connections.sql','utf8'));
assert.equal((await read())['46'].shade,'A3','repeatable deployment preserves clinical data');
await db.close();
console.log('PASS: clinical connection validation, normalization, preservation, clearing and scope pruning');
