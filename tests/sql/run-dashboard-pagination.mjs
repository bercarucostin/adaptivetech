// Isolated PostgreSQL regression suite; never connects to a live database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite();
const lab='00000000-0000-0000-0000-000000000001';
await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '00000000-0000-0000-0000-000000000003'::uuid$$;
CREATE FUNCTION current_technician_name() RETURNS text LANGUAGE sql AS $$SELECT 'Alice'::text$$;
CREATE FUNCTION doctor_matches_partner(text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='Clinic'$$;
CREATE FUNCTION is_lab_management(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${lab}'::uuid AND current_setting('test.role')='management'$$;
CREATE FUNCTION is_lab_dashboard(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${lab}'::uuid AND current_setting('test.role')='dashboard'$$;
CREATE FUNCTION is_lab_technician(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${lab}'::uuid AND current_setting('test.role')='technician'$$;
CREATE FUNCTION is_connected_doctor_for_lab(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${lab}'::uuid AND current_setting('test.role')='doctor'$$;
CREATE TABLE lab_work_orders(lab_organization_id uuid,id bigint,deadline date,status text,nume_pacient text,nume_partener text,contract text,discount numeric,tehnician_model text,tehnician1_modelare text,tehnician2_cer_fin text,status_model text,status_modelare text,status_cer_fin text,created_by_user_id text,created_at timestamptz,updated_by_user_id text,updated_at timestamptz,data_receptie timestamptz,locked boolean default false,model_not_applicable boolean default false,modelare_not_applicable boolean default false,cer_fin_not_applicable boolean default false,snapshot_list_price numeric,snapshot_final_price numeric,archived_at timestamptz,cleanup_revision bigint DEFAULT 0,clinical_cleanup_generation bigint DEFAULT 0,clinical_cleared_at timestamptz);
CREATE TABLE lab_work_order_items(lab_organization_id uuid,work_order_id bigint,tooth_number integer,work_type text,quantity numeric);
CREATE TABLE lab_work_order_stage_assignments(id uuid default gen_random_uuid(),lab_organization_id uuid,work_order_id bigint,stage_key text,technician_user_id uuid,technician_name text,unit_cost numeric,agreed_amount numeric,started_at timestamptz default now(),ended_at timestamptz);
CREATE TABLE technician_payments(assignment_id uuid,amount numeric);
CREATE FUNCTION assignment_agreed_amount(uuid) RETURNS numeric LANGUAGE sql AS $$SELECT agreed_amount FROM lab_work_order_stage_assignments WHERE id=$1$$;
CREATE FUNCTION work_order_stage_payment_status(uuid,bigint,text) RETURNS text LANGUAGE sql AS $$SELECT 'Not Paid'::text$$;
SET test.role='management';
INSERT INTO lab_work_orders(lab_organization_id,id,deadline,status,nume_pacient,nume_partener,contract,discount,tehnician_model,tehnician1_modelare,created_at,updated_at,snapshot_list_price,snapshot_final_price)
SELECT '${lab}',n,current_date,'In Progress','Patient '||n,CASE WHEN n%2=0 THEN 'Clinic' ELSE 'Other' END,'Secret',10,'Alice','Bob',((now() at time zone 'Europe/Bucharest')::date-CASE WHEN n=1 THEN 100 ELSE 0 END)::timestamp AT TIME ZONE 'Europe/Bucharest',now(),100,90 FROM generate_series(1,205) n;
INSERT INTO lab_work_order_items SELECT '${lab}',id,11,'Crown',1 FROM lab_work_orders;
INSERT INTO lab_work_order_stage_assignments(lab_organization_id,work_order_id,stage_key,technician_name,agreed_amount,unit_cost) SELECT '${lab}',id,s,CASE WHEN s='model' THEN 'Alice' ELSE 'Bob' END,CASE WHEN s='model' THEN 10 ELSE 30 END,10 FROM lab_work_orders CROSS JOIN unnest(ARRAY['model','modelare']) s;`);
await db.exec(fs.readFileSync('db/schema/20_functions/work_order_item_scope.sql','utf8'));
if(fs.existsSync('db/schema/20_functions/get_work_orders_page.sql'))await db.exec(fs.readFileSync('db/schema/20_functions/get_work_orders_page.sql','utf8'));
const page=async(filters={},limit=100,offset=0,l=lab)=>(await db.query('SELECT get_work_orders_page($1,$2::jsonb,$3,$4) result',[l,JSON.stringify(filters),limit,offset])).rows[0].result;
const all={reception_from:null,reception_to:null};
let p=await page(); assert.equal(p.total,204); assert.equal(p.rows.length,100); assert.equal(p.summary.final_price,18360);assert.equal(p.summary.elements,204);
assert.equal((await page({},999)).rows.length,200);
assert.deepEqual((await page({},2,2)).rows.map(r=>r.id),[203,202]);
assert.equal((await page(all)).total,205);assert.equal((await page({...all,patient:'PATIENT 1'})).total,111);
assert.equal((await page({...all,columns:{id:'<= 2'}})).total,2);
assert.equal((await page({...all,work_type:'Missing'})).total,0);
assert.equal((await page({...all,status_in:['Started','Finished']})).total,0,'production status filter precedes pagination and totals');
p=await page({},100,999);assert.equal(p.total,204);assert.deepEqual(p.rows,[]);
assert.equal((await page({...all,maximum_id:2})).total,2);
assert.equal((await page({...all,sort_key:'id',sort_dir:'asc'},1)).rows[0].id,1);
for(const f of [{reception_from:'2026-02-30'},{deadline_from:'2026-02-03',deadline_to:'2026-02-01'},{sort_key:'DROP TABLE'},{columns:[]},{hide_old:'bad'}])await assert.rejects(page(f));
await assert.rejects(page({},100,-1));await assert.rejects(page({},100,0,'00000000-0000-0000-0000-000000000002'));
await db.exec("SET test.role='dashboard'");p=await page();assert.equal(p.rows[0].list_price,null);assert.equal(p.rows[0].cost_model,null);assert.equal(p.summary.final_price,null);assert.equal(p.rows[0].contract,null);
await db.exec("SET test.role='doctor'");p=await page(all);assert.equal(p.total,102);assert.equal(p.rows[0].tehnician_model,null);assert.equal(p.rows[0].final_price,90);assert.equal(p.summary.cost_model,null);
await assert.rejects(page({...all,technician:'Alice'}),/Access denied/,'doctor cannot infer hidden technician assignments by filtering');
await db.exec("SET test.role='technician'");p=await page();assert.equal(p.rows[0].cost_model,null);assert.equal(p.rows[0].salary_stages.length,1);assert.equal(p.rows[0].salary_stages[0].amount,10);assert.equal(p.summary.cost_model,2040);assert.equal(p.summary.cost_modelare,0);
assert.equal(p.rows[0].own_cost,10);
await db.exec(`INSERT INTO lab_work_order_stage_assignments(lab_organization_id,work_order_id,stage_key,technician_name,agreed_amount,unit_cost,ended_at) VALUES('${lab}',205,'model','Alice',7,7,now())`);
p=await page({},200);assert.equal(p.rows[0].own_cost,17);assert.equal(p.summary.technician_cost,2047);
assert.equal((await page({columns:{id:'>= 204'}},200)).summary.technician_cost,27);
const ownSubset=await page({columns:{id:'>= 204'}},200);
assert.equal(ownSubset.summary.technician_cost,ownSubset.rows.reduce((sum,r)=>sum+r.own_cost,0));
await db.exec("UPDATE lab_work_order_stage_assignments SET agreed_amount=NULL WHERE ended_at IS NOT NULL");
assert.equal((await page()).summary.technician_cost,null,'unknown historical salary preserves unknown total');
await db.exec("UPDATE lab_work_order_stage_assignments SET technician_name='Nobody' WHERE work_order_id=203 AND stage_key='model'");
assert.equal((await page({columns:{id:'=203'}})).rows[0].own_cost,0,'no own assignments yields zero salary');
assert.equal((await page({columns:{id:'=0'}})).summary.technician_cost,0,'empty authorized salary total is zero');
await db.exec("UPDATE lab_work_order_stage_assignments SET technician_name='Alice' WHERE work_order_id=203 AND stage_key='model'");

await db.exec("DELETE FROM lab_work_order_stage_assignments WHERE ended_at IS NOT NULL");

assert.equal((await page({columns:{ownCost:'>= 10'},sort_key:'ownCost',sort_dir:'asc'},1)).rows[0].own_cost,10);
assert.equal((await page({columns:{ownCost:'> 10'}})).total,0);
assert.equal((await page({columns:{stages:'Not Paid'}})).total,204);
await db.exec("SET test.role='management'");
assert.equal((await page({technician:'Alice',columns:{selectedCost:'= 10'},sort_key:'selectedCost'},1)).rows[0].selected_technician_cost,10);
await db.exec("SET test.role='none'");await assert.rejects(page());
await db.exec("SET test.role='management'");
// NULL financial snapshots remain unknown, including aggregates across pages.
await db.exec("UPDATE lab_work_order_stage_assignments SET agreed_amount=NULL WHERE work_order_id=205 AND stage_key='model'; UPDATE lab_work_orders SET snapshot_final_price=NULL WHERE id=205");
p=await page();assert.equal(p.summary.cost_model,null);assert.equal(p.summary.final_price,null);
// Calendar boundaries are Bucharest-local, including a DST transition day.
await db.exec(`INSERT INTO lab_work_orders(lab_organization_id,id,status,created_at,data_receptie,deadline) VALUES
 ('${lab}',300,'Finished','2026-03-28 21:59:59+00','2026-03-28 21:59:59+00','2026-03-28'),
 ('${lab}',301,'Finished','2026-03-28 22:00:00+00',NULL,'2026-03-29'),
 ('${lab}',302,'Finished','2026-03-29 20:59:59+00','2026-03-29 20:59:59+00','2026-03-29'),
 ('${lab}',303,'Finished','2026-03-29 21:00:00+00','2026-03-29 21:00:00+00','2026-03-30');`);
p=await page({reception_from:'2026-03-29',reception_to:'2026-03-29'});assert.deepEqual(p.rows.map(r=>r.id),[302,301]);
assert.equal((await page({reception_from:'2026-03-29',reception_to:'2026-03-29',hide_old:true})).total,0);
assert.equal((await page({...all,deadline_from:'2026-03-29',deadline_to:'2026-03-29'})).total,2);
assert.deepEqual((await page({...all,partner:'Clinic'})).facets.partners,['Clinic','Other']);
await db.exec("SET test.role='dashboard'");assert.equal((await page({...all,columns:{contract:'Secret'}})).total,0);
await assert.rejects(page({...all,columns:{unknown:'x'}}));
await db.exec("SET test.role='management'");
await db.exec(fs.readFileSync('db/migrations/20260927_dashboard_pagination.sql','utf8'));
await db.exec(fs.readFileSync('db/migrations/20260927_dashboard_pagination.sql','utf8'));
assert.equal((await page({},1)).rows.length,1);
// Filtered pagination matches the existing v188 payload byte-for-byte for legacy fields.
await db.exec(fs.readFileSync('db/schema/20_functions/get_my_work_orders.sql','utf8'));
await db.exec(fs.readFileSync('db/schema/20_functions/get_my_work_orders_v188.sql','utf8'));
for(const role of ['management','dashboard','doctor','technician']){
 await db.exec(`SET test.role='${role}'`);
 const legacy=(await db.query('SELECT to_jsonb(r) r FROM get_my_work_orders_v188($1) r',[lab])).rows.map(x=>x.r);
 const paged=(await page(all,200)).rows;
 for(const row of paged){
  const {salary_stages,selected_technician_cost,own_cost,...compatible}=row;
  assert.deepEqual(compatible,legacy.find(r=>r.id===row.id),`v188 parity ${role} ${row.id}`);
 }
}
await db.exec(`SET test.role='management'; INSERT INTO lab_work_orders SELECT '00000000-0000-0000-0000-000000000002',id,deadline,status,nume_pacient,nume_partener,contract,discount,tehnician_model,tehnician1_modelare,tehnician2_cer_fin,status_model,status_modelare,status_cer_fin,created_by_user_id,created_at,updated_by_user_id,updated_at,data_receptie,locked,model_not_applicable,modelare_not_applicable,cer_fin_not_applicable,snapshot_list_price,snapshot_final_price,archived_at FROM lab_work_orders WHERE id=205`);
assert.equal((await page()).total,204,'same order ID in another tenant cannot join');
await db.exec("UPDATE lab_work_orders SET tehnician_model='Carol' WHERE id=204; SET test.role='technician'");
assert.equal((await page()).total,203,'technician sees currently assigned work orders only');
await db.exec("SET test.role='management'; ALTER FUNCTION work_order_item_scope(uuid,bigint,boolean) RENAME TO original_item_scope");
await db.exec(`CREATE FUNCTION work_order_item_scope(uuid,bigint,boolean) RETURNS TABLE(items jsonb,work_types text[],work_type_summary text,element_count numeric) LANGUAGE plpgsql AS $$BEGIN IF $2<>205 THEN RAISE EXCEPTION 'Off-page detail expansion'; END IF; RETURN QUERY SELECT * FROM original_item_scope($1,$2,$3); END$$`);
assert.equal((await page({},1)).rows[0].id,205,'full tooth JSON expanded only for page');

// QR migration and authorization run against the real pagination masks above.
await db.exec("CREATE ROLE anon; DROP FUNCTION work_order_item_scope(uuid,bigint,boolean); ALTER FUNCTION original_item_scope(uuid,bigint,boolean) RENAME TO work_order_item_scope");
await db.exec(fs.readFileSync('db/schema/20_functions/can_access_work_order.sql','utf8'));
const qrMigration=fs.readFileSync('db/migrations/20260929_work_order_qr.sql','utf8');
await db.exec(qrMigration);
const tokenFor=async id=>(await db.query('SELECT get_work_order_qr_token($1,$2) token',[lab,id])).rows[0].token;
const resolve=async(token,l=lab)=>(await db.query('SELECT resolve_work_order_qr($1,$2) row',[l,token])).rows[0].row;
await db.exec("SET test.role='management'");
const oldToken=await tokenFor(1),otherToken=await tokenFor(204),clinicToken=await tokenFor(2);
await db.exec(qrMigration);
assert.equal(await tokenFor(1),oldToken,'rerunning migration preserves printed codes');
assert.equal((await resolve(oldToken)).id,1,'old work outside 90 days opens');
assert.equal((await page({...all,work_order_id:1})).rows.length,1,'exact id is bounded');
assert.equal((await page({...all,work_order_id:1})).total,1);
await assert.rejects(page({work_order_id:-1}));
await db.exec("UPDATE lab_work_orders SET status='Finished' WHERE id=1");
assert.equal((await resolve(oldToken)).status,'Finished','code follows live work');
assert.equal(await resolve(oldToken,'00000000-0000-0000-0000-000000000002'),null,'cross-lab code rejected');
await db.exec("SET test.role='technician'");
assert.equal(await resolve(otherToken),null,'unassigned technician cannot resolve QR');
await assert.rejects(tokenFor(204));
assert.equal((await resolve(oldToken)).final_price,null,'QR cannot expose commercial prices');
await db.exec("SET test.role='doctor'");
assert.equal(await resolve(oldToken),null,'doctor cannot resolve another clinic');
assert.equal((await resolve(clinicToken)).tehnician_model,null,'doctor keeps staff data mask');
await db.exec("SET test.role='dashboard'");
assert.equal((await resolve(clinicToken)).final_price,null,'dashboard keeps finance mask');
await db.exec("SET test.role='disabled'");
assert.equal(await resolve(oldToken),null,'inactive or unrecognized role rejected');
await db.exec("SET test.role='management'; UPDATE lab_work_orders SET archived_at=now() WHERE id=1");
assert.equal(await resolve(oldToken),null,'archived work unavailable');
assert.equal(await resolve('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),null,'missing and denied return identical result');
await db.exec("SET ROLE anon");
await assert.rejects(resolve(clinicToken),/permission denied/);
await assert.rejects(tokenFor(2),/permission denied/);
await db.exec("RESET ROLE; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$");
await assert.rejects(resolve(clinicToken),/Authentication required/);
await db.close();console.log('PASS dashboard pagination, aggregates, filtering, role and tenant isolation');
