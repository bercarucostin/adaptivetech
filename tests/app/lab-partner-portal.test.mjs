import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const { parseHTML } = await import(process.env.DOM_MODULE_PATH || 'linkedom');
const source = readFileSync(process.env.PORTAL_SOURCE_PATH||'website/app/lab-partner-orders.js', 'utf8');

function setup(role = 'partner', detail = {}) {
  const { document, window } = parseHTML('<html><body><main id="content"></main><h1 id="title"></h1><p id="subtitle"></p></body></html>');
  const order = { id: 7, status: 'Not Started', locked: false, can_edit: true, approval_state: 'approved', deadline_at: '2030-10-05T12:00:00Z', items: [{work_type:'Coroană',quantity:2,color:'A2'}], price_lines: [], final_price: 100, ...detail };
  window.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLElement.prototype.close = function () { this.removeAttribute('open'); };
  const noop = () => {};
  const context = { document, window, Date, Intl, console, setTimeout:noop, clearTimeout:noop,
    dueDate:null, pageTitle:document.getElementById('title'),pageSubtitle:document.getElementById('subtitle'),content:document.getElementById('content'),
    orders:[], currentView:'production', workTypes:[], statuses:['Not Started','Started','Finished','Shipped','List Sent','Paid'],
    isLabPartner:()=>role==='partner',isManagement:()=>role==='admin',isAdmin:()=>false,isDoctor:()=>false,
    loadAll:async()=>{},render:noop,renderWorkOrders:noop,renderProduction:noop,openNewOrder:noop,editOrder:noop,adminConfigRequest:noop,supabaseAdminMutation:noop,renderAdminConfig:noop,
    resolveLabOrganizationId:async()=>'lab',showLoading:noop,hideLoading:noop,
    sbRpc:async(name)=>name==='get_lab_partner_work_order'?order:name==='list_lab_partner_work_orders'?[order]:{work_types:[]},
    callFileAuthorization:async()=>({files:[{id:'f',original_file_name:'scan.stl'}]}),
    escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    optionHtml:(values,current)=>values.map(v=>`<option value="${v}"${v===current?' selected':''}>${v}</option>`).join(''),
    money:value=>String(value),uiText:value=>({'Not Started':'Neînceput','Started':'În lucru'}[value]||value),
    alert:message=>{throw new Error(message);},confirm:()=>true
  };
  vm.createContext(context);vm.runInContext(source,context);
  return context;
}

test('partner sees production status and can edit an approved unstarted order', async () => {
  const c=setup();await c.openLabPartnerOrder(7);
  assert.equal(c.document.getElementById('labPartnerDeadline').disabled,false);
  assert.ok(c.document.querySelector('#labPartnerForm [type="submit"]'));
  assert.match(c.document.getElementById('labPartnerForm').textContent,/Neînceput/);
});
test('locked and started orders allow viewing and downloading but no form or file changes',async()=>{
  for(const detail of [{locked:true,can_edit:false},{status:'Started',can_edit:false},{status:'Finished',can_edit:false}]){
    const c=setup('partner',detail);await c.openLabPartnerOrder(7);
    assert.equal(c.document.getElementById('labPartnerDeadline').disabled,true);
    assert.equal(c.document.querySelector('#labPartnerForm [type="submit"]'),null);
    assert.equal(c.document.querySelector('[data-remove-line]'),null);
    assert.equal(c.document.querySelector('[data-delete-file-id]'),null);
    assert.equal(c.document.getElementById('labPartnerUploadFiles'),null);
    assert.ok(c.document.querySelector('[data-file-id]'));
  }
});
test('management can approve an awaiting order inside its open dialog',async()=>{
  const c=setup('admin',{approval_state:'pending',can_edit:false});await c.openLabPartnerOrder(7);
  assert.ok(c.document.querySelector('[data-review-decision="approve"]'));
  assert.ok(c.document.querySelector('[data-review-decision="reject"]'));
  assert.equal(c.document.querySelector('#labPartnerForm [type="submit"]'),null);
});
test('refresh preserves the partner production view and maps lock/edit permissions',async()=>{
  const c=setup('partner',{locked:true,can_edit:false});await c.loadAll(false);
  assert.equal(c.currentView,'production');
  assert.equal(c.orders[0].locked,true);
  assert.equal(c.orders[0].canEdit,false);
});
test('partner dashboard groups own orders by their current status without production controls',()=>{
  const c=setup();c.orders=[{id:7,status:'Started',approvalState:'approved',workType:'Coroană',deadline:'2030-10-05',finalPrice:100}];
  c.renderProduction();
  const card=c.content.querySelector('[data-partner-order="7"]');assert.ok(card);
  assert.match(card.closest('[data-partner-status]').textContent,/În lucru/);
  assert.equal(c.content.querySelector('[draggable="true"],select'),null);
});
test('a late detail response cannot replace a newer order dialog',async()=>{
  const c=setup();const pending=new Map();
  c.sbRpc=async(name,args)=>name==='get_lab_partner_work_order'?new Promise(resolve=>pending.set(args.p_order,resolve)):{};
  const first=c.openLabPartnerOrder(7),second=c.openLabPartnerOrder(8);
  await new Promise(setImmediate);
  const detail=id=>({id,status:'Not Started',can_edit:true,approval_state:'pending',items:[],price_lines:[],deadline_at:'2030-10-05T12:00Z'});
  pending.get(8)(detail(8));await second;pending.get(7)(detail(7));await first;
  assert.match(c.document.querySelector('#labPartnerForm h2').textContent,/#8/);
});
test('mobile order cards include current status, approval and the open action together',()=>{
  const c=setup();c.orders=[{id:7,status:'Started',approvalState:'approved',workType:'Coroană',deadline:'2030-10-05',finalPrice:100}];
  c.renderLabPartnerOrders();
  const card=c.content.querySelector('.lab-partner-order-card');assert.ok(card);
  assert.match(card.textContent,/În lucru/);assert.match(card.textContent,/Aprobată/);
  assert.ok(card.querySelector('[data-partner-order="7"]'));
});
test('saving snapshots the selected order and note before asynchronous lab lookup',async()=>{
  const c=setup('partner',{approval_state:'rejected'});vm.runInContext('labPartnerUi.types=[{tip_lucrare:"Coroană",processing_enabled:false}]',c);await c.openLabPartnerOrder(7);
  Object.defineProperty(c.document.getElementById('labPartnerFiles'),'files',{value:[]});
  let resolveLab,submitted;
  c.resolveLabOrganizationId=()=>new Promise(resolve=>{resolveLab=resolve;});
  c.sbRpc=async(name,args)=>{if(name==='resubmit_lab_partner_work_order')submitted=args;return true;};c.loadAll=async()=>{};
  c.document.getElementById('labPartnerNote').value='Note at save';
  c.document.getElementById('labPartnerForm').dispatchEvent(new c.window.Event('submit',{cancelable:true}));
  c.document.getElementById('labPartnerNote').value='Later change';resolveLab('lab');await new Promise(setImmediate);
  assert.equal(submitted.p_order,7);assert.equal(submitted.p_note,'Note at save');assert.equal(submitted.p_items[0].work_type,'Coroană');
});
