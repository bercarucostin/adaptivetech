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
 // Execution: confirmation freezes scope; leases and errors cannot widen it.
 await order(30,lab,'2026-10-03T10:00:00Z');await order(31,lab,'2026-10-03T11:00:00Z');
 await sql('INSERT INTO lab_patient_cases(lab_organization_id,id,work_order_id,clinic_note) VALUES ($1,30,30,\'private\')',[lab]);
 await sql("INSERT INTO lab_work_order_items(lab_organization_id,work_order_id,tooth_number,work_type) VALUES ($1,30,11,'Crown')",[lab]);
 await sql("INSERT INTO lab_work_order_stage_assignments(id,lab_organization_id,work_order_id,stage_key,technician_name) VALUES ($1,$2,30,'model','Tech')",[uid(200),lab]);
 await sql("INSERT INTO technician_payments(id,lab_organization_id,assignment_id,amount) VALUES ($1,$2,$3,100)",[uid(201),lab,uid(200)]);
 await sql("INSERT INTO technician_payments(id,lab_organization_id,assignment_id,amount,reversal_of) VALUES ($1,$2,$3,-100,$4)",[uid(202),lab,uid(200),uid(201)]);
 await sql("INSERT INTO lab_work_order_assignment_cost_lines(assignment_id,work_type,quantity,cost_source) VALUES ($1,'Crown',1,'test')",[uid(200)]);
 await sql("INSERT INTO lab_work_order_assignment_adjustments(assignment_id,work_type,quantity_delta,cost_source) VALUES ($1,'Crown',1,'test')",[uid(200)]);
 await sql("INSERT INTO work_order_financial_audit(lab_organization_id,work_order_id,entity_type,action) VALUES ($1,30,'technician_payment','paid')",[lab]);
 await user(10);const purge=await rpc('admin_cleanup_preview',['all','2026-10-03','2026-10-03']);
 await assert.rejects(rpc('admin_cleanup_confirm',[purge.id,'bad']),/confirmation/);
 await user(17);await assert.rejects(rpc('admin_cleanup_confirm',[purge.id,'ȘTERGE']),/Access denied/);
 await user(10);await rpc('admin_cleanup_confirm',[purge.id,'ȘTERGE']);await rpc('admin_cleanup_confirm',[purge.id,'ȘTERGE']);
 await assert.rejects(rpc('admin_cleanup_claim',[purge.id,uid(300)]),/permission denied/);
 await user(null,true);const claim=await rpc('admin_cleanup_claim',[purge.id,uid(300)]);assert.equal(claim.order_id,'30');
 await assert.rejects(rpc('admin_cleanup_finish',[purge.id,'30',uid(301),true]),/lease/);
 await sql('SELECT 1');await assert.rejects(db.query('UPDATE lab_work_orders SET nume_pacient=\'edited\' WHERE id=30 AND lab_organization_id=$1',[lab]),/curățare/);
 await user(null,true);await rpc('admin_cleanup_finish',[purge.id,'30',uid(300),true]);
 assert.equal((await sql('SELECT count(*)::int n FROM lab_work_orders WHERE id=30')).rows[0].n,0);
 for(const table of ['technician_payments','lab_work_order_assignment_cost_lines','lab_work_order_assignment_adjustments','work_order_financial_audit'])assert.equal((await sql(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 assert.equal((await sql('SELECT next_lab_work_order_id($1) id',[lab])).rows[0].id,32);
 await user(10);const stale=await rpc('admin_cleanup_preview',['clinical','2026-10-03','2026-10-03']);
 await sql("UPDATE lab_work_orders SET nume_pacient='changed' WHERE id=31 AND lab_organization_id=$1",[lab]);
 await user(10);await rpc('admin_cleanup_confirm',[stale.id,'']);await user(null,true);assert.equal(await rpc('admin_cleanup_claim',[stale.id,uid(300)]),null);
 await user(10);assert.equal((await rpc('admin_cleanup_status',[stale.id])).job.progress.skipped,1);
 const exp=await rpc('admin_cleanup_preview',['clinical','2026-10-03','2026-10-03']);await sql("UPDATE admin_cleanup_jobs SET expires_at=now()-interval '1 minute' WHERE id=$1",[exp.id]);await user(10);await assert.rejects(rpc('admin_cleanup_confirm',[exp.id,'']),/expired/);
 const revoked=await rpc('admin_cleanup_preview',['clinical','2026-10-03','2026-10-03']);await rpc('admin_cleanup_confirm',[revoked.id,'']);await sql("UPDATE organization_memberships SET status='inactive' WHERE user_id=$1",[uid(10)]);await user(null,true);await assert.rejects(rpc('admin_cleanup_claim',[revoked.id,uid(300)]),/Access denied/);
 await sql("UPDATE organization_memberships SET status='active' WHERE user_id=$1",[uid(10)]);
 await order(40,lab,'2026-10-04T10:00:00Z');const file40=`work-orders/40/${uid(400)}_scan.zip`;
 await sql("INSERT INTO work_order_files(legacy_work_order_id,lab_organization_id,object_path,original_file_name,file_size_bytes) VALUES (40,$1,$2,'scan.zip',100)",[lab,file40]);
 await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('work-order-files',$1,'{\"size\":100}')",[file40]);
 await user(10);const files=await rpc('admin_cleanup_preview',['files','2026-10-04','2026-10-04']);await rpc('admin_cleanup_confirm',[files.id,'']);await user(null,true);
 const c40=await rpc('admin_cleanup_claim',[files.id,uid(300)]);assert.equal(c40.order_id,'40');assert.equal(await rpc('admin_cleanup_claim',[files.id,uid(301)]),null);
 await assert.rejects(rpc('admin_cleanup_checkpoint',[files.id,'40',uid(300),['unrelated'],false]),/Invalid checkpoint/);
 await assert.rejects(rpc('admin_cleanup_finish',[files.id,'40',uid(300),true]),/incomplete/);
 await rpc('admin_cleanup_checkpoint',[files.id,'40',uid(300),[file40],false]);await rpc('admin_cleanup_finish',[files.id,'40',uid(300),true]);
 await user(10);assert.equal((await rpc('admin_cleanup_status',[files.id])).job.state,'awaiting_uploads');await user(null,true);assert.equal(await rpc('admin_cleanup_claim',[files.id,uid(300)]),null);
 await sql("UPDATE admin_cleanup_jobs SET reconcile_after=now()-interval '1 second' WHERE id=$1",[files.id]);await user(null,true);assert.equal((await rpc('admin_cleanup_claim',[files.id,uid(300)])).reconciliation,true);
 await rpc('admin_cleanup_checkpoint',[files.id,'40',uid(300),[file40],true]);await rpc('admin_cleanup_reconcile_finish',[files.id,'40',uid(300),true]);await user(10);assert.equal((await rpc('admin_cleanup_status',[files.id])).job.state,'completed');
 // Storage changes can occur without a file-row mutation (previously signed upload).
 await order(41,lab,'2026-10-05T10:00:00Z');const file41=`work-orders/41/${uid(401)}_scan.zip`;
 await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('work-order-files',$1,'{\"size\":100}')",[file41]);
 await user(10);const staleObject=await rpc('admin_cleanup_preview',['files','2026-10-05','2026-10-05']);await rpc('admin_cleanup_confirm',[staleObject.id,'']);
 await sql("UPDATE storage.objects SET metadata='{\"size\":101}' WHERE name=$1",[file41]);await user(null,true);assert.equal(await rpc('admin_cleanup_claim',[staleObject.id,uid(300)]),null);
 console.log('PASS: confirmation, expiry, leases, stale revision, revoked role, dependent purge, watermark');
 console.log('PASS: scoped previews, actual Storage sizes, RLS, ambiguity, child revision, DST, rerun');
}finally{await db.close();}
