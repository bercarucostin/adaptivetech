const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../../website/app/public-prices/document.js');

const sample=()=>({schema:1,currency:'lei',intro_note:'N',footnote:'F',groups:[
 {title:'A',rows:[{item:'a1',amount:1},{item:'a2',amount:2}]},
 {title:'B',rows:[{item:'b1',amount:3}]}]});

test('an empty document is valid and publishable',()=>{
 const doc=D.emptyDocument();
 assert.deepEqual(D.validate(doc),[]);
 assert.equal(doc.schema,1);
});

test('operations never mutate their argument',()=>{
 const before=sample();
 const frozen=JSON.stringify(before);
 D.addGroup(before);D.addRow(before,0);D.removeRow(before,0,0);D.moveGroup(before,0,1);
 D.updateRow(before,0,0,{amount:99});D.setField(before,'currency','EUR');
 assert.equal(JSON.stringify(before),frozen);
});

test('a row moves within its group and stops at the edges',()=>{
 assert.deepEqual(D.moveRow(sample(),0,1,-1).groups[0].rows.map(r=>r.item),['a2','a1']);
 assert.deepEqual(D.moveRow(sample(),0,0,-1).groups[0].rows.map(r=>r.item),['a1','a2']);
 assert.deepEqual(D.moveRow(sample(),0,1,1).groups[0].rows.map(r=>r.item),['a1','a2']);
});

test('a group moves and stops at the edges',()=>{
 assert.deepEqual(D.moveGroup(sample(),1,-1).groups.map(g=>g.title),['B','A']);
 assert.deepEqual(D.moveGroup(sample(),0,-1).groups.map(g=>g.title),['A','B']);
 assert.deepEqual(D.moveGroup(sample(),1,1).groups.map(g=>g.title),['A','B']);
});

test('removing and adding rows and groups',()=>{
 assert.deepEqual(D.removeRow(sample(),0,0).groups[0].rows.map(r=>r.item),['a2']);
 assert.equal(D.addRow(sample(),1).groups[1].rows.length,2);
 assert.equal(D.addGroup(sample()).groups.length,3);
 assert.deepEqual(D.removeGroup(sample(),0).groups.map(g=>g.title),['B']);
});

test('an empty variant is dropped rather than stored as an empty string',()=>{
 const doc=D.updateRow(sample(),0,0,{variant:'  '});
 assert.equal('variant' in doc.groups[0].rows[0],false);
 assert.equal(D.updateRow(sample(),0,0,{variant:' IVOCLAR '}).groups[0].rows[0].variant,'IVOCLAR');
});

test('an amount typed as text becomes a number',()=>{
 assert.equal(D.updateRow(sample(),0,0,{amount:'250'}).groups[0].rows[0].amount,250);
 assert.equal(D.updateRow(sample(),0,0,{amount:'199,5'}).groups[0].rows[0].amount,199.5);
});

test('validation mirrors the database rules',()=>{
 const cases=[
  [{schema:1,currency:'lei',groups:[]},'groups'],
  [{schema:1,currency:'',groups:[{title:'A',rows:[]}]},'currency'],
  [{schema:1,currency:'lei',groups:[{title:'',rows:[]}]},'groups.0.title'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[]},{title:'A',rows:[]}]},'groups.1.title'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'',amount:1}]}]},'groups.0.rows.0.item'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:-1}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1.005}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1000001}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:NaN}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',intro_note:'x'.repeat(401),groups:[{title:'A',rows:[]}]},'intro_note'],
  [{schema:1,currency:'lei',groups:[{title:'x'.repeat(81),rows:[]}]},'groups.0.title'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x'.repeat(201),amount:1}]}]},'groups.0.rows.0.item'],
 ];
 for(const [doc,path] of cases){
  const errors=D.validate(doc);
  assert.ok(errors.some(e=>e.path===path),`expected an error at ${path}, got ${JSON.stringify(errors)}`);
 }
});

test('more than 200 rows is refused',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'A',rows:Array.from({length:201},(_,i)=>({item:'r'+i,amount:1}))}]};
 assert.ok(D.validate(doc).some(e=>e.path==='groups'));
});

test('a valid document produces no errors',()=>{
 assert.deepEqual(D.validate(sample()),[]);
});

test('currency as a number is rejected',()=>{
 const doc={schema:1,currency:123,groups:[{title:'A',rows:[]}]};
 const errors=D.validate(doc);
 assert.ok(errors.some(e=>e.path==='currency'),`expected an error at currency, got ${JSON.stringify(errors)}`);
});

test('group title as an object is rejected',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:{},rows:[]}]};
 const errors=D.validate(doc);
 assert.ok(errors.some(e=>e.path==='groups.0.title'),`expected an error at groups.0.title, got ${JSON.stringify(errors)}`);
});

test('row item as an array is rejected',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:[],amount:1}]}]};
 const errors=D.validate(doc);
 assert.ok(errors.some(e=>e.path==='groups.0.rows.0.item'),`expected an error at groups.0.rows.0.item, got ${JSON.stringify(errors)}`);
});

