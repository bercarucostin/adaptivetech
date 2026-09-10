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
  const bodyStart=source.indexOf('{',start);
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
    'update_management_work_order_v188',
    'save_my_work_order_case'
  ]){
    const callStart=source.indexOf(`sbRpc("${rpc}"`);
    assert.notEqual(callStart,-1,`Missing ${rpc} call.`);
    const call=source.slice(callStart,callStart+1800);
    assert.match(call,/p_items:/,`${rpc} must send p_items.`);
    assert.match(call,/p_case:/,`${rpc} must send p_case.`);
  }
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
