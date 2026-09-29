const test=require('node:test'),assert=require('node:assert/strict');
const io=require('../../website/app/spreadsheet-io.js');
const XLSX=require('../../website/app/vendor/xlsx-0.20.3.full.min.js');
const dataset={headers:['ID','Contract','Tip_Lucrare','Pret'],rows:[['00012','Clinic; Știință','Coroană, "test"',1250.50],['9007199254740993','=not a formula','Punte',0]]};
test('XLSX export/import preserves text IDs, Unicode and numeric prices',()=>{
 const bytes=io.write(dataset);const result=io.readXlsx(bytes);
 assert.equal(result.rows[0].ID,'00012');assert.equal(result.rows[0].Pret,1250.5);assert.equal(result.rows[1].ID,'9007199254740993');assert.equal(result.rows[1].Contract,'=not a formula');
 const wb=XLSX.read(bytes,{type:'array'});assert.equal(wb.Sheets.Date.A2.t,'s');assert.equal(wb.Sheets.Date.D2.t,'n');assert.equal(wb.Sheets.Date.B3.f,undefined);
});
test('CSV recognizes delimiters, quoted semicolons, multiline cells and Excel sep hint',()=>{
 for(const sep of [';',',','\t']){const result=io.readCsv('sep='+sep+'\r\nID'+sep+'Tip_Lucrare\r\n0001'+sep+'"Coroană; text\naltă linie"');assert.equal(result.rows[0].ID,'0001');assert.equal(result.rows[0].Tip_Lucrare,'Coroană; text\naltă linie');}
});
test('malformed CSV and duplicate headings are rejected, never silently truncated',()=>{
 for(const text of ['ID;ID\n1;2','ID;Cost\n1;2;3','ID;Cost\n1;"unfinished'])assert.throws(()=>io.readCsv(text));
});
test('formulas and numeric IDs that already lost precision are rejected with cell location',()=>{
 for(const cell of [{t:'n',v:3,f:'SUM(1,2)'},{t:'n',v:9007199254740992}]){
 const ws=XLSX.utils.aoa_to_sheet([['ID','Cost'],['1',2]]);ws.A2=cell;const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Date');assert.throws(()=>io.readXlsx(XLSX.write(wb,{type:'array',bookType:'xlsx'})),/A2/);
 }
});
test('multiple sheets and excessive rows require user correction',()=>{
 const wb=XLSX.utils.book_new();for(const name of ['One','Two'])XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['ID','Cost'],['1',2]]),name);
 assert.throws(()=>io.readXlsx(XLSX.write(wb,{type:'array',bookType:'xlsx'})),/foaie/);
 assert.throws(()=>io.readCsv('ID;Cost\n'+'1;2\n'.repeat(10001)),/10000/);
});
