import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');
const lab='00000000-0000-0000-0000-000000000001',partner='00000000-0000-0000-0000-000000000002';
async function setup(){
 const db=new PGlite();await db.exec(`
 SET check_function_bodies=off; CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${lab}'::uuid $$;
 CREATE FUNCTION effective_lab_role(uuid) RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
 CREATE FUNCTION is_lab_management(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${lab}'::uuid AND effective_lab_role($1) IN ('admin','manager') $$;
 CREATE FUNCTION current_legacy_user_id() RETURNS text LANGUAGE sql AS $$ SELECT 'admin' $$;
 CREATE TABLE lab_partners(id uuid PRIMARY KEY,lab_organization_id uuid,name text,active boolean);
 CREATE TABLE lab_partner_user_links(lab_organization_id uuid,user_id uuid,partner_id uuid REFERENCES lab_partners(id) ON DELETE RESTRICT);
 CREATE TABLE lab_work_orders(lab_organization_id uuid,id bigint,partner_id uuid REFERENCES lab_partners(id),nume_partener text,
 snapshot_list_price numeric,snapshot_final_price numeric,discount numeric DEFAULT 0,updated_by_user_id text,updated_at timestamptz,PRIMARY KEY(lab_organization_id,id));
 CREATE FUNCTION current_org_role(uuid) RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
 CREATE TABLE lab_work_order_price_lines(lab_organization_id uuid,work_order_id bigint,work_type text,billing_mode text,billing_scope text,quantity numeric,unit_price numeric,line_total numeric,price_source text,price_fixed_at timestamptz,price_migrated boolean,updated_by_user_id text,updated_at timestamptz);
 CREATE TABLE work_order_financial_audit(lab_organization_id uuid,work_order_id bigint,entity_type text,entity_id text,action text,before_value jsonb,after_value jsonb,changed_by_user_id uuid);
 ALTER TABLE lab_work_orders ADD COLUMN price_source text,ADD COLUMN price_fixed_at timestamptz,ADD COLUMN price_migrated boolean;
 SELECT set_config('test.role','admin',false);
 INSERT INTO lab_partners VALUES('${partner}','${lab}','Laborator vechi',true);
 INSERT INTO lab_partner_user_links VALUES('${lab}','${lab}','${partner}');
 INSERT INTO lab_work_orders VALUES('${lab}',7,'${partner}','Laborator vechi',200,180,10,NULL,NULL);`);
 const original=readFileSync('db/schema/20_functions/update_management_work_order_v188.sql','utf8');
 const signature=original.slice(original.indexOf('(')+1,original.indexOf(')\nRETURNS'));
 await db.exec(`CREATE FUNCTION update_management_work_order_v188(${signature}) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  UPDATE lab_work_orders SET snapshot_list_price=300,snapshot_final_price=270 WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
  RETURN true;
 END $$;`);
 const path='db/migrations/20261002_order_supplements_partner_delete.sql';
 if(existsSync(path))await db.exec(readFileSync(path,'utf8'));
 return db;
}
async function set(db,amount,reason='Transport'){return db.query('SELECT set_work_order_manual_supplement($1,7,$2,$3) AS value',[lab,amount,reason]);}
test('supplement is added after discount, replaced rather than compounded, audited and removable',async()=>{
 const db=await setup();try{
  await set(db,50);assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),230);
  await set(db,50);assert.equal((await db.query('SELECT * FROM work_order_financial_audit')).rows.length,1);
  await set(db,25,'Curier');assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),205);
  const audit=(await db.query("SELECT after_value FROM work_order_financial_audit WHERE after_value->>'reason'='Curier'")).rows[0].after_value;
  assert.equal(audit.reason,'Curier');assert.equal(Number(audit.amount),25);
  await set(db,0,'');assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),180);
 }finally{await db.close();}
});
test('pricing recalculation and discount changes preserve the manual supplement without compounding',async()=>{
 const db=await setup();try{
  await set(db,50);await db.exec('UPDATE lab_work_orders SET snapshot_list_price=300,snapshot_final_price=270');
  assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),320);
  await db.exec('UPDATE lab_work_orders SET snapshot_final_price=snapshot_final_price');
  assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),320);
  await db.exec('UPDATE lab_work_orders SET discount=20');
  assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),290);
  await db.exec('UPDATE lab_work_orders SET snapshot_list_price=NULL,snapshot_final_price=NULL');
  assert.equal((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price,null);
 }finally{await db.close();}
});
test('fee requires a reason and finite positive money; only active management in that lab can change it',async()=>{
 const db=await setup();try{
  for(const [amount,reason] of [[-1,'x'],['NaN','x'],['Infinity','x'],[1,' ']])await assert.rejects(set(db,amount,reason));
  for(const role of ['doctor','technician','lab partner','']){
   await db.query("SELECT set_config('test.role',$1,false)",[role]);await assert.rejects(set(db,50));
   await assert.rejects(db.exec("UPDATE lab_work_orders SET manual_supplement=50,manual_supplement_reason='forged'"));
  }
  await db.exec("SELECT set_config('test.role','manager',false)");await set(db,50);
  await assert.rejects(db.query("SELECT set_work_order_manual_supplement($1,7,50,'X')",[partner]));
 }finally{await db.close();}
});
test('deleting a partner removes mappings but retains the work order and historical name',async()=>{
 const db=await setup();try{
  await assert.rejects(db.query('SELECT delete_lab_partner($1,$2)',[partner,partner]));
  await db.exec("SELECT set_config('test.role','manager',false)");await assert.rejects(db.query('SELECT delete_lab_partner($1,$2)',[lab,partner]));
  await db.exec("SELECT set_config('test.role','admin',false)");await db.query('SELECT delete_lab_partner($1,$2)',[lab,partner]);
  assert.equal((await db.query('SELECT * FROM lab_partners')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM lab_partner_user_links')).rows.length,0);
  const order=(await db.query('SELECT * FROM lab_work_orders')).rows[0];assert.equal(order.id,7);assert.equal(order.partner_id,null);assert.equal(order.nume_partener,'Laborator vechi');
 }finally{await db.close();}
});


test('price override response and audit include the supplement exactly as stored',async()=>{
 const db=await setup();try{
  await db.exec(`INSERT INTO lab_work_order_price_lines(lab_organization_id,work_order_id,work_type,billing_mode,billing_scope,quantity,unit_price,line_total) VALUES('${lab}',7,'Coroana','per_tooth','tooth:16',1,200,200)`);
  await set(db,50);
  const result=(await db.query("SELECT set_work_order_price_snapshot($1,7,300,10,'Tarif nou') AS value",[lab])).rows[0].value;
  assert.equal(Number(result.final_price),320);
  const audit=(await db.query("SELECT after_value FROM work_order_financial_audit WHERE action='override'")).rows[0].after_value;
  assert.equal(Number(audit.final_price),320);
  assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),320);
 }finally{await db.close();}
});


