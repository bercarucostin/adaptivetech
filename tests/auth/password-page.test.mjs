import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const PasswordService=require('../../website/app/password-service.js');
async function page({mode='reset',hash='',signedIn=true}={}){
 const nodes=new Map(),calls=[],removed=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',dataset:{},addEventListener(e,f){this[e]=f;},reset(){}});return nodes.get(id);};
 const location={search:'?mode='+mode,pathname:'/password.html',hash,href:'https://app.example/password.html?mode='+mode+hash};
 const auth={setSession:async()=>{calls.push('setSession');return{};},getUser:async()=>{calls.push('getUser');return signedIn?{data:{user:{id:'u',email:'user@example.com'}}}:{error:{}};},updateUser:async()=>{calls.push('update');return{};},signOut:async()=>({})};
 const context={URL,URLSearchParams,location,history:{replaceState(_a,_b,url){calls.push(['replace',url]);}},sessionStorage:{removeItem(k){removed.push(k);}},document:{getElementById:get},PasswordService,window:{FLOWRISE_SUPABASE:{enabled:true},supabase:{createClient(_url,_key,opts){calls.push(['client',opts]);return{auth};}}}};
 await vm.runInNewContext(fs.readFileSync('website/app/password-page.js','utf8'),context);
 return {nodes,get,calls,removed};
}
test('recovery without tokens cannot reuse an existing signed-in account',async()=>{const p=await page();assert.equal(p.get('passwordForm').hidden,true);assert.ok(!p.calls.includes('getUser'));assert.equal(p.calls.find(c=>c[0]==='client')[1].auth.storageKey,'flowrise_password_auth');});
test('valid recovery strips fragment, verifies identity and then enables form',async()=>{const p=await page({hash:'#type=recovery&access_token=a&refresh_token=b'});assert.equal(p.calls[0][0],'replace');assert.equal(p.calls[0][1],'/password.html?mode=reset');assert.equal(p.get('passwordForm').hidden,false);assert.ok(p.calls.includes('setSession'));assert.ok(p.calls.includes('getUser'));});
test('change password requires verified existing app session',async()=>{const p=await page({mode:'change',signedIn:false});assert.equal(p.get('passwordForm').hidden,true);assert.equal(p.calls.find(c=>c[0]==='client')[1].auth.storageKey,'flowrise_supabase_auth');});
test('provider expired link error never enables form',async()=>{const p=await page({hash:'#error=access_denied&error_code=otp_expired'});assert.equal(p.get('passwordForm').hidden,true);assert.ok(!p.calls.includes('setSession'));assert.equal(p.get('requestAnother').hidden,false);});
