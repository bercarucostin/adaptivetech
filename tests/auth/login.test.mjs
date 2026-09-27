import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginHandler } from '../../db/edge-functions/login-with-identifier/handler.mjs';
const env = { SUPABASE_URL:'https://example.test', SUPABASE_ANON_KEY:'anon', SUPABASE_SERVICE_ROLE_KEY:'service', LOGIN_RATE_LIMIT_SECRET:'a'.repeat(40) };
function fixture({deny=false, broken=false, authStatus=0, authRetry=null}={}) {
 const calls=[]; let authFetch;
 const profile={id:'user-1',username:'alice',active:true};
 const client={ rpc:async(name,args)=>{calls.push(['limit',args]); return broken?{error:{}}:{data:[{allowed:!deny,retry_after:42}]};}, from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>{calls.push(['lookup']);return {data:profile};}})})}), auth:{admin:{getUserById:async()=>({data:{user:{email:'alice@example.test'}}})}, signInWithPassword:async(input)=>{calls.push(['signin',input]); if(authRetry) await authFetch('https://example.test/auth/v1/token'); return authStatus?{error:{status:authStatus}}:{data:{session:{access_token:'token',refresh_token:'refresh'},user:{id:'user-1',email:'alice@example.test'}}};}}};
 return {calls,handle:createLoginHandler({getEnv:k=>env[k],createClient:(_url,key,options)=>{if(key==='anon')authFetch=options.global?.fetch;return client;},fetchImpl:async()=>new Response('{}',{status:429,headers:{'Retry-After':authRetry}})})};
}
const request=(identifier='Alice', extras={})=>new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','x-forwarded-for':Math.random().toString()},body:JSON.stringify({identifier,password:'password',captchaToken:'captcha',...extras})});
test('blocks before lookup and exposes retry after',async()=>{const f=fixture({deny:true});const r=await f.handle(request());assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'42');assert.equal(f.calls.length,1);});
test('fails closed on limiter error',async()=>{const f=fixture({broken:true});assert.equal((await f.handle(request())).status,503);assert.equal(f.calls.length,1);});
test('canonical email bucket is shared across nickname and email; spoofed IP is ignored',async()=>{const f=fixture();assert.equal((await f.handle(request())).status,200);assert.equal((await f.handle(request('ALICE@example.test'))).status,200);const limits=f.calls.filter(c=>c[0]==='limit');assert.equal(limits[0][1].p_key,limits[2][1].p_key);assert.equal(limits[1][1].p_key,limits[3][1].p_key);assert.match(limits[1][1].p_key,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(limits).includes('alice'));assert.equal(f.calls.find(c=>c[0]==='signin')[1].options.captchaToken,'captcha');});
test('preserves upstream throttle',async()=>{const f=fixture({authStatus:429});const r=await f.handle(request());assert.equal(r.status,429);assert.ok(Number(r.headers.get('Retry-After'))>0);});
test('rejects missing captcha, overlong identifiers, oversized body before database access',async()=>{for(const extras of [{captchaToken:''},{identifier:'a'.repeat(321)},{password:'a'.repeat(1025)}]){const f=fixture();assert.equal((await f.handle(request('alice',extras))).status,400);assert.equal(f.calls.length,0);}const f=fixture();assert.equal((await f.handle(new Request('https://x.test',{method:'POST',body:' '.repeat(17000)}))).status,413);assert.equal(f.calls.length,0);});

test('preserves provider Retry-After header',async()=>{const f=fixture({authStatus:429,authRetry:'125'});const r=await f.handle(request());assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'125');});
