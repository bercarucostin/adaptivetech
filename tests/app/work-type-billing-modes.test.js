const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const appPath=path.join(__dirname,'../../website/app/app.js');
const source=fs.readFileSync(appPath,'utf8');

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

test('billing-mode controls expose exactly the three Romanian choices',()=>{
  const labels={per_tooth:'Per dinte',per_arch:'Per arcadă',per_piece:'Per piesă'};
  const normalizeBillingMode=Function('BILLING_MODE_LABELS',`return (${namedFunction('normalizeBillingMode')})`)(labels);
  const selector=Function('escapeHtml','normalizeBillingMode','BILLING_MODE_LABELS',`return (${namedFunction('billingModeSelectHtml')})`)(String,normalizeBillingMode,labels);
  const html=selector('mode','per_arch');
  assert.equal((html.match(/<option /g)||[]).length,3);
  assert.match(html,/<option value="per_tooth"[^>]*>Per dinte<\/option>/);
  assert.match(html,/<option value="per_arch" selected>Per arcadă<\/option>/);
  assert.match(html,/<option value="per_piece"[^>]*>Per piesă<\/option>/);
});

test('work-type CSV rows default blank mode and reject unknown modes',()=>{
  const keyNormalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
  const csvValue=Function('normalize',`return (${namedFunction('csvValue')})`)(keyNormalize);
  const labels={per_tooth:'Per dinte',per_arch:'Per arcadă',per_piece:'Per piesă'};
  const normalizeBillingMode=Function('BILLING_MODE_LABELS',`return (${namedFunction('normalizeBillingMode')})`)(labels);
  const rows=Function('csvValue','normalizeBillingMode',`return (${namedFunction('parseWorkTypeCsvRows')})`)(csvValue,normalizeBillingMode)([
    {ID:'1',Tip_Lucrare:'Coroană',Active:'true',Billing_Mode:''},
    {ID:'2',Tip_Lucrare:'Punte',Active:'false',Billing_Mode:'per_arch'}
  ]);
  assert.deepEqual(rows.map(row=>row.billing_mode),['per_tooth','per_arch']);
  assert.throws(
    ()=>Function('csvValue','normalizeBillingMode',`return (${namedFunction('parseWorkTypeCsvRows')})`)(csvValue,normalizeBillingMode)([
      {ID:'3',Tip_Lucrare:'Gutieră',Active:'true',Billing_Mode:'monthly'}
    ]),
    /Billing_Mode invalid/
  );
});

test('Admin work-type CRUD and CSV carry billing_mode',()=>{
  assert.match(source,/select\("id,tip_lucrare,active,billing_mode"\)/);
  assert.match(source,/headers:\["ID","Tip_Lucrare","Active","Billing_Mode"\]/);
  assert.match(source,/adminCreateWorkType[\s\S]*Billing_Mode:/);
  assert.match(source,/adminSaveWorkType[\s\S]*Billing_Mode:/);
  assert.match(source,/lab_work_types"\)\.insert\([\s\S]*billing_mode:/);
  assert.match(source,/lab_work_types"\)\.update\([\s\S]*billing_mode:/);
});

test('saved work orders load guarded frozen price lines and technicians never request them',()=>{
  const loader=namedFunction('loadSavedWorkOrderPriceLines');
  assert.match(loader,/isTechnician\(\)/);
  assert.match(loader,/sbRpc\("get_work_order_price_lines"/);
  const recalc=source.slice(source.indexOf('recalcFormPrice=function(){'),source.indexOf('fetchPatientCase=async function'));
  assert.match(recalc,/loadSavedWorkOrderPriceLines/);
  assert.doesNotMatch(recalc,/saved\.items/);
});
