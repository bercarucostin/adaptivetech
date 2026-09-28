import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
function handler(role){
 let handle;let sends=0;
 const admin={from(table){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:table==='organizations'?{id:'org'}:{role,status:'active'}};}};return q;},auth:{admin:{inviteUserByEmail(){sends++;},createUser(){sends++;}}}};
 const src=fs.readFileSync('db/edge-functions/admin-users/index.ts','utf8').replace(/^import .*;\n/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(src),{Request,Response,console,Date,Map,URL,createClient(_url,key){return key==='anon'?{auth:{getUser:async()=>({data:{user:{id:'caller'}}})}}:admin;},Deno:{env:{get:k=>({SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[k]},serve(h){handle=h;}}});
 return {handle,sends:()=>sends};
}
test('unauthenticated invitation request never sends mail',async()=>{const f=handler('admin');const r=await f.handle(new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'create',data:{Send_Invite:true}})}));assert.equal(r.status,401);assert.equal(f.sends(),0);});
test('non-admin cannot send an invitation',async()=>{for(const role of ['doctor','technician','manager']){const f=handler(role);const r=await f.handle(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify({action:'create',data:{Send_Invite:true}})}));assert.equal(r.status,403);assert.equal(f.sends(),0);}});
