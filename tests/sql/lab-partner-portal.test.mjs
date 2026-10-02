import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const { PGlite }=await import(process.env.PGLITE_MODULE_PATH||'/tmp/tooth-pglite/package/dist/index.js');
const lab='00000000-0000-0000-0000-000000000001',otherLab='00000000-0000-0000-0000-000000000002';
const partner='00000000-0000-0000-0000-000000000011',admin='00000000-0000-0000-0000-000000000012',manager='00000000-0000-0000-0000-000000000013',tech='00000000-0000-0000-0000-000000000014',doctor='00000000-0000-0000-0000-000000000015',foreignAdmin='00000000-0000-0000-0000-000000000016';
const migrationPath=process.env.PORTAL_MIGRATION_PATH||'db/migrations/20261002_lab_partner_portal.sql';

async function setup(){
  const db=new PGlite();
  await db.exec(`CREATE ROLE authenticated;CREATE SCHEMA auth;
    CREATE SCHEMA storage;CREATE TABLE storage.objects(bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(true);
    GRANT USAGE ON SCHEMA storage TO authenticated;GRANT INSERT ON storage.objects TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,active boolean DEFAULT true,username text,display_name text,legacy_user_id text);
    CREATE TABLE organizations(id uuid PRIMARY KEY,organization_type text,name text);
    CREATE TABLE organization_memberships(user_id uuid,organization_id uuid,role text,status text);
    CREATE TABLE organization_relationships(clinic_organization_id uuid,lab_organization_id uuid,status text);
    CREATE TABLE lab_partners(id uuid PRIMARY KEY,lab_organization_id uuid,active boolean,name text);
    CREATE TABLE lab_partner_user_links(lab_organization_id uuid,user_id uuid,partner_id uuid);
    CREATE TABLE role_permissions(role text,can_view_production boolean,can_view_client_pricing boolean);
    CREATE TABLE lab_work_orders(lab_organization_id uuid,id bigint,partner_id uuid,order_origin text,locked boolean DEFAULT false,status text DEFAULT 'Not Started',
      status_model text DEFAULT 'Not Started',status_modelare text DEFAULT 'Not Started',status_cer_fin text DEFAULT 'Not Started',
      tehnician_model text,tehnician1_modelare text,tehnician2_cer_fin text,archived_at timestamptz,
      approval_state text,approval_reason text,approval_reviewed_at timestamptz,approval_reviewed_by_user_id uuid,
      snapshot_list_price numeric,snapshot_final_price numeric,price_fixed_at timestamptz,updated_by_user_id text,updated_at timestamptz,
      deadline date,deadline_at timestamptz,nume_partener text,created_at timestamptz DEFAULT now());
    CREATE TABLE lab_partner_work_order_items(lab_organization_id uuid,work_order_id bigint,line_no integer,note text);
    CREATE TABLE lab_partner_work_order_price_lines(lab_organization_id uuid,work_order_id bigint,line_no integer);
    CREATE TABLE lab_work_order_approval_events(lab_organization_id uuid,work_order_id bigint,state text,actor_user_id uuid,reason text);
    CREATE TABLE chat_threads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_type text,direct_key text UNIQUE,title text,created_by uuid,created_at timestamptz,last_message_at timestamptz);
    CREATE TABLE chat_thread_participants(thread_id uuid,user_id uuid,joined_at timestamptz,last_read_at timestamptz,PRIMARY KEY(thread_id,user_id));
    CREATE TABLE chat_messages(id bigint GENERATED ALWAYS AS IDENTITY,thread_id uuid,sender_id uuid,body text,created_at timestamptz);
    CREATE TABLE chat_attachments(message_id bigint,thread_id uuid,uploaded_by uuid,storage_path text,file_name text,mime_type text,size_bytes bigint,created_at timestamptz);
    CREATE FUNCTION is_connected_doctor_for_lab(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION current_legacy_user_id() RETURNS text LANGUAGE sql AS $$ SELECT auth.uid()::text $$;
    CREATE FUNCTION lab_partner_quote(uuid,jsonb,timestamptz) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"final_price":120}'::jsonb $$;
    CREATE FUNCTION save_lab_partner_lines(uuid,bigint,jsonb,text) RETURNS void LANGUAGE sql AS $$ UPDATE lab_partner_work_order_items SET note=$4 WHERE lab_organization_id=$1 AND work_order_id=$2 $$;
    INSERT INTO organizations VALUES('${lab}','lab','Flowrise'),('${otherLab}','lab','Other');
    INSERT INTO lab_partners VALUES('${lab}','${lab}',true,'Partner');
    INSERT INTO lab_partner_user_links VALUES('${lab}','${partner}','${lab}');
    INSERT INTO role_permissions VALUES('Lab Partner',false,true);`);
  for(const [id,role,org] of [[partner,'Lab Partner',lab],[admin,'Admin',lab],[manager,'Manager',lab],[tech,'Technician',lab],[doctor,'Doctor',lab],[foreignAdmin,'Admin',otherLab]]){
    await db.query('INSERT INTO profiles(id,username,display_name) VALUES($1,$2,$2)',[id,role]);
    await db.query("INSERT INTO organization_memberships VALUES($1,$2,$3,'active')",[id,org,role]);
  }
  for(const name of ['effective_lab_role','is_lab_management']){
    await db.exec(readFileSync(`db/schema/20_functions/${name}.sql`,'utf8').replaceAll('::public.membership_status',''));
  }
  const base=readFileSync('db/migrations/20261001_lab_partner_orders.sql','utf8');
  for(const name of ['lab_partner_identity','lab_partner_can_access_order','resubmit_lab_partner_work_order','guard_external_order_production','list_lab_partner_work_orders','get_lab_partner_work_order']){
    const start=base.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`),end=base.indexOf('END $$;',start);
    await db.exec(base.slice(start,end>=0&&end<base.indexOf('CREATE OR REPLACE FUNCTION',start+1)?end+7:base.indexOf('$$;',start)+3));
  }
  for(const name of ['chat_can_message_as','chat_users_can_share_thread','chat_can_message','chat_is_thread_participant','chat_open_direct_thread','chat_create_group','chat_search_users','chat_send_message'])await db.exec(readFileSync(`db/schema/20_functions/${name}.sql`,'utf8'));
  if(existsSync(migrationPath))await db.exec(readFileSync(migrationPath,'utf8'));
  await db.exec(`CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON lab_work_orders FOR EACH ROW EXECUTE FUNCTION guard_external_order_production();
    INSERT INTO lab_work_orders(lab_organization_id,id,partner_id,order_origin,approval_state,deadline,deadline_at) VALUES('${lab}',7,'${lab}','lab_partner','approved','2030-10-05','2030-10-05T12:00Z');
    INSERT INTO lab_partner_work_order_items VALUES('${lab}',7,1,'old');
    SELECT set_config('test.uid','${partner}',false);`);
  return db;
}

test('editing an approved unstarted order resets approval and persists the submission',async()=>{
  const db=await setup();try{
    await db.query('SELECT resubmit_lab_partner_work_order($1,7,$2,$3,$4)',[lab,'2030-10-06T12:00Z','[]','new note']);
    const row=(await db.query('SELECT approval_state,snapshot_final_price FROM lab_work_orders WHERE id=7')).rows[0];
    assert.equal(row.approval_state,'pending');assert.equal(Number(row.snapshot_final_price),120);
    assert.equal((await db.query('SELECT note FROM lab_partner_work_order_items')).rows[0].note,'new note');
  }finally{await db.close();}
});
test('locked, started, archived and other-partner orders cannot be edited',async()=>{
  const db=await setup();try{
    for(const change of ["locked=true","status='Started'","status_model='Started'","archived_at=now()","partner_id=NULL"]){
      await db.exec(`UPDATE lab_work_orders SET approval_state='approved',locked=false,status='Not Started',status_model='Not Started',archived_at=NULL,partner_id='${lab}';UPDATE lab_work_orders SET ${change};`);
      await assert.rejects(db.query('SELECT resubmit_lab_partner_work_order($1,7,$2,$3)',[lab,'2030-10-06T12:00Z','[]']),/cannot be (edited|resubmitted)/);
    }
  }finally{await db.close();}
});
test('partner list and detail expose lock and edit permissions',async()=>{
  const db=await setup();try{
    await db.exec('UPDATE lab_work_orders SET locked=true');
    const list=(await db.query('SELECT list_lab_partner_work_orders($1) AS value',[lab])).rows[0].value;
    const detail=(await db.query('SELECT get_lab_partner_work_order($1,7) AS value',[lab])).rows[0].value;
    assert.equal(list[0].locked,true);assert.equal(detail.locked,true);
    assert.equal(list[0].can_edit,false);assert.equal(detail.can_edit,false);
  }finally{await db.close();}
});
test('partner can start chats only with active management of its own laboratory',async()=>{
  const db=await setup();try{
    for(const user of [admin,manager])assert.ok((await db.query('SELECT chat_open_direct_thread($1) AS id',[user])).rows[0].id);
    for(const user of [tech,doctor,foreignAdmin])await assert.rejects(db.query('SELECT chat_open_direct_thread($1)',[user]),/not allowed/);
    await db.query("UPDATE organization_memberships SET status='inactive' WHERE user_id=$1",[admin]);
    await assert.rejects(db.query('SELECT chat_open_direct_thread($1)',[admin]),/not allowed/);
    const users=(await db.query("SELECT user_id FROM chat_search_users('')")).rows;
    assert.deepEqual(users.map(row=>row.user_id),[manager]);
  }finally{await db.close();}
});
test('partner group creation admits management and rejects technicians',async()=>{
  const db=await setup();try{
    assert.ok((await db.query('SELECT chat_create_group($1,$2) AS id',['Management',[admin,manager]])).rows[0].id);
    await assert.rejects(db.query('SELECT chat_create_group($1,$2)',['Invalid',[admin,tech]]),/cannot all share/);
  }finally{await db.close();}
});
test('expired membership, inactive profile and deleted membership deny edits and reads',async()=>{
  const db=await setup();try{
    for(const change of ["UPDATE organization_memberships SET status='inactive'",'UPDATE profiles SET active=false','DELETE FROM organization_memberships']){
      await db.exec(`BEGIN;${change} WHERE ${change.includes('profiles')?'id':'user_id'}='${partner}';`);
      await db.exec('SAVEPOINT access_check');
      await assert.rejects(db.query('SELECT resubmit_lab_partner_work_order($1,7,$2,$3)',[lab,'2030-10-06T12:00Z','[]']),/cannot be edited/);
      await db.exec('ROLLBACK TO SAVEPOINT access_check');
      await assert.rejects(db.query('SELECT list_lab_partner_work_orders($1)',[lab]),/access denied/);
      await db.exec('ROLLBACK TO SAVEPOINT access_check');
      await assert.rejects(db.query('SELECT get_lab_partner_work_order($1,7)',[lab]),/access denied/);
      await db.exec('ROLLBACK');
    }
  }finally{await db.close();}
});
test('existing chat cannot send once its management recipient loses the allowed role',async()=>{
  const db=await setup();try{
    const thread=(await db.query('SELECT chat_open_direct_thread($1) AS id',[admin])).rows[0].id;
    assert.ok((await db.query('SELECT chat_send_message($1,$2) AS id',[thread,'Allowed message'])).rows[0].id);
    await db.query("UPDATE organization_memberships SET role='Technician' WHERE user_id=$1",[admin]);
    await assert.rejects(db.query('SELECT chat_send_message($1,$2)',[thread,'Forbidden message']),/communication rules|access denied/);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM chat_messages')).rows[0].count,1);
  }finally{await db.close();}
});
test('a stale management review cannot approve an unseen partner resubmission',async()=>{
  const db=await setup();try{
    await db.query('SELECT resubmit_lab_partner_work_order($1,7,$2,$3)',[lab,'2030-10-06T12:00Z','[]']);
    const before=(await db.query('SELECT get_lab_partner_work_order($1,7) AS value',[lab])).rows[0].value;
    assert.equal(before.submission_revision,2);
    await db.query('SELECT resubmit_lab_partner_work_order($1,7,$2,$3)',[lab,'2030-10-07T12:00Z','[]']);
    await db.query("SELECT set_config('test.uid',$1,false)",[admin]);
    await assert.rejects(db.query('SELECT review_external_work_order($1,7,$2,$3,$4)',[lab,'approve',null,before.submission_revision]),/changed|refresh/i);
    assert.equal((await db.query('SELECT approval_state FROM lab_work_orders')).rows[0].approval_state,'pending');
    await db.query('SELECT review_external_work_order($1,7,$2,$3,$4)',[lab,'approve',null,3]);
    assert.equal((await db.query('SELECT approval_state FROM lab_work_orders')).rows[0].approval_state,'approved');
  }finally{await db.close();}
});
test('chat attachments enforce current recipient roles in Storage policies',async()=>{
  const db=await setup();try{
    const thread=(await db.query('SELECT chat_open_direct_thread($1) AS id',[admin])).rows[0].id;
    await db.exec('SET ROLE authenticated');
    await db.query('INSERT INTO storage.objects VALUES($1,$2)',['chat-files',`${thread}/${partner}/scan.stl`]);
    await db.exec('RESET ROLE');
    await db.query("UPDATE organization_memberships SET role='Technician' WHERE user_id=$1",[admin]);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query('INSERT INTO storage.objects VALUES($1,$2)',['chat-files',`${thread}/${partner}/blocked.stl`]),/row-level security/);
    await db.query('INSERT INTO storage.objects VALUES($1,$2)',['unrelated-bucket','ordinary-file.pdf']);
    await db.exec('RESET ROLE');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='chat-files'")).rows[0].count,1);
  }finally{await db.close();}
});
test('reapproval preserves previous assignments, blocks production, and permits management locking',async()=>{
  const db=await setup();try{
    await db.exec("UPDATE lab_work_orders SET tehnician_model='Ana'");
    await db.query('SELECT resubmit_lab_partner_work_order($1,7,$2,$3)',[lab,'2030-10-06T12:00Z','[]']);
    assert.equal((await db.query('SELECT tehnician_model FROM lab_work_orders')).rows[0].tehnician_model,'Ana');
    await assert.rejects(db.exec("UPDATE lab_work_orders SET status='Started'"),/must be approved/);
    await assert.rejects(db.exec("UPDATE lab_work_orders SET tehnician1_modelare='Dan'"),/must be approved/);
    await db.exec('UPDATE lab_work_orders SET locked=true');
    assert.equal((await db.query('SELECT lab_partner_order_is_editable($1,7) AS value',[lab])).rows[0].value,false);
  }finally{await db.close();}
});
