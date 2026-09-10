const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const workflow=JSON.parse(fs.readFileSync(path.join(__dirname,'../../workflows/Flowrise Dental - AI Client V17.4.json'),'utf8'));
const node=name=>workflow.nodes.find(item=>item.name===name);

test('Admin prompt routes technician cost duplication as technician_cost',()=>{
  const code=node('AI - Build Final Prompt').parameters.jsCode;
  assert.match(code,/entity is technician_cost, never work_order/);
  assert.match(code,/source_technician/);
  assert.match(code,/target_technician/);
});

test('typed preview and execute intents use the new RPCs',()=>{
  const mutation=node('Supabase - Role Safe AI Mutation').parameters;
  assert.match(mutation.url,/ai_preview_operation/);
  assert.match(mutation.url,/ai_execute_operation/);
  assert.match(mutation.body,/p_envelope/);
  assert.match(node('AI - Role Safe Mutation?').parameters.conditions.conditions[0].leftValue,/preview/);
});

test('legacy Work Order intents use the idempotent adapter',()=>{
  const mutation=node('Supabase - Role Safe AI Mutation').parameters;
  assert.match(mutation.url,/ai_mutate_work_order_role_safe_idempotent/);
  assert.match(mutation.body,/p_request_key/);
  assert.match(mutation.body,/client_request_id/);
});

test('Work Order adapter carries item scopes without scalar clinical fields',()=>{
  const mutation=node('Supabase - Role Safe AI Mutation').parameters;
  assert.match(mutation.body,/p_payload/);
  assert.doesNotMatch(mutation.body,/Tip_Lucrare|Nr_Elemente|material/);
});

test('preview response carries the exact pending operation',()=>{
  const code=node('AI - Mutation Result').parameters.jsCode;
  assert.match(code,/pending_operation/);
  assert.match(code,/preview_id/);
  assert.match(code,/Nu am aplicat modificarea/);
});

test('confirmed preview is carried by the client and reused exactly',()=>{
  const normalize=node('AI - Normalize Input').parameters.jsCode;
  const prompt=node('AI - Build Final Prompt').parameters.jsCode;
  const parser=node('AI - Parse Final').parameters.jsCode;
  assert.match(normalize,/pending_operation/);
  assert.match(normalize,/client_request_id/);
  assert.match(prompt,/PENDING_PREVIEW/);
  assert.match(parser,/operation=\{\.\.\.pending\}/);
  assert.match(parser,/operation\.request_key=String\(input\.client_request_id/);
});

test('prompt documents exact technician-cost target keys and new values',()=>{
  const code=node('AI - Build Final Prompt').parameters.jsCode;
  assert.match(code,/target \{source_row_no:number\}/);
  assert.match(code,/New values may come from the current user request/);
  assert.match(code,/several cost rows belonging to the same technician are one technician match/);
});

test('prompt requires an explicit settlement choice for reassignment',()=>{
  const code=node('AI - Build Final Prompt').parameters.jsCode;
  assert.match(code,/Settlement_Model/);
  assert.match(code,/keep_outstanding or pay_outstanding/);
});
