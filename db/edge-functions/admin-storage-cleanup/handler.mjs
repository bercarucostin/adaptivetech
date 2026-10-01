import {readDiskUsage,storageQuota} from './metrics.mjs';
import {rpc,processCleanupJob} from './worker.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function createAdminStorageCleanupHandler({createClient,getEnv,fetch=globalThis.fetch,now=Date.now}){
 return async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({message:'Method not allowed.',code:'method'},405);
  const authorization=req.headers.get('Authorization')||'';
  if(!/^bearer\s+\S+/i.test(authorization))return json({message:'Authentication required.',code:'auth'},401);
  let body;try{body=await req.json();}catch{return json({message:'Invalid JSON.',code:'input'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))return json({message:'Invalid request.',code:'input'},400);
  const operation=body.operation;
  if(!['usage','preview','jobs','status','confirm','process'].includes(operation))return json({message:'Invalid operation.',code:'input'},400);
  if(operation==='preview'&&(!['files','clinical','all'].includes(body.action)||!validDate(body.from)||!validDate(body.to)||body.from>body.to))return json({message:'Selectează un interval valid.',code:'input'},400);
  if(['status','confirm','process'].includes(operation)&&!uuid(body.job_id))return json({message:'Invalid job_id.',code:'input'},400);
  if(body.offset!==undefined&&(!Number.isInteger(body.offset)||body.offset<0))return json({message:'Invalid pagination.',code:'input'},400);
  if(body.limit!==undefined&&(!Number.isInteger(body.limit)||body.limit<1||body.limit>200))return json({message:'Invalid pagination.',code:'input'},400);
  try{
   const url=getEnv('SUPABASE_URL'),anon=getEnv('SUPABASE_ANON_KEY'),service=getEnv('SUPABASE_SERVICE_ROLE_KEY');
   if(!url||!anon||!service)return json({message:'Cleanup service is not configured.',code:'configuration'},503);
   const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init={})=>fetch(input,{...init,signal:init.signal||AbortSignal.timeout(15000)})}};
   const caller=createClient(url,anon,{...options,global:{...options.global,headers:{Authorization:authorization}}});
   const {data:identity,error:authError}=await caller.auth.getUser();if(authError||!identity?.user?.id)return json({message:'Invalid session.',code:'auth'},401);
   const admin=createClient(url,service,options),id=identity.user.id;
   const {data:profile,error:profileError}=await admin.from('profiles').select('active').eq('id',id).maybeSingle();
   const {data:lab,error:labError}=await admin.from('organizations').select('id').eq('slug','flowrise-dental-lab').eq('organization_type','lab').eq('active',true).maybeSingle();
   if(profileError||!profile?.active||labError||!lab?.id)return json({message:'Access denied.',code:'access'},403);
   const {data:membership,error:membershipError}=await admin.from('organization_memberships').select('role,status').eq('organization_id',lab.id).eq('user_id',id).eq('status','active').maybeSingle();
   if(membershipError||String(membership?.role||'').toLowerCase()!=='admin')return json({message:'Access denied.',code:'access'},403);
   if(operation==='usage'){
    const files=await rpc(caller,'admin_storage_usage');
    const database=await readDiskUsage({projectRef:getEnv('SUPABASE_PROJECT_REF')||new URL(url).hostname.split('.')[0],token:getEnv('SUPABASE_MANAGEMENT_TOKEN'),fetch});
    return json({ok:true,usage:{files:{...files,quota_bytes:storageQuota(getEnv('FLOWRISE_STORAGE_QUOTA_BYTES'))},database}});
   }
   if(operation==='preview')return json({ok:true,job:await rpc(caller,'admin_cleanup_preview',{p_action:body.action,p_from:body.from,p_to:body.to})});
   if(operation==='jobs')return json({ok:true,jobs:await rpc(caller,'admin_cleanup_jobs',{p_limit:Math.min(body.limit||20,100)})});
   if(operation==='status')return json({ok:true,...await rpc(caller,'admin_cleanup_status',{p_job_id:body.job_id,p_limit:body.limit||50,p_offset:body.offset||0})});
   if(operation==='confirm')return json({ok:true,job:await rpc(caller,'admin_cleanup_confirm',{p_job_id:body.job_id,p_confirmation:String(body.confirmation||'')})});
   await rpc(caller,'admin_cleanup_status',{p_job_id:body.job_id,p_limit:1,p_offset:0});
   return json({ok:true,job:await processCleanupJob({admin,jobId:body.job_id,now})});
  }catch(error){
   const message=String(error?.message||'');
   if(/Access denied|permission denied/i.test(message))return json({message:'Access denied.',code:'access'},403);
   if(/expired|confirmation|Invalid action|date range|pagination/i.test(message))return json({message:'Previzualizarea a expirat sau confirmarea nu este validă. Repetă previzualizarea.',code:'preview'},400);
   return json({message:'Operația nu a putut fi finalizată. Progresul salvat poate fi reluat.',code:'operation'},500);
  }
 };
}
