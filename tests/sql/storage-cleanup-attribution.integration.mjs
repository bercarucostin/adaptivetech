import assert from 'node:assert/strict';
import {fixture,lab,otherLab,uid} from '../storage-cleanup/sql-fixture.mjs';
const {db,user,sql,rpc,order}=await fixture();
try {
 await order(72);const path=`work-orders/72/${uid(472)}_scan.zip`;
 await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('work-order-files',$1,'{\"size\":100}')",[path]);
 await user(10);const job=await rpc('admin_cleanup_preview',['files','2026-10-01','2026-10-01']);await rpc('admin_cleanup_confirm',[job.id,'']);
 await user(null,true);await rpc('admin_cleanup_claim',[job.id,uid(300)]);
 let orderBlocked=false,pathBlocked=false;
 try{await order(72,otherLab);}catch(e){orderBlocked=/curățare/.test(e.message);}
 try{await sql("INSERT INTO work_order_files(legacy_work_order_id,lab_organization_id,object_path,original_file_name,file_size_bytes) VALUES (99,$1,$2,'scan.zip',100)",[otherLab,path]);}catch(e){pathBlocked=/curățare/.test(e.message);}
 assert.deepEqual({orderBlocked,pathBlocked},{orderBlocked:true,pathBlocked:true});
 console.log('PASS: concurrent lab-ID creation and conflicting path attribution are blocked during processing');
} finally {await db.close();}
