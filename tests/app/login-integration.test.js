const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const app=fs.readFileSync('website/app/app.js','utf8');
const source=app.slice(app.indexOf('async function supabaseIdentifierLogin('),app.indexOf('async function validateSupabaseSavedSession('));
function setup(response,token='verified-token'){
 const requests=[];let resets=0;
 const context={Date,AbortController,setTimeout,clearTimeout,REQUEST_TIMEOUT_MS:1000,activeControllers:new Set(),
  SUPABASE_CONFIG:{projectUrl:'https://test.invalid',publishableKey:'public'},supabaseConfigured:()=>true,
  supabaseClient:{auth:{setSession:async()=>({error:null})}},
  loginSecurity:{getToken:()=>token,reset:()=>resets++},fetch:async(url,args)=>{requests.push(args);return response;}};
 vm.createContext(context);vm.runInContext(source,context);return {context,requests,resets:()=>resets};
}
test('main login sends CAPTCHA and resets it after a rejected attempt',async()=>{
 const x=setup(new Response('{"message":"Invalid"}',{status:401}));
 await assert.rejects(x.context.supabaseIdentifierLogin('ana','test-password'),/Invalid/);
 assert.equal(JSON.parse(x.requests[0].body).captchaToken,'verified-token');assert.equal(x.resets(),1);
});
test('main login never calls backend without a CAPTCHA token',async()=>{
 const x=setup(null,'');await assert.rejects(x.context.supabaseIdentifierLogin('ana','test-password'),/securitate/);assert.equal(x.requests.length,0);
});
test('main login respects HTTP-date Retry-After, not an arbitrary minute',async()=>{
 const future=new Date(Date.now()+300000).toUTCString();
 const x=setup(new Response('{}',{status:429,headers:{'Retry-After':future}}));
 await assert.rejects(x.context.supabaseIdentifierLogin('ana','test-password'),/peste (299|300) secunde/);assert.equal(x.resets(),1);
});
