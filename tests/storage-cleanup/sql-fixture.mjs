import {readFileSync} from 'node:fs';
export const lab='00000000-0000-0000-0000-000000000001', otherLab='00000000-0000-0000-0000-000000000002';
export const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const source=p=>readFileSync(p,'utf8');
export async function fixture(){
 const {PGlite}=await import(process.argv[2]||'@electric-sql/pglite'); const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
 GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
 CREATE FUNCTION public.is_connected_doctor_for_lab(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
 CREATE TYPE membership_status AS ENUM ('active','inactive');
 CREATE TABLE organizations(id uuid PRIMARY KEY,slug text,organization_type text,active boolean);
 CREATE TABLE profiles(id uuid PRIMARY KEY,active boolean);
 CREATE TABLE organization_memberships(organization_id uuid,user_id uuid,role text,status membership_status);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb,PRIMARY KEY(bucket_id,name));
 INSERT INTO organizations VALUES ('${lab}','flowrise-dental-lab','lab',true),('${otherLab}','other','lab',true);
 `);
 for(const [n,role,org,active] of [[10,'Admin',lab,true],[11,'Manager',lab,true],[12,'Technician',lab,true],[13,'Doctor',lab,true],[14,'Dashboard',lab,true],[15,'Admin',otherLab,true],[16,'Admin',lab,false],[17,'Admin',lab,true]]){
  await db.query('INSERT INTO profiles VALUES ($1,$2)',[uid(n),active]);
  await db.query("INSERT INTO organization_memberships VALUES ($1,$2,$3,'active')",[org,uid(n),role]);
 }
 for(const f of ['15_lab_work_orders','11_lab_patient_cases','23_work_order_files','24_work_order_items','24a_work_order_price_lines','25_work_order_stage_assignments','26_technician_payments','27_work_order_financial_audit'])await db.exec(source(`db/schema/10_tables/${f}.sql`));
 for(const f of ['get_flowrise_lab_id','has_org_role','next_lab_work_order_id'])await db.exec(source(`db/schema/20_functions/${f}.sql`));
 const cleanup=async()=>{for(const p of ['10_tables/32_admin_cleanup','20_functions/admin_cleanup','30_policies/33_admin_cleanup'])await db.exec(source(`db/schema/${p}.sql`));};
 await cleanup();
 const user=async(n,service=false)=>{await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[n?uid(n):'',service?'service_role':'authenticated']); await db.exec(`SET ROLE ${service?'service_role':'authenticated'}`);};
 const sql=async(q,params=[])=>{await db.exec('RESET ROLE');return db.query(q,params);};
 const rpc=async(name,args=[])=> (await db.query(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
 const order=async(id,org=lab,time='2026-10-01T09:00:00Z',extra='')=>sql(`INSERT INTO lab_work_orders(lab_organization_id,id,status,nume_pacient,created_at${extra?','+extra:''}) VALUES ($1,$2,'Not Started','Patient',$3${extra?',now()':''})`,[org,id,time]);
 return {db,user,sql,rpc,order,cleanup};
}
