import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function setup(rpc){
 const elements=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{disabled:false,checked:false,textContent:'',open:false,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();}});return elements.get(id);}
 const ctx={document:{getElementById:el},auth:{user:'one'},authEpoch:1,sbRpc:rpc,legacyAdminCache:{},clearAuth(){ctx.auth=null;ctx.authEpoch++;}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('website/app/email-notifications.js','utf8'),ctx);
 return {ctx,el,open:()=>el('emailPreferencesBtn').handlers.click(),save:()=>el('emailPreferencesForm').handlers.submit({preventDefault(){}})};
}
test('loads and saves independent opt-ins through authenticated RPC',async()=>{
 const calls=[];const ui=setup(async(name,args)=>{calls.push([name,args]);return [{notify_new_work_order:true,notify_stage_status:false}];});
 await ui.open();assert.equal(ui.el('myNotifyNew').checked,true);assert.equal(ui.el('myNotifyStage').checked,false);
 ui.el('myNotifyStage').checked=true;await ui.save();
 assert.equal(calls[1][0],'set_my_email_preferences');assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])),{p_new:true,p_stage:true});
 assert.match(ui.el('emailPreferencesStatus').textContent,/salvate/);
});
test('missing migration stays disabled and late responses cannot cross a logout',async()=>{
 const broken=setup(async()=>{throw new Error('RPC missing');});await broken.open();assert.equal(broken.el('emailPreferencesSave').disabled,true);assert.match(broken.el('emailPreferencesStatus').textContent,/RPC missing/);
 let resolve;const ui=setup(()=>new Promise(r=>resolve=r));const pending=ui.open();ui.ctx.clearAuth();resolve([{notify_new_work_order:true,notify_stage_status:true}]);await pending;
 assert.equal(ui.el('emailPreferencesDialog').open,false);assert.equal(ui.el('myNotifyNew').checked,false);
});
