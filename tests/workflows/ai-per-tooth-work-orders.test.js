const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const workflow=JSON.parse(fs.readFileSync(path.join(__dirname,'../../workflows/Flowrise Dental - AI Client V17.4.json'),'utf8'));
const node=name=>workflow.nodes.find(item=>item.name===name);
const parseFinal=new Function('$json','$',node('AI - Parse Final').parameters.jsCode);

function parse(plan,{role='manager',pending=null}={}){
  const input={
    client_request_id:'per-tooth-request',
    session_id:'per-tooth-session',
    pending_operation:pending
  };
  const bootstrap={role};
  const result=parseFinal(
    {text:JSON.stringify(plan)},
    name=>({first:()=>({json:name==='AI - Unified'?input:bootstrap})})
  );
  return result[0].json;
}

test('parser keeps a configured tooth-item scope for Work Order create and update',()=>{
  const items=[
    {tooth_number:11,work_type:'Coroană ceramică'},
    {tooth_number:12,work_type:'Fațetă'}
  ];
  const created=parse({
    intent:'create',
    reply:'Creez lucrarea.',
    payload:{fields:{Nume_Pacient:'Ana Pop',Nume_Partener:'Dr. Ionescu',items,case:{clinic_note:'Control inițial'},My_Stage:'Model'}}
  });
  const updated=parse({
    intent:'update',
    reply:'Actualizez dinții.',
    payload:{ids:[42],fields:{items}}
  });

  assert.equal(created.intent,'create');
  assert.deepEqual(created.payload.fields.items,items);
  assert.deepEqual(created.payload.fields.case,{clinic_note:'Control inițial'});
  assert.equal(updated.intent,'update');
  assert.deepEqual(updated.payload.fields.items,items);
});

test('parser rejects Work Order scope changes without a configured tooth item',()=>{
  const created=parse({
    intent:'create',
    reply:'Creez lucrarea.',
    payload:{fields:{Nume_Pacient:'Ana Pop',Nume_Partener:'Dr. Ionescu'}}
  });
  const updated=parse({
    intent:'update',
    reply:'Actualizez lucrarea.',
    payload:{ids:[42],fields:{items:[]}}
  });

  assert.equal(created.intent,'clarify');
  assert.equal(updated.intent,'clarify');
});

test('parser rejects clinical material and scalar type/count fields in Work Order payloads',()=>{
  const parsed=parse({
    intent:'create',
    reply:'Creez lucrarea.',
    payload:{fields:{
      Nume_Pacient:'Ana Pop',
      Nume_Partener:'Dr. Ionescu',
      Tip_Lucrare:'Coroană ceramică',
      Nr_Elemente:2,
      material:'Zirconiu',
      items:[{tooth_number:11,work_type:'Coroană ceramică'}]
    }}
  });

  assert.equal(parsed.intent,'clarify');
});

test('parser canonicalizes the accepted clinical case contract and scrubs nested material',()=>{
  const fields={Nume_Pacient:'Ana Pop',Nume_Partener:'Dr. Ionescu',
    items:[{tooth_number:11,work_type:'Coroană ceramică',material:'Zirconiu',shade:'A2'}],
    case:{clinic_note:'Control inițial',shade:'A2',method:'Scan',production_notes:'Lab',
      tooth_details_json:JSON.stringify({'11':{material:'Metal',details:{Material:'Compozit',shade:'A2'}},
        __case:{material:'Ceramică',nested:{MATERIAL:'Rășină',shade:'A1'}}})}};
  const direct=parse({intent:'create',reply:'Creez lucrarea.',payload:{fields}});
  const typed=parse({intent:'preview',reply:'Previzualizez lucrarea.',
    operation:{entity:'work_order',operation:'create',target:{},fields}},{role:'admin'});
  const expectedItems=[{tooth_number:11,work_type:'Coroană ceramică'}];
  const expectedCase={clinic_note:'Control inițial',shade:'A2',method:'Scan',production_notes:'Lab',
    tooth_details:{'11':{details:{shade:'A2'}},__case:{nested:{shade:'A1'}}}};
  assert.deepEqual(direct.payload.fields.items,expectedItems);
  assert.deepEqual(direct.payload.fields.case,expectedCase);
  assert.deepEqual(typed.operation.fields.items,expectedItems);
  assert.deepEqual(typed.operation.fields.case,expectedCase);
});