test('row footnote as a string is rejected',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1,footnote:'yes'}]}]};
 const errors=D.validate(doc);
 assert.ok(errors.some(e=>e.path==='groups.0.rows.0.footnote'),`expected an error at groups.0.rows.0.footnote, got ${JSON.stringify(errors)}`);
});

test('row footnote as true and null are valid',()=>{
 const doc1={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1,footnote:true}]}]};
 assert.deepEqual(D.validate(doc1).filter(e=>e.path==='groups.0.rows.0.footnote'),[]);
 const doc2={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1,footnote:null}]}]};
 assert.deepEqual(D.validate(doc2).filter(e=>e.path==='groups.0.rows.0.footnote'),[]);
});

test('intro_note as a number is rejected',()=>{
 const doc={schema:1,currency:'lei',intro_note:42,groups:[{title:'A',rows:[]}]};
 const errors=D.validate(doc);
 assert.ok(errors.some(e=>e.path==='intro_note'),`expected an error at intro_note, got ${JSON.stringify(errors)}`);
});

test('intro_note as null is valid',()=>{
 const doc={schema:1,currency:'lei',intro_note:null,groups:[{title:'A',rows:[]}]};
 assert.deepEqual(D.validate(doc).filter(e=>e.path==='intro_note'),[]);
});

test('group titled constructor is not a false duplicate',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'constructor',rows:[]}]};
 const errors=D.validate(doc);
 const titleErrors=errors.filter(e=>e.path==='groups.0.title' && e.message.includes('Două grupuri'));
 assert.deepEqual(titleErrors,[],`constructor should not be flagged as duplicate, got ${JSON.stringify(errors)}`);
});

test('group titled __proto__ is not a false duplicate',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'__proto__',rows:[]}]};
 const errors=D.validate(doc);
 const titleErrors=errors.filter(e=>e.path==='groups.0.title' && e.message.includes('Două grupuri'));
 assert.deepEqual(titleErrors,[],`__proto__ should not be flagged as duplicate, got ${JSON.stringify(errors)}`);
});

test('schema as the string "1" is rejected',()=>{
 const doc={schema:'1',currency:'lei',groups:[{title:'A',rows:[]}]};
 const errors=D.validate(doc);
 assert.ok(errors.some(e=>e.path==='schema'),`expected an error at schema, got ${JSON.stringify(errors)}`);
});

// Regression: the old two-decimal check multiplied first
// (Math.round(amount*100) !== amount*100), and binary floating point put the
// product a hair off an integer for roughly one valid price in ten -- 32.05*100
// is 3204.9999999999995. Every such price disabled the publish button on a
// document the database would have accepted, with nothing the manager could do
// about it.
test('two-decimal prices the old float comparison falsely rejected are valid',()=>{
 for(const amount of [32.02,32.05,32.09,32.12,199.5,1004.99,7000]){
  const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount}]}]};
  assert.deepEqual(D.validate(doc),[],`${amount} should be a valid price`);
 }
});

test('more than two decimals is still rejected',()=>{
 for(const amount of [32.055,0.005,1.001,99.999,0.125]){
  const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount}]}]};
  assert.ok(D.validate(doc).some(e=>e.path==='groups.0.rows.0.amount'),`${amount} should be rejected`);
 }
});

test('no valid two-decimal price between 0 and 7000 is falsely rejected',()=>{
 let falsely=0;
 for(let cents=0;cents<=700000;cents++){
  const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:cents/100}]}]};
  if(D.validate(doc).length)falsely++;
 }
 assert.equal(falsely,0,`${falsely} valid two-decimal prices were falsely rejected`);
});

test('variant as a number is rejected, matching the SQL type gate',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1,variant:123}]}]};
 assert.ok(D.validate(doc).some(e=>e.path==='groups.0.rows.0.variant'),
  `expected an error at groups.0.rows.0.variant, got ${JSON.stringify(D.validate(doc))}`);
});

test('a row currency that is a number is rejected, matching the SQL type gate',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1,currency:5}]}]};
 assert.ok(D.validate(doc).some(e=>e.path==='groups.0.rows.0.currency'),
  `expected an error at groups.0.rows.0.currency, got ${JSON.stringify(D.validate(doc))}`);
});

test('a corrupt group reports an error instead of throwing',()=>{
 for(const group of [null,undefined,'A',7]){
  const doc={schema:1,currency:'lei',groups:[group]};
  let errors;
  assert.doesNotThrow(()=>{errors=D.validate(doc);},`validate threw on a group of ${JSON.stringify(group)}`);
  assert.ok(errors.some(e=>e.path==='groups.0'),`expected an error at groups.0, got ${JSON.stringify(errors)}`);
 }
});

test('a corrupt row reports an error instead of throwing',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'A',rows:[null]}]};
 let errors;
 assert.doesNotThrow(()=>{errors=D.validate(doc);},'validate threw on a null row');
 assert.ok(errors.some(e=>e.path==='groups.0.rows.0'),`expected an error at groups.0.rows.0, got ${JSON.stringify(errors)}`);
});
