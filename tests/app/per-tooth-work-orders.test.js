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
    'deriveWorkOrderScope','num','isDoctor','isTechnician','normalize','boolish','auth',
    `return (${namedFunction('mapSupabaseOrder')})`
  )(
    toothScope,
    value=>Number(value)||0,
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
  assert.match(mapper,/num\(r\.cost_model\)/);
  assert.match(mapper,/num\(r\.cost_modelare\)/);
  assert.match(mapper,/num\(r\.cost_cer_fin\)/);
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

test('saved prices render per-tooth snapshots and frozen aggregate totals',()=>{
  const box={innerHTML:''},list={value:null},final={value:null};
  const hint={textContent:'',classList:{add(){},remove(){}}};
  const renderer=Function('$','num','money','escapeHtml','isManagement','listPrice','finalPrice','priceHint','setFormContractValue',
    `return (${namedFunction('renderToothPriceBreakdown')})`)(()=>box,Number,v=>String(v),String,()=>true,list,final,hint,()=>{});
  renderer({saved:true,lines:[{tooth_number:11,work_type:'Crown',quantity:1,unit_price:100,line_total:100,contract:'Frozen',matched:true},
    {tooth_number:21,work_type:'Bridge',quantity:1,unit_price:250,line_total:250,contract:'Frozen',matched:true}],
    list_price:350,final_price:315,discount:10,element_count:2,matched_all:true});
  for(const value of ['11','21','Crown','Bridge','100','250','350','315'])assert.ok(box.innerHTML.includes(value),`Missing ${value}`);
  assert.equal(final.value,315);
  renderer({saved:true,lines:[{tooth_number:11,work_type:'Crown',unit_price:100,line_total:100,matched:true}],list_price:100,final_price:85,discount:0});
  assert.ok(box.innerHTML.includes('Total înainte de discount'),'Saved list total must be visible even without a discount');
  const recalc=source.slice(source.indexOf('recalcFormPrice=function(){'),source.indexOf('fetchPatientCase=async function'));
  assert.match(recalc,/renderToothPriceBreakdown\(\{[\s\S]*saved\.items/);
  assert.doesNotMatch(recalc.slice(0,recalc.indexOf('const items=')),/box\.innerHTML=""/);
});
