const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const appPath=path.join(__dirname,'../../website/app/app.js');
const htmlPath=path.join(__dirname,'../../website/app/index.html');
const source=fs.readFileSync(appPath,'utf8');
const html=fs.readFileSync(htmlPath,'utf8');

function namedFunction(name){
  const start=source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`Missing ${name} helper.`);
  const bodyStart=source.indexOf('){',start)+1;
  let depth=0;
  for(let index=bodyStart;index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`Could not read ${name} helper.`);
}

function toothScope(selectedTeeth){
  return Function(`return (${namedFunction('deriveWorkOrderScope')})`)()(selectedTeeth);
}

function mappedOrder(row){
  const map=Function(
    'deriveWorkOrderScope','num','nullableMoney','isDoctor','isTechnician','normalize','boolish','auth',
    `return (${namedFunction('mapSupabaseOrder')})`
  )(
    toothScope,
    value=>Number(value)||0,
    value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null),
    ()=>false,
    ()=>false,
    value=>String(value??'').trim().toLowerCase(),
    value=>Boolean(value),
    {user:{Technician_Name:''}}
  );
  return map(row);
}

test('configured teeth derive a deterministic mixed work-order scope',()=>{
  const scope=toothScope([
    {tooth:21,workType:'Fațetă'},
    {tooth:11,workType:'Coroană'},
    {tooth:12,workType:'Coroană'}
  ]);

  assert.deepEqual(scope,{
    items:[
      {tooth_number:11,work_type:'Coroană'},
      {tooth_number:12,work_type:'Coroană'},
      {tooth_number:21,work_type:'Fațetă'}
    ],
    work_types:['Coroană','Fațetă'],
    work_type_summary:'Coroană, Fațetă',
    element_count:3
  });
});

test('configured teeth require a work type for every selected tooth',()=>{
  assert.throws(()=>toothScope([]),/configurează cel puțin un dinte/i);
  assert.throws(()=>toothScope([{tooth:11,workType:''}]),/tip de lucrare/i);
});

test('the work-order editor contains no scalar scope or clinical material controls',()=>{
  for(const forbidden of ['id="workType"','id="orderMaterial"','id="elements"','id="orderSyncElements"','id="orderToothMismatch"','caseMaterialList']){
    assert.doesNotMatch(html,new RegExp(forbidden));
  }
  for(const forbidden of ['orderMaterial','orderToothMaterial','orderSyncElements','orderToothMismatch','p_tip_lucrare','p_nr_elemente','p_material']){
    assert.doesNotMatch(source,new RegExp(`\\b${forbidden}\\b`));
  }
});

