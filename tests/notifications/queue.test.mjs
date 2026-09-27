import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'/tmp/tooth-pglite/package/dist/index.js');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,active boolean DEFAULT true,technician_name text,legacy_partner_name text,display_name text,legacy_user_id text);
 CREATE TABLE public.organizations(id uuid PRIMARY KEY,organization_type text);
 CREATE TABLE public.organization_memberships(organization_id uuid,user_id uuid,role text,status text);
 CREATE TABLE public.organization_relationships(clinic_organization_id uuid,lab_organization_id uuid,status text);
 CREATE TABLE public.lab_work_orders(lab_organization_id uuid,id bigint,archived_at timestamptz,nume_partener text,status text,status_model text,status_modelare text,status_cer_fin text,tehnician_model text,tehnician1_modelare text,tehnician2_cer_fin text,model_not_applicable boolean DEFAULT false,modelare_not_applicable boolean DEFAULT false,cer_fin_not_applicable boolean DEFAULT false,PRIMARY KEY(lab_organization_id,id));
 INSERT INTO organizations VALUES('${id(1)}','lab'),('${id(2)}','clinic'),('${id(3)}','lab');
 INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'user'||n||'@example.test',now() FROM generate_series(10,16)n;
 INSERT INTO profiles(id,technician_name,legacy_partner_name) VALUES('${id(10)}',null,null),('${id(11)}','Alice',null),('${id(12)}','Bob',null),('${id(13)}',null,'Clinic'),('${id(14)}',null,'Other'),('${id(15)}',null,null),('${id(16)}',null,null);
 INSERT INTO organization_memberships VALUES('${id(1)}','${id(10)}','admin','active'),('${id(1)}','${id(11)}','technician','active'),('${id(1)}','${id(12)}','technician','active'),('${id(2)}','${id(13)}','doctor','active'),('${id(2)}','${id(14)}','doctor','active'),('${id(3)}','${id(15)}','admin','active'),('${id(1)}','${id(16)}','manager','active');
 INSERT INTO organization_relationships VALUES('${id(2)}','${id(1)}','active');`);
 const sql=fs.readFileSync('db/migrations/20260927_email_notifications.sql','utf8');
 await db.exec(sql);await db.exec(sql);
 return db;
}
const create=`INSERT INTO lab_work_orders(lab_organization_id,id,nume_partener,status,status_model,status_modelare,status_cer_fin,tehnician_model,tehnician1_modelare) VALUES('${id(1)}',1,'Clinic','Not Started','Not Started','Not Started','Not Started','Alice','Bob')`;
const claim=db=>db.query('SELECT * FROM claim_email_notifications(100)');
test('opt-in, role/tenant routing, stage-only changes and late assignment',async()=>{
 const db=await setup();
 await db.exec(create);assert.equal((await claim(db)).rows.length,0);
 await db.exec('UPDATE profiles SET notify_new_work_order=true,notify_stage_status=true; DELETE FROM lab_work_orders;');
 await db.exec(create);
 let rows=(await claim(db)).rows;
 assert.deepEqual(rows.map(r=>r.recipient_id).sort(),[10,11,12,13,16].map(id).sort());
 assert.ok(rows.every(r=>!JSON.stringify(r).includes('Clinic')),'email payload excludes clinical/partner information');
 await db.exec("UPDATE lab_work_orders SET status='Started'");assert.equal((await claim(db)).rows.length,0);
 await db.exec("UPDATE lab_work_orders SET status_model='Finished'");
 rows=(await claim(db)).rows;assert.deepEqual(rows.map(r=>r.recipient_id).sort(),[10,11,13,16].map(id).sort());
 assert.ok(rows.every(r=>r.old_status==='Not Started'&&r.new_status==='Finished'));
 await db.exec("UPDATE lab_work_orders SET status_model='Finished'");assert.equal((await claim(db)).rows.length,0);
 await db.exec("UPDATE lab_work_orders SET tehnician_model='Bob'");
 rows=(await claim(db)).rows;assert.deepEqual(rows.map(r=>r.recipient_id),[id(12)]);
 await db.close();
});
test('rechecks opt-out, assignment, active membership and ownership before sending',async()=>{
 const db=await setup();await db.exec('UPDATE profiles SET notify_new_work_order=true,notify_stage_status=true');await db.exec(create);
 await db.exec(`UPDATE profiles SET notify_new_work_order=false WHERE id='${id(10)}'; UPDATE profiles SET active=false WHERE id='${id(16)}'; UPDATE organization_memberships SET status='suspended' WHERE user_id='${id(12)}'; UPDATE lab_work_orders SET nume_partener='Other',tehnician_model=null;`);
 assert.equal((await claim(db)).rows.length,0);await db.close();
});
test('lease tokens, explicit failures, uncertain delivery and privilege boundaries',async()=>{
 const db=await setup();await db.exec(`UPDATE profiles SET notify_new_work_order=true WHERE id='${id(10)}'`);await db.exec(create);
 let row=(await claim(db)).rows[0];assert.equal((await claim(db)).rows.length,0);
 await assert.rejects(db.query("SELECT finish_email_notification($1,$2,'sent','gmail1')",[row.id,id(999)]),/lease/i);
 await db.query("SELECT finish_email_notification($1,$2,'retry',null)",[row.id,row.lease_token]);
 await db.exec("UPDATE email_notification_queue SET available_at=now()-interval '1 minute'");
 row=(await claim(db)).rows[0];await db.exec("UPDATE email_notification_queue SET leased_at=now()-interval '1 hour'");
 assert.equal((await claim(db)).rows.length,0);
 assert.equal((await db.query('SELECT state FROM email_notification_queue')).rows[0].state,'uncertain');
 await db.exec('SET ROLE authenticated');await assert.rejects(claim(db),/permission denied/);await assert.rejects(db.query('SELECT * FROM email_notification_queue'),/permission denied/);
 await db.exec(`SET test.uid='${id(11)}'`);
 await db.query('SELECT set_my_email_preferences(true,false)');
 assert.equal((await db.query('SELECT * FROM get_my_email_preferences()')).rows[0].notify_new_work_order,true);
 await db.exec('RESET ROLE');
 assert.equal((await db.query(`SELECT notify_new_work_order FROM profiles WHERE id='${id(12)}'`)).rows[0].notify_new_work_order,false);
 await db.close();
});
test('rollback, transaction coalescing, sent acknowledgement and retry ceiling',async()=>{
 const db=await setup();await db.exec(`UPDATE profiles SET notify_new_work_order=true,notify_stage_status=true WHERE id='${id(10)}'`);
 await db.exec('BEGIN;'+create+';ROLLBACK;');assert.equal((await claim(db)).rows.length,0);
 await db.exec(create);let row=(await claim(db)).rows[0];
 await db.query("SELECT finish_email_notification($1,$2,'sent','message-1')",[row.id,row.lease_token]);
 assert.equal((await db.query('SELECT state,provider_message_id FROM email_notification_queue')).rows[0].state,'sent');
 await db.exec("BEGIN; UPDATE lab_work_orders SET status_model='Started'; UPDATE lab_work_orders SET status_model='Finished'; COMMIT;");
 row=(await claim(db)).rows[0];assert.equal(row.old_status,'Not Started');assert.equal(row.new_status,'Finished');
 assert.equal((await db.query("SELECT count(*)::int n FROM email_notification_queue WHERE event_kind='stage_status'")).rows[0].n,1);
 for(let n=0;n<5;n++){
  await db.query("SELECT finish_email_notification($1,$2,'retry',null)",[row.id,row.lease_token]);
  await db.exec("UPDATE email_notification_queue SET available_at=now()-interval '1 minute'");
  const rows=(await claim(db)).rows;if(n<4){assert.equal(rows.length,1);row=rows[0];}else assert.equal(rows.length,0);
 }
 assert.equal((await db.query("SELECT state FROM email_notification_queue WHERE event_kind='stage_status'")).rows[0].state,'failed');
 await db.close();
});
