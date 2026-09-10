const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../website/app/app.js'),'utf8');

test('material buttons use atomic adjustment RPC',()=>{
  assert.match(source,/sbRpc\("adjust_material_quantity"/);
  assert.match(source,/p_lab_organization_id:labId/);
  assert.match(source,/p_mode:change>0\?"add":"subtract"/);
  assert.match(source,/Cantitatea nu a putut fi actualizată/);
});

test('shared calendar events are editable and saved through role-safe RPC',()=>{
  assert.match(source,/return String\(event\?\.scope\|\|"shared"\)==="shared"/);
  assert.match(source,/sbRpc\("mutate_calendar_event"/);
  assert.match(source,/calendarEventCanDelete\(calendarEditor\)/);
  assert.match(source,/scopeDisabled=.*ownerUserId/);
});

test('AI preview state is persisted and submitted with a stable client request id',()=>{
  assert.match(source,/flowrise_ai_pending_/);
  assert.match(source,/pending_operation:pendingOperation/);
  assert.match(source,/client_request_id:aiClientRequestId\(\)/);
});

test('management Work Order writes use snapshot-aware RPCs',()=>{
  assert.match(source,/sbRpc\("update_management_work_order_v188"/);
  assert.match(source,/sbRpc\("update_management_work_order_stage_field"/);
  assert.doesNotMatch(source,/\.from\("lab_work_orders"\)\.update/);
  assert.match(source,/create_management_work_order/);
  assert.doesNotMatch(source,/await saveManagementWorkOrderSupabase\(savedId/);
  assert.match(source,/p_items:currentOrderScope\(\{validate:true\}\)\.items/);
  assert.match(source,/OUTSTANDING_ASSIGNMENT/);
  assert.match(source,/p_model_settlement/);
});
