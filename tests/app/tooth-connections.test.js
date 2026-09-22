const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('website/app/app.js','utf8');
const context=vm.createContext({auth:{user:{}},escapeHtml:String,workTypeColor:()=> '#ff7900'});
vm.runInContext(source.slice(source.indexOf('const FDI_UPPER='),source.indexOf('function hasMeaningfulCaseData(')),context);
vm.runInContext(source.slice(source.indexOf('const TOOTH_LAYOUT='),source.indexOf('function selectedToothRowHtml(')),context);
const run=code=>JSON.parse(JSON.stringify(vm.runInContext(code,context)));

test('connections follow arch adjacency including midlines, never crossing arches or gaps',()=>{
 assert.equal(vm.runInContext('typeof normalizeToothConnections',context),'function');
 assert.deepEqual(run('normalizeToothConnections([[21,11],[11,21],[41,31],[18,48],[28,38],[46,44]], [11,21,41,31,18,48,28,38,46,44])'),[[11,21],[41,31]]);
});
test('batch joins only selected neighbors and preserves unrelated connections',()=>{
 assert.equal(vm.runInContext('typeof setSelectedToothConnections',context),'function');
 assert.deepEqual(run('setSelectedToothConnections([[11,21]], [46,45,44,42,41], true)'),[[11,21],[46,45],[45,44],[42,41]]);
 assert.deepEqual(run('setSelectedToothConnections([[46,45],[45,44],[11,21]], [45,44], false)'),[[11,21],[46,45]]);
});
test('removing a middle tooth splits the group and produces solo endpoints',()=>{
 assert.equal(vm.runInContext('typeof toothConnectionGroups',context),'function');
 assert.deepEqual(run('toothConnectionGroups([46,45,44,11], [[46,45],[45,44]])'),[[11],[46,45,44]]);
 assert.deepEqual(run('toothConnectionGroups([46,44,11], [[46,45],[45,44]])'),[[11],[46],[44]]);
});
test('clinical payload persists connections and unrelated case metadata, pruning removed teeth',()=>{
 const result=run('caseDraftPayload({selected:[46,45],perTooth:{46:{type:"Crown"},45:{type:"Crown"}},connections:[[46,45],[45,44]],caseMetadata:{methodHint:"keep"}})');
 assert.deepEqual(result.tooth_details.__case,{methodHint:'keep',tooth_connections:[[46,45]]});
});
test('reload restores connections, while old cases default to solo',()=>{
 vm.runInContext('function orderedSelectedTeeth(teeth){return [...FDI_UPPER,...FDI_LOWER].filter(t=>teeth.includes(t));}',context);
 const loaded=run('draftFromServerCase({id:1,items:[{tooth_number:46,work_type:"Crown"},{tooth_number:45,work_type:"Crown"}]},{case_snapshot:{tooth_connections:[[46,45]],custom:"keep"},tooth_details:{}})');
 assert.deepEqual(loaded.connections,[[46,45]]);
 assert.equal(loaded.caseMetadata.custom,'keep');
 assert.deepEqual(run('draftFromServerCase({id:2},null)').connections,[]);
});
test('chart exposes 30 accessible pair controls, checked state and disabled unconfigured pairs',()=>{
 const svg=run('dentalChartSvg([46,45],true,{connections:[[46,45]]})');
 assert.equal((svg.match(/data-tooth-connection=/g)||[]).length,30);
 assert.match(svg,/data-tooth-connection="46-45"[^>]*aria-checked="true"[^>]*aria-disabled="false"/);
 assert.match(svg,/data-tooth-connection="45-44"[^>]*aria-checked="false"[^>]*aria-disabled="true"/);
 assert.doesNotMatch(svg,/data-tooth-connection="(?:18-48|28-38)"/);
 const readonly=run('dentalChartSvg([46,45],false,{connections:[[46,45]]})');
 assert.doesNotMatch(readonly,/role="checkbox"/);
});

test('only changes between actively selected teeth affect the connection preview',()=>{
 assert.equal(vm.runInContext('typeof previewToothConnections',context),'function');
 assert.deepEqual(run('previewToothConnections([[11,21]], {"46-45":true}, [])'),[[11,21]]);
 assert.deepEqual(run('previewToothConnections([[11,21]], {"46-45":true}, [46])'),[[11,21]]);
 assert.deepEqual(run('previewToothConnections([[11,21]], {"46-45":true}, [46,45])'),[[11,21],[46,45]]);
 assert.deepEqual(run('previewToothConnections([[46,45],[45,44]], {"46-45":false}, [46,45])'),[[45,44]]);
});
