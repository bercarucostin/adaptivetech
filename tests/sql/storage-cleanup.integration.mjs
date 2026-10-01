import assert from 'node:assert/strict';
import {fixture,lab,otherLab,uid} from '../storage-cleanup/sql-fixture.mjs';
const f=await fixture(); const {db,user,sql,rpc,order,cleanup}=f;
try{
 await order(1);await order(2,lab,'2026-09-30T21:00:00Z');await order(3,lab,'2026-10-01T20:59:59Z');await order(4,lab,'2026-10-01T21:00:00Z');await order(5,lab,null);await order(1,otherLab);
 await sql("UPDATE lab_work_orders SET archived_at=now() WHERE id=3");
 const path=`work-orders/1/${uid(100)}_scan.zip`;
 await sql("INSERT INTO work_order_files(legacy_work_order_id,lab_organization_id,object_path,original_file_name,file_size_bytes) VALUES (1,$1,$2,'scan.zip',5000000000)",[lab,path]);
 await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('work-order-files',$1,'{\"size\":5000000000}'),('other','misc','{\"size\":1000000000}'),('other','invalid','{\"size\":\"bad\"}')",[path]);
 for(const n of [11,12,13,14,15,16]){await user(n);await assert.rejects(rpc('admin_cleanup_preview',['files','2026-10-01','2026-10-01']),/Access denied/);}
 await user(10);
 const usage=await rpc('admin_storage_usage');assert.equal(usage.used_bytes,'6000000000');assert.equal(usage.unknown_size_count,1);
 const p=await rpc('admin_cleanup_preview',['files','2026-10-01','2026-10-01']);assert.equal(p.progress.total,3);assert.equal(p.missing_dates_count,1);assert.equal(p.bytes,'5000000000');assert.equal(p.counts.files,1);
 const page=await rpc('admin_cleanup_status',[p.id,50,0]);assert.deepEqual(page.orders.map(o=>o.order_id),['1','2','3']);
 await assert.rejects(db.query('INSERT INTO admin_cleanup_jobs(action) VALUES (\'all\')'),/permission denied/);
 await user(17);await assert.rejects(rpc('admin_cleanup_status',[p.id]),/Access denied/);
 await user(10);await assert.rejects(rpc('admin_cleanup_preview',['bogus','2026-10-01','2026-10-01']),/Invalid/);await assert.rejects(rpc('admin_cleanup_preview',['files','2026-10-02','2026-10-01']),/Invalid/);
 // NULL lab must not silently attach to an order number shared by two labs.
 await sql('UPDATE work_order_files SET lab_organization_id=NULL WHERE object_path=$1',[path]);
 await user(10);const ambiguous=await rpc('admin_cleanup_preview',['files','2026-10-01','2026-10-01']);assert.equal((await rpc('admin_cleanup_status',[ambiguous.id])).orders[0].state,'skipped');
 // A child-only change invalidates the aggregate revision.
 const rev=(await sql('SELECT cleanup_revision FROM lab_work_orders WHERE lab_organization_id=$1 AND id=2',[lab])).rows[0].cleanup_revision;
 await sql('INSERT INTO lab_patient_cases(lab_organization_id,id,work_order_id,clinic_note) VALUES ($1,2,2,\'changed\')',[lab]);
 assert.ok(Number((await sql('SELECT cleanup_revision FROM lab_work_orders WHERE lab_organization_id=$1 AND id=2',[lab])).rows[0].cleanup_revision)>Number(rev));
 // DST calendar days are 23/25 hours, with both local-day boundaries correct.
 await order(20,lab,'2026-03-28T22:00:00Z');await order(21,lab,'2026-03-29T20:59:59Z');await order(22,lab,'2026-03-29T21:00:00Z');
 await order(23,lab,'2026-10-24T21:00:00Z');await order(24,lab,'2026-10-25T21:59:59Z');await order(25,lab,'2026-10-25T22:00:00Z');
 await user(10);assert.equal((await rpc('admin_cleanup_preview',['clinical','2026-03-29','2026-03-29'])).progress.total,2);assert.equal((await rpc('admin_cleanup_preview',['clinical','2026-10-25','2026-10-25'])).progress.total,2);
 await sql('SELECT 1');await cleanup();await user(10);assert.equal((await rpc('admin_cleanup_status',[p.id])).job.id,p.id);
 console.log('PASS: scoped previews, actual Storage sizes, RLS, ambiguity, child revision, DST, rerun');
}finally{await db.close();}
