import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const run=(file,ctx)=>vm.runInNewContext(`(function(){${fs.readFileSync(file,'utf8')}\n})()`,{Buffer,...ctx});
const fixture={id:'00000000-0000-0000-0000-000000000001',lease_token:'lease',recipient_email:'doctor@example.test',work_order_id:42,event_kind:'stage_status',stage_key:'model',old_status:'Started',new_status:'<script>alert(1)</script>',nume_pacient:'PRIVATE PATIENT'};
test('email is addressed from alias, escaped and contains no patient data',()=>{
 const r=run('workflows/code/prepare-notification-email.js',{$json:fixture});
 const mime=Buffer.from(r.json.raw,'base64url').toString('utf8');
 assert.match(mime,/From: Flowrise Dental <app@flowrisedental.ro>/);assert.match(mime,/To: doctor@example.test/);
 const html=Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString('utf8');
 assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('PRIVATE PATIENT'));
 assert.throws(()=>run('workflows/code/prepare-notification-email.js',{$json:{...fixture,recipient_email:'doctor@example.test\r\nBcc: stolen@example.test'}}),/Invalid recipient/);
});
test('delivery outcomes distinguish success, rate limit, rejection and ambiguous failures',()=>{
 for(const [response,expected] of [[{statusCode:200,body:{id:'g1'}},'sent'],[{statusCode:429},'retry'],[{statusCode:403},'failed'],[{statusCode:500},'uncertain'],[{error:'timeout'},'uncertain'],[{statusCode:200,body:{}},'uncertain']]){
  const r=run('workflows/code/notification-delivery-result.js',{$json:response,$:()=>({item:{json:fixture}})});
  assert.equal(r.json.outcome,expected);assert.equal(r.json.id,fixture.id);
 }
});
test('workflow is inactive, uses parameterized SQL and disables implicit send retries',()=>{
 const flow=JSON.parse(fs.readFileSync('workflows/Flowrise Dental - Email Notifications.json','utf8'));
 assert.equal(flow.active,false);
 const send=flow.nodes.find(n=>n.name==='Send with Gmail');assert.equal(send.retryOnFail,false);assert.equal(send.typeVersion,4.4);assert.equal(send.onError,'continueRegularOutput');
 for(const node of flow.nodes.filter(n=>n.type==='n8n-nodes-base.code'))assert.equal(node.parameters.jsCode,fs.readFileSync(node.name==='Prepare email'?'workflows/code/prepare-notification-email.js':'workflows/code/notification-delivery-result.js','utf8'));
 assert.ok(flow.nodes.find(n=>n.name==='Record delivery').parameters.query.includes('$1::uuid'));
 assert.equal(flow.settings.saveDataSuccessExecution,'none');
});
