// Isolated PostgreSQL check using PGlite; no production credentials needed.
// Install @electric-sql/pglite outside the repo, then pass its dist/index.js:
// node tests/sql/partner-catalog.integration.mjs /tmp/check/node_modules/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.argv[2] || '@electric-sql/pglite');
const db = new PGlite();
const lab = '00000000-0000-0000-0000-000000000001';
const otherLab = '00000000-0000-0000-0000-000000000002';
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const source = path => readFileSync(path,'utf8');

try {
  // Minimal dependencies: exercise the production catalog/migration/role code.
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TYPE public.membership_status AS ENUM ('active','inactive');
    CREATE TABLE organizations (id uuid PRIMARY KEY,name text,slug text,organization_type text,active boolean);
    CREATE TABLE profiles (id uuid PRIMARY KEY,username text,display_name text,technician_name text,active boolean);
    CREATE TABLE organization_memberships (organization_id uuid,user_id uuid,role text,status public.membership_status);
    CREATE FUNCTION public.is_connected_doctor_for_lab(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE lab_work_orders (id bigint PRIMARY KEY,lab_organization_id uuid,nume_partener text,note text);
    CREATE TABLE lab_patient_cases (lab_organization_id uuid,nume_partener text);
    CREATE TABLE legacy_user_directory (partner_name text);
    CREATE TABLE lab_work_types (id bigint,lab_organization_id uuid,tip_lucrare text,active boolean,billing_mode text);
    CREATE TABLE lab_contract_work_prices (id text,lab_organization_id uuid,contract text,tip_lucrare text,pret numeric);
    INSERT INTO organizations VALUES ('${lab}','Lab A','flowrise-dental-lab','lab',true),('${otherLab}','Lab B','other','lab',true);
    INSERT INTO lab_work_orders VALUES (1,'${lab}','Clinica Istorică','original'),(2,'${otherLab}','Altă Clinică','original'),(5,'${lab}','  Clinica Istorică  ','original');
    INSERT INTO lab_patient_cases VALUES ('${lab}','clinica istorică');
    INSERT INTO legacy_user_directory VALUES ('Clinica Cont');
  `);
  for (const [n,role,org] of [[10,'Admin',lab],[11,'Manager',lab],[12,'Technician',lab],[13,'Doctor',lab],[14,'Admin',otherLab]]) {
    await db.query('INSERT INTO profiles (id,active) VALUES ($1,true)',[uid(n)]);
    await db.query('INSERT INTO organization_memberships VALUES ($1,$2,$3,\'active\')',[org,uid(n),role]);
  }
  for (const name of ['has_org_role','effective_lab_role','get_flowrise_lab_id']) {
    await db.exec(source(`db/schema/20_functions/${name}.sql`));
  }
  const migration = source('db/migrations/20261001_partner_catalog.sql');
  await db.exec(migration);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lab_partners')).rows[0].n,3);
  const historical = (await db.query('SELECT name FROM lab_partners WHERE lower(name)=lower($1)',['Clinica Istorică'])).rows[0].name;
  await db.query('UPDATE lab_partners SET active=false WHERE name=$1',[historical]);
  await db.exec(migration);
  assert.equal((await db.query('SELECT active FROM lab_partners WHERE name=$1',[historical])).rows[0].active,false);
  console.log('PASS: migration deduplicates history, preserves inactivity, and can be rerun');

  async function user(n) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);
    await db.exec('SET ROLE authenticated');
  }
  await user(10);
  await db.query('INSERT INTO lab_partners (lab_organization_id,name) VALUES ($1,$2)',[lab,'Clinica Nouă']);
  await assert.rejects(db.query('INSERT INTO lab_partners (lab_organization_id,name) VALUES ($1,$2)',[lab,'clinica nouă']),/duplicate key/);
  await assert.rejects(db.query('INSERT INTO lab_partners (lab_organization_id,name) VALUES ($1,$2)',[otherLab,'Cross lab']),/row-level security/);
  await assert.rejects(db.query('DELETE FROM lab_partners WHERE name=$1',['Clinica Nouă']),/permission denied/);
  assert.equal((await db.query('SELECT name FROM lab_partners WHERE lab_organization_id=$1',[otherLab])).rows.length,0);
  console.log('PASS: Admin can add partners, cannot duplicate/delete them or access another lab');

  for (const n of [11,12,13]) {
    await user(n);
    await assert.rejects(db.query('INSERT INTO lab_partners (lab_organization_id,name) VALUES ($1,$2)',[lab,'Unauthorized']),/row-level security/);
    assert.equal((await db.query('UPDATE lab_partners SET active=false WHERE name=$1 RETURNING id',['Clinica Nouă'])).rows.length,0);
  }
  assert.equal((await db.query('SELECT * FROM lab_partners')).rows.length,0);
  console.log('PASS: Manager/Technician/Doctor cannot administer the catalog; Doctor cannot read other partner names');

  await user(11);
  const managerRef = (await db.query('SELECT get_work_order_reference_data($1) AS ref',[lab])).rows[0].ref;
  assert.equal(managerRef.partners.some(p=>p.name===historical),false);
  assert.equal(managerRef.partners.some(p=>p.name==='Clinica Nouă'),true);
  await user(10);
  assert.equal((await db.query('SELECT get_work_order_reference_data($1) AS ref',[lab])).rows[0].ref.partners.some(p=>p.name===historical&&!p.active),true);
  await user(13);
  assert.deepEqual((await db.query('SELECT get_work_order_reference_data($1) AS ref',[lab])).rows[0].ref.partners,[]);
  console.log('PASS: reference data exposes active choices and includes inactive rows only for Admin');

  await user(10);
  await db.exec('RESET ROLE'); // Simulate a security-definer work-order RPC with the caller JWT intact.
  await db.query('INSERT INTO lab_work_orders VALUES (3,$1,$2,\'new\')',[lab,'clinica nouă']);
  assert.equal((await db.query('SELECT nume_partener FROM lab_work_orders WHERE id=3')).rows[0].nume_partener,'Clinica Nouă');
  await assert.rejects(db.query('INSERT INTO lab_work_orders VALUES (4,$1,$2,\'new\')',[lab,'Arbitrary name']),/partener activ/);
  await assert.rejects(db.query('INSERT INTO lab_work_orders VALUES (4,$1,$2,\'new\')',[lab,historical]),/partener activ/);
  await assert.rejects(db.query('INSERT INTO lab_work_orders VALUES (4,$1,$2,\'new\')',[lab,'Altă Clinică']),/partener activ/);
  await db.query('UPDATE lab_work_orders SET nume_partener=nume_partener,note=\'edited\' WHERE id=1');
  assert.equal((await db.query('SELECT nume_partener FROM lab_work_orders WHERE id=1')).rows[0].nume_partener,'Clinica Istorică');
  // Existing management RPCs trim their input. This must not count as changing
  // a historical partner or block unrelated edits after catalog deactivation.
  await db.query('UPDATE lab_work_orders SET nume_partener=$1,note=\'edited\' WHERE id=5',['Clinica Istorică']);
  assert.equal((await db.query('SELECT nume_partener FROM lab_work_orders WHERE id=5')).rows[0].nume_partener,'  Clinica Istorică  ');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid(13)]);
  await db.query('INSERT INTO lab_work_orders VALUES (4,$1,$2,\'doctor\')',[lab,'Account partner']);
  console.log('PASS: work-order guard rejects arbitrary/inactive/foreign partners and preserves existing names and Doctor flow');
} finally {
  await db.close();
}
