const test=require('node:test'),assert=require('node:assert/strict');
const {prepare}=require('../../website/app/spreadsheet-import.js');
test('validation reports original row and rejects missing/unknown columns',()=>{
 let p=prepare('prices',{headers:['Contract','Tip_Lucrare','Pret'],rows:[{Contract:'C',Tip_Lucrare:'T',Pret:'-1'}],rowNumbers:[5]});assert.match(p.errors[0],/5/);
 p=prepare('prices',{headers:['Contract','Tip_Lucrare','Prte'],rows:[],rowNumbers:[]});assert.ok(p.errors.some(e=>e.includes('Pret')));
});
test('prices parse decimal comma; text IDs and blank cost remain unchanged',()=>{
 const p=prepare('prices',{headers:['ID','Contract','Tip_Lucrare','Pret'],rows:[{ID:'0001',Contract:'C',Tip_Lucrare:'T',Pret:'1.234,56'}],rowNumbers:[2]});assert.deepEqual(p.errors,[]);assert.equal(p.rows[0].pret,1234.56);assert.equal(p.rows[0].id,'0001');
 const c=prepare('costs',{headers:['ID','Tehnician','Tip_Lucrare','Etapa','Cost'],rows:[{ID:'0008',Tehnician:'A',Tip_Lucrare:'T',Etapa:'Model',Cost:''}],rowNumbers:[2]});assert.deepEqual(c.errors,[]);assert.equal(c.rows[0].cost,'');assert.equal(c.rows[0].legacy_id,'0008');
});
test('duplicate IDs and invalid booleans are blocked before import',()=>{
 const p=prepare('types',{headers:['ID','Tip_Lucrare','Active'],rows:[{ID:'01',Tip_Lucrare:'A',Active:'false'},{ID:'1',Tip_Lucrare:'B',Active:'maybe'}],rowNumbers:[2,3]});assert.equal(p.rows[0].active,'false');assert.ok(p.errors.some(e=>e.includes('Active')));assert.ok(p.errors.some(e=>e.includes('duplicat')));
});
