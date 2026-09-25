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
