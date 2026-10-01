import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:cors});
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

function storageQuota(value: unknown) {
  const text = String(value || "100000000000");
  if (!/^\d{1,19}$/.test(text) || BigInt(text) <= 0n || BigInt(text) > 9223372036854775807n) throw new Error("Invalid Storage quota configuration");
  return BigInt(text).toString();
}

async function rpc(client: any, name: string, params: Record<string, unknown> = {}) {
  const {data,error} = await client.rpc(name,params); if (error) throw error; return data;
}
async function processCleanupJob(admin: any, jobId: string, deadlineMs = 20000) {
  const workerId = crypto.randomUUID(), started = Date.now(); let processed = 0;
  while (processed < 10 && Date.now() - started < deadlineMs) {
    const item = await rpc(admin,"admin_cleanup_claim",{p_job_id:jobId,p_worker_id:workerId}); if (!item) break;
    let offset = 0, complete = true, failed = false;
    while (offset < Number(item.file_count)) {
      if (Date.now() - started >= deadlineMs) { complete = false; break; }
      const page = await rpc(admin,"admin_cleanup_files",{p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId,p_offset:offset,p_limit:100});
      if (!Array.isArray(page.files) || !page.files.length) throw new Error("Incomplete file manifest");
      const pending = page.files.filter((file: any) => !(item.reconciliation ? file.reconciled : file.initial_done));
      if (pending.some((file: any) => file.bucket !== "work-order-files")) throw new Error("Invalid manifest bucket");
      if (pending.length) {
        let result: any; try { result = await admin.storage.from("work-order-files").remove(pending.map((file: any) => file.path)); } catch { result = {error:{message:"Storage unavailable"}}; }
        if (result.error) { failed = true; complete = false; break; }
        await rpc(admin,"admin_cleanup_checkpoint",{p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId,p_paths:pending.map((file: any) => file.path),p_reconciliation:Boolean(item.reconciliation)});
      }
      offset += page.files.length;
    }
    const params = {p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId,p_storage_success:complete && !failed};
    if (failed || complete) {
      try { await rpc(admin,item.reconciliation ? "admin_cleanup_reconcile_finish" : "admin_cleanup_finish",params); }
      catch (error) { if (complete && !item.reconciliation) await rpc(admin,"admin_cleanup_finish",{...params,p_storage_success:false,p_error_code:"database_failed"}); throw error; }
    } else { await rpc(admin,"admin_cleanup_yield",{p_job_id:jobId,p_order_id:item.order_id,p_worker_id:workerId}); break; }
    processed++; if (failed) break;
  }
  return rpc(admin,"admin_cleanup_worker_status",{p_job_id:jobId});
}
async function runScheduledCleanup(admin: any) {
  const started = Date.now(), jobs = await rpc(admin,"admin_cleanup_due",{p_limit:10}); let processed = 0, failed = 0;
  for (const jobId of jobs) { const remaining = 20000 - (Date.now() - started); if (remaining <= 0) break; try { await processCleanupJob(admin,jobId,remaining); processed++; } catch { failed++; } }
  return {processed,failed};
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok",{headers:cors});
  if (request.method !== "POST") return json({message:"Method not allowed.",code:"method"},405);
  const authorization = request.headers.get("Authorization") || "";
  if (!/^bearer\s+\S+/i.test(authorization) && !request.headers.has("X-Cleanup-Scheduler-Secret")) return json({message:"Authentication required.",code:"auth"},401);
  let body: any; try { body = await request.json(); } catch { return json({message:"Invalid JSON.",code:"input"},400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({message:"Invalid request.",code:"input"},400);
  const operation = body.operation;
  if (!["usage","preview","jobs","status","confirm","process","scheduled"].includes(operation)) return json({message:"Invalid operation.",code:"input"},400);
  if (operation === "preview" && (!["files","clinical","all"].includes(body.action) || !validDate(body.from) || !validDate(body.to) || body.from > body.to)) return json({message:"Selectează un interval valid.",code:"input"},400);
  if (["status","confirm","process"].includes(operation) && !uuid(body.job_id)) return json({message:"Invalid job_id.",code:"input"},400);
  if (body.offset !== undefined && (!Number.isInteger(body.offset) || body.offset < 0)) return json({message:"Invalid pagination.",code:"input"},400);
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 200)) return json({message:"Invalid pagination.",code:"input"},400);
  try {
    const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({message:"Cleanup service is not configured.",code:"configuration"},503);
    const options = {auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input: RequestInfo | URL, init: RequestInit = {}) => fetch(input,{...init,signal:init.signal || AbortSignal.timeout(15000)})}};
    if (operation === "scheduled") {
      const expected = Deno.env.get("FLOWRISE_CLEANUP_SCHEDULER_SECRET") || "", supplied = request.headers.get("X-Cleanup-Scheduler-Secret") || "";
      let difference = expected.length ^ supplied.length; for (let i = 0; i < Math.max(expected.length,supplied.length); i++) difference |= (expected.charCodeAt(i) || 0) ^ (supplied.charCodeAt(i) || 0);
      if (expected.length < 32 || difference !== 0) return json({message:"Access denied.",code:"access"},403);
      return json({ok:true,...await runScheduledCleanup(createClient(url,service,options))});
    }
    if (!/^bearer\s+\S+/i.test(authorization)) return json({message:"Authentication required.",code:"auth"},401);
    const caller = createClient(url,anon,{...options,global:{...options.global,headers:{Authorization:authorization}}});
    const {data:identity,error:authError} = await caller.auth.getUser(); if (authError || !identity?.user?.id) return json({message:"Invalid session.",code:"auth"},401);
    const admin = createClient(url,service,options), id = identity.user.id;
    const {data:profile,error:profileError} = await admin.from("profiles").select("active").eq("id",id).maybeSingle();
    const {data:lab,error:labError} = await admin.from("organizations").select("id").eq("slug","flowrise-dental-lab").eq("organization_type","lab").eq("active",true).maybeSingle();
    if (profileError || !profile?.active || labError || !lab?.id) return json({message:"Access denied.",code:"access"},403);
    const {data:membership,error:membershipError} = await admin.from("organization_memberships").select("role,status").eq("organization_id",lab.id).eq("user_id",id).eq("status","active").maybeSingle();
    if (membershipError || String(membership?.role || "").toLowerCase() !== "admin") return json({message:"Access denied.",code:"access"},403);
    if (operation === "usage") {
      const files = await rpc(caller,"admin_storage_usage");
      return json({ok:true,usage:{files:{...files,quota_bytes:storageQuota(Deno.env.get("FLOWRISE_STORAGE_QUOTA_BYTES"))}}});
    }
    if (operation === "preview") return json({ok:true,job:await rpc(caller,"admin_cleanup_preview",{p_action:body.action,p_from:body.from,p_to:body.to})});
    if (operation === "jobs") return json({ok:true,jobs:await rpc(caller,"admin_cleanup_jobs",{p_limit:Math.min(body.limit || 20,100)})});
    if (operation === "status") return json({ok:true,...await rpc(caller,"admin_cleanup_status",{p_job_id:body.job_id,p_limit:body.limit || 50,p_offset:body.offset || 0})});
    if (operation === "confirm") return json({ok:true,job:await rpc(caller,"admin_cleanup_confirm",{p_job_id:body.job_id,p_confirmation:String(body.confirmation || "")})});
    await rpc(caller,"admin_cleanup_status",{p_job_id:body.job_id,p_limit:1,p_offset:0});
    return json({ok:true,job:await processCleanupJob(admin,body.job_id)});
  } catch (error) {
    const message = String((error as Error)?.message || "");
    if (/Access denied|permission denied/i.test(message)) return json({message:"Access denied.",code:"access"},403);
    if (/expired|confirmation|Invalid action|date range|pagination/i.test(message)) return json({message:"Previzualizarea a expirat sau confirmarea nu este validă. Repetă previzualizarea.",code:"preview"},400);
    return json({message:"Operația nu a putut fi finalizată. Progresul salvat poate fi reluat.",code:"operation"},500);
  }
});