test('technicians may open a new work order and every writer sends item-aware scope',()=>{
  assert.match(source,/function openNewOrder\(\)\{[\s\S]*isTechnician\(\)/);
  for(const rpc of [
    'create_work_order',
    'create_technician_work_order',
    'update_doctor_work_order',
    'save_my_work_order_case'
  ]){
    const callStart=source.indexOf(`sbRpc("${rpc}"`);
    assert.notEqual(callStart,-1,`Missing ${rpc} call.`);
    const call=source.slice(callStart,callStart+1800);
    assert.match(call,/p_items:/,`${rpc} must send p_items.`);
    assert.match(call,/p_case:/,`${rpc} must send p_case.`);
  }
});

test('management create and update share the complete item-aware payload',()=>{
  const helper=source.slice(source.indexOf('async function saveManagementWorkOrderSupabase'),source.indexOf('async function handleSupabaseOrderSubmit'));
  for(const key of ['p_items','p_case','p_status_model','p_paid_model','p_model_not_applicable','p_locked'])assert.match(helper,new RegExp(key+':'));
  assert.match(helper,/sbRpc\("create_management_work_order",payload\)/);
  assert.match(helper,/sbRpc\("update_management_work_order_v188",\{\.\.\.payload,p_work_order_id:/);
});

test('read models use server-derived scope fields and frozen aggregate totals',()=>{
  const mapStart=source.indexOf('function mapSupabaseOrder(');
  assert.notEqual(mapStart,-1,'Missing order read mapper.');
  const mapper=source.slice(mapStart,mapStart+4000);
  assert.match(mapper,/work_type_summary/);
  assert.match(mapper,/element_count/);
  assert.match(mapper,/items/);
  assert.match(mapper,/snapshot_list_price/);
  assert.match(mapper,/snapshot_final_price/);
});

test('work-order screens have no scalar unit-price field or display',()=>{
  assert.doesNotMatch(html,/id="unitPrice"/);
  assert.doesNotMatch(source,/\bunitPrice\b/);
  assert.doesNotMatch(source,/<span>Preț element<\/span>/);
  assert.doesNotMatch(source,/{key:"unitPrice",label:"Preț element"/);
  assert.doesNotMatch(source,/<span>Unit price<\/span>/);
});

test('read-model technician costs use frozen assignment amounts without catalog fallback',()=>{
  const mapped=mappedOrder({
    id:14,
    items:[{tooth_number:11,work_type:'Coroană'}],
    work_types:['Coroană'],
    work_type_summary:'Coroană',
    element_count:1,
    snapshot_list_price:250,
    snapshot_final_price:225,
    cost_model:11,
    cost_modelare:13,
    cost_cer_fin:17
  });

  assert.equal(mapped.costModel,11);
  assert.equal(mapped.costModeling,13);
  assert.equal(mapped.costCerFin,17);
  assert.equal(mapped.totalTechCost,41);

  const mapper=namedFunction('mapSupabaseOrder');
  assert.doesNotMatch(mapper,/technicianStageCost|technicianCostRules/);
  assert.match(mapper,/nullableMoney\(r\.cost_model\)/);
  assert.match(mapper,/nullableMoney\(r\.cost_modelare\)/);
  assert.match(mapper,/nullableMoney\(r\.cost_cer_fin\)/);
});

test('missing technician costs remain missing instead of becoming zero',()=>{
  const mapped=mappedOrder({
    id:16,
    items:[{tooth_number:11,work_type:'Coroană'}],
    work_types:['Coroană'],
    work_type_summary:'Coroană',
    element_count:1,
    tehnician_model:'Denis',
    cost_model:null
  });

  assert.equal(mapped.costModel,null);
  assert.equal(mapped.totalTechCost,null);
  assert.match(source,/Cost neconfigurat/);
});

test('not-applicable stages retain historical frozen technician costs',()=>{
  const mapped=mappedOrder({id:15,items:[{tooth_number:11,work_type:'Crown'}],
    model_not_applicable:true,modelare_not_applicable:true,cer_fin_not_applicable:true,
    cost_model:11,cost_modelare:13,cost_cer_fin:17});
  assert.equal(mapped.costModel,11);
  assert.equal(mapped.costModeling,13);
  assert.equal(mapped.costCerFin,17);
  assert.equal(mapped.totalTechCost,41);
});

test('saved prices render billing units, frozen aggregate totals, and a separate clinical count',()=>{
  const box={innerHTML:''},list={value:null},final={value:null};
  const hint={textContent:'',classList:{add(){},remove(){}}};
  const labels={per_tooth:'Per dinte',per_arch:'Per arcadă',per_piece:'Per piesă'};
  const normalizeMode=value=>String(value||'per_tooth');
  const renderer=Function('$','num','money','escapeHtml','isManagement','listPrice','finalPrice','priceHint','setFormContractValue','normalizeBillingMode','billingModeLabel','billingScopeLabel',
    `return (${namedFunction('renderToothPriceBreakdown')})`)(()=>box,Number,v=>String(v),String,()=>true,list,final,hint,()=>{},normalizeMode,value=>labels[normalizeMode(value)],scope=>({'arch:upper':'Arcada superioară','arch:lower':'Arcada inferioară',piece:'Piesă'}[scope]||`Dinte ${String(scope).slice(6)}`));
  renderer({saved:true,lines:[
    {work_type:'Crown',billing_mode:'per_arch',billing_scope:'arch:upper',quantity:1,unit_price:100,subtotal:100,contract:'Frozen',matched:true},
    {work_type:'Bridge',billing_mode:'per_piece',billing_scope:'piece',quantity:1,unit_price:250,subtotal:250,contract:'Frozen',matched:true}
  ],list_price:350,final_price:315,discount:10,element_count:5,billing_unit_count:2,matched_all:true});
  for(const value of ['Crown','Bridge','Per arcadă','Per piesă','Arcada superioară','Piesă','Tarif','100','250','350','315'])assert.ok(box.innerHTML.includes(value),`Missing ${value}`);
  assert.match(hint.textContent,/5 dinți selectați/);
  assert.match(hint.textContent,/2 unități facturabile/);
  assert.equal(final.value,315);
  renderer({saved:true,lines:[{work_type:'Crown',billing_mode:'per_tooth',billing_scope:'tooth:11',quantity:1,unit_price:100,subtotal:100,matched:true}],list_price:100,final_price:85,discount:0,element_count:1,billing_unit_count:1});
  assert.match(box.innerHTML,/Per dinte/);
  assert.ok(box.innerHTML.includes('Total înainte de discount'),'Saved list total must be visible even without a discount');
  const recalc=source.slice(source.indexOf('recalcFormPrice=function(){'),source.indexOf('fetchPatientCase=async function'));
  assert.match(recalc,/loadSavedWorkOrderPriceLines/);
  assert.doesNotMatch(recalc,/saved\.items/);
});

function managementPaymentPayload({id=42,loaded=['Paid','Paid','Paid'],selected=loaded,items=[{tooth_number:11,work_type:'Crown'}]}={}){
  const helper=source.slice(source.indexOf('async function saveManagementWorkOrderSupabase'),source.indexOf('async function handleSupabaseOrderSubmit'));
  const object=helper.slice(helper.indexOf('const payload={')+'const payload='.length,helper.indexOf('\n      };')+8);
  return Function('id','fields','labId','choices','currentOrderScope','caseDraftPayload','orderCaseDraft','paidModel','paidModeling','paidCerFin',`return (${object});`)(
    id,{Paid_Model:selected[0],Paid_Modelare:selected[1],Paid_Cer_Fin:selected[2]},'lab',{},()=>({items}),()=>({}),{},
    ...loaded.map(value=>({dataset:{originalValue:value}}))
  );
}

test('scope-only management edits leave every payment action unset',()=>{
  // Expansion leaves a new balance; contraction may leave an overpayment.
  // Neither scope change authorizes recording or reversing money.
  for(const items of [[{tooth_number:11,work_type:'Crown'},{tooth_number:12,work_type:'Crown'}],[{tooth_number:11,work_type:'Crown'}]]){
    for(const loaded of [['Paid','Paid','Paid'],['Not Paid','Not Paid','Not Paid']]){
      const payload=managementPaymentPayload({loaded,items});
      assert.equal(payload.p_paid_model,null);
      assert.equal(payload.p_paid_modelare,null);
      assert.equal(payload.p_paid_cer_fin,null);
      assert.deepEqual(payload.p_items,items);
    }
  }
});

test('management sends only changed payment selections and preserves initial create choices',()=>{
  const payload=managementPaymentPayload({loaded:['Paid','Not Paid','Paid'],selected:['Not Paid','Paid','Paid']});
  assert.equal(payload.p_paid_model,'Not Paid');
  assert.equal(payload.p_paid_modelare,'Paid');
  assert.equal(payload.p_paid_cer_fin,null);
  const created=managementPaymentPayload({id:null,selected:['Paid','Not Paid','Paid']});
  assert.equal(created.p_paid_model,'Paid');
  assert.equal(created.p_paid_modelare,'Not Paid');
  assert.equal(created.p_paid_cer_fin,'Paid');
});

test('payment comparison uses the selection loaded when the edit modal opens',()=>{
  const edit=source.slice(source.indexOf('async function editOrder('),source.indexOf('window.editOrder=editOrder;'));
  assert.match(edit,/\[paidModel,paidModeling,paidCerFin\]/);
  assert.match(edit,/dataset\.originalValue=.*\.value/);
  assert.match(source,/sbRpc\("set_stage_payment_status",\{p_lab_organization_id:labId,p_work_order_id:Number\(id\),p_stage:stage,p_paid_status:value\}\)/);
});