test('unchanged supplement is preserved and a rejected fee rolls back the whole edit RPC',async()=>{
 const db=await setup();try{
  const source=readFileSync('db/schema/20_functions/update_management_work_order_v188.sql','utf8');
  const signature=source.slice(source.indexOf('(')+1,source.indexOf(')\nRETURNS'));
  const params=[...signature.matchAll(/^\s*(p_\w+)\s+([a-z]+)([^\n]*)/gm)].filter(match=>!match[3].includes('DEFAULT'));
  const args=params.map(([_,name])=>`${name}=>${name==='p_lab_organization_id'?'$1':name==='p_work_order_id'?'7':'NULL'}`).join(',');
  await set(db,50);
  await db.query(`SELECT update_management_work_order_with_supplement(${args})`,[lab]);
  assert.equal(Number((await db.query('SELECT snapshot_final_price FROM lab_work_orders')).rows[0].snapshot_final_price),320);
  await db.exec('UPDATE lab_work_orders SET snapshot_list_price=200,snapshot_final_price=180');
  await assert.rejects(db.query(`SELECT update_management_work_order_with_supplement(${args},p_manual_supplement=>25,p_manual_supplement_reason=>'')`,[lab]),/obligatorie/);
  const order=(await db.query('SELECT * FROM lab_work_orders')).rows[0];
  assert.equal(Number(order.snapshot_list_price),200);assert.equal(Number(order.manual_supplement),50);assert.equal(Number(order.snapshot_final_price),230);
 }finally{await db.close();}
});
