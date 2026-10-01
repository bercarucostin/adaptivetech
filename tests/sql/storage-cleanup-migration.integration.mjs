import assert from 'node:assert/strict';
import {fixture,source,lab} from '../storage-cleanup/sql-fixture.mjs';
const {db,user,rpc,order,sql}=await fixture();
try {
 await order(100,lab,'2026-10-01T09:00:00Z');
 await user(10);const job=await rpc('admin_cleanup_preview',['clinical','2026-10-01','2026-10-01']);
 await sql('SELECT 1');
 for(let i=0;i<2;i++)await db.exec(source('db/migrations/20261001_storage_cleanup.sql'));
 await user(10);assert.equal((await rpc('admin_cleanup_status',[job.id])).job.progress.total,1);
 const guards=await sql("SELECT tgrelid::regclass::text relation,count(*)::int n FROM pg_trigger WHERE tgname='cleanup_mutation_guard' GROUP BY 1");
 assert.equal(guards.rows.length,10);assert(guards.rows.every(r=>r.n===1));
 const access=await sql("SELECT has_function_privilege('anon','admin_cleanup_preview(text,date,date)','EXECUTE') anonymous,has_function_privilege('authenticated','admin_cleanup_claim(uuid,uuid)','EXECUTE') browser,has_function_privilege('authenticated','admin_cleanup_status(uuid,integer,integer)','EXECUTE') admin,has_function_privilege('service_role','admin_cleanup_claim(uuid,uuid)','EXECUTE') worker");
 assert.deepEqual(access.rows[0],{anonymous:false,browser:false,admin:true,worker:true});
 console.log('PASS: core migration twice preserves previews, guards and role grants');
} finally {await db.close();}
