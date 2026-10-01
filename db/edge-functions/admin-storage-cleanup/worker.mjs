export async function rpc(client,name,params={}){const {data,error}=await client.rpc(name,params);if(error)throw error;return data;}
export async function processCleanupJob({admin,jobId,workerId=crypto.randomUUID(),maxOrders=10,deadlineMs=20000,now=Date.now}){
 const started=now();let processed=0;
 while(processed<maxOrders&&now()-started<deadlineMs){
  const item=await rpc(admin,'admin_cleanup_claim',{p_job_id:jobId,p_worker_id:workerId});if(!item)break;
  let offset=0,complete=true,failed=false;
  while(offset<Number(item.file_count)){
   if(now()-started>=deadlineMs){complete=false;break;}
   const page=await rpc(admin,'admin_cleanup_files',{p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId,p_offset:offset,p_limit:100});
   if(!Array.isArray(page.files)||!page.files.length)throw new Error('Incomplete file manifest');
   const pending=page.files.filter(f=>!(item.reconciliation?f.reconciled:f.initial_done));
   if(pending.some(f=>f.bucket!=='work-order-files'))throw new Error('Invalid manifest bucket');
   if(pending.length){
    let result;try{result=await admin.storage.from('work-order-files').remove(pending.map(f=>f.path));}catch{result={error:{message:'Storage unavailable'}};}
    if(result.error){failed=true;complete=false;break;}
    await rpc(admin,'admin_cleanup_checkpoint',{p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId,p_paths:pending.map(f=>f.path),p_reconciliation:Boolean(item.reconciliation)});
   }
   offset+=page.files.length;
  }
  const params={p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId,p_storage_success:complete&&!failed};
  if(failed||complete){
   try{await rpc(admin,item.reconciliation?'admin_cleanup_reconcile_finish':'admin_cleanup_finish',params);}
   catch(error){
    // A relational error rolls its transaction back. Retain the manifest for retry.
    if(complete&&!item.reconciliation)await rpc(admin,'admin_cleanup_finish',{...params,p_storage_success:false,p_error_code:'database_failed'});
    throw error;
   }
  }else{
   await rpc(admin,'admin_cleanup_yield',{p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId});break;
  }
  processed++;if(failed)break;
 }
 return rpc(admin,'admin_cleanup_worker_status',{p_job_id:jobId});
}

export async function runScheduledCleanup({admin,now=Date.now}){
 const started=now(),jobs=await rpc(admin,'admin_cleanup_due',{p_limit:10});let processed=0,failed=0;
 for(const jobId of jobs){const remaining=20000-(now()-started);if(remaining<=0)break;
  try{await processCleanupJob({admin,jobId,deadlineMs:remaining,now});processed++;}catch{failed++;}
 }
 return {processed,failed};
}