test('parser rejects unsupported clinical fields and malformed tooth-detail maps',()=>{
  for(const caseData of [{notes:'lost'},{tooth_data:{}},{material:'lost'},{selected_teeth:[11]},
    {tooth_details:[]},{tooth_details_json:'not JSON'},{tooth_details:{'11':[]}},
    {tooth_details:{},tooth_details_json:{}},{shade:{value:'A2'}}]){
    const fields={items:[{tooth_number:11,work_type:'Crown'}],case:caseData};
    assert.equal(parse({intent:'create',payload:{fields}}).intent,'clarify',JSON.stringify(caseData));
    assert.equal(parse({intent:'preview',operation:{entity:'work_order',operation:'create',fields}},
      {role:'admin'}).intent,'clarify',JSON.stringify(caseData));
  }
});

test('technician may submit an item-only Work Order scope update',()=>{
  const parsed=parse({
    intent:'update',
    reply:'Actualizez dinții.',
    payload:{ids:[42],fields:{items:[{tooth_number:21,work_type:'Coroană ceramică'}]}}
  },{role:'technician'});

  assert.equal(parsed.intent,'update');
  assert.deepEqual(parsed.payload.fields.items,[{tooth_number:21,work_type:'Coroană ceramică'}]);
  assert.match(node('AI - Role Safe Mutation?').parameters.conditions.conditions[0].leftValue,/\["create","update"\]\.includes\(\$json\.intent\)/);
  assert.match(node('AI - Build Retrieval Plan').parameters.jsCode,/UPDATE configured tooth items/);
});

test('typed Work Order previews require tooth items for a create',()=>{
  const accepted=parse({
    intent:'preview',
    reply:'Previzualizez lucrarea.',
    operation:{
      entity:'work_order',
      operation:'create',
      target:{},
      fields:{items:[{tooth_number:31,work_type:'Coroană ceramică'}]}
    }
  },{role:'admin'});
  const rejected=parse({
    intent:'preview',
    reply:'Previzualizez lucrarea.',
    operation:{entity:'work_order',operation:'create',target:{},fields:{items:[]}}
  },{role:'admin'});

  assert.equal(accepted.intent,'preview');
  assert.deepEqual(accepted.operation.fields.items,[{tooth_number:31,work_type:'Coroană ceramică'}]);
  assert.equal(rejected.intent,'clarify');
});

test('prompt documents tooth items and preserves stock-material commands',()=>{
  const prompt=node('AI - Build Final Prompt').parameters.jsCode;
  assert.doesNotMatch(prompt,/notes\?,tooth_data\?|"case":\{"notes"/);
  assert.match(prompt,/clinic_note/);
  assert.match(prompt,/tooth_details_json/);
  assert.match(prompt,/items:\[\{tooth_number,work_type\}\]/);
  assert.doesNotMatch(prompt,/Tip_Lucrare/);
  assert.doesNotMatch(prompt,/Nr_Elemente/);
  assert.match(prompt,/never supply a general work type, clinical material, or element count/);
  assert.match(prompt,/material add\|subtract/);
  assert.match(prompt,/material set/);
});

test('AI rejects malformed or nonadjacent connections and canonicalizes reversed pairs',()=>{
 for(const edges of [null,{},[[18,48]],[[46,44]],[[11,11]],[[11,21,22]],[["11",21]]]){
  const fields={case:{tooth_details:{__case:{tooth_connections:edges}}}};
  assert.equal(parse({intent:'update',payload:{ids:[42],fields}}).intent,'clarify',JSON.stringify(edges));
  assert.equal(parse({intent:'preview',operation:{entity:'work_order',operation:'update',target:{id:42},fields}},{role:'admin'}).intent,'clarify');
 }
 const fields={case:{tooth_details:{__case:{tooth_connections:[[21,11],[11,21],[45,46]]}}}};
 const result=parse({intent:'update',payload:{ids:[42],fields}});
 assert.deepEqual(result.payload.fields.case.tooth_details.__case.tooth_connections,[[11,21],[46,45]]);
});
