const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('website/app/app.js','utf8');
let report='';
const context=vm.createContext({
 URL,normalize:value=>String(value).toLowerCase(),escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 uiText:String,fmtDate:String,setTimeout:()=>{},alert:message=>{throw Error(message);},
 window:{location:{href:'https://example.test/app/'},open:()=>({document:{open(){},write(html){report=html;},close(){}},focus(){},print(){}})}
});
vm.runInContext(source.slice(source.indexOf('const FDI_UPPER='),source.indexOf('async function fetchPatientCase(')),context);
vm.runInContext(source.slice(source.indexOf('function orderedSelectedTeeth('),source.indexOf('function selectedToothRowHtml(')),context);
// Include legacy renderer if present so the regression runs before the fix too.
const legacy=source.indexOf('function caseSheetSimpleToothShape(');
vm.runInContext(source.slice(legacy<0?source.indexOf('function renderPhysicalCaseSheet('):legacy,source.indexOf('async function printCaseSheet(')),context);
const order={id:42,patient:'Test patient',partner:'Test partner',deadline:'2026-09-24',elements:3};
const draft={selected:[46,45,44],perTooth:{46:{type:'Crown'},45:{type:'Coping'},44:{type:'Crown'}},connections:[[46,45]],notes:'Test note'};
context.order=order;context.draft=draft;

test('printed case sheet uses exactly the current readonly web chart',()=>{
 assert.equal(vm.runInContext('renderPhysicalCaseSheet(order,draft)',context),true);
 const printed=report.match(/<svg[\s\S]*?<\/svg>/)?.[0];
 const web=vm.runInContext('dentalChartSvg(orderedSelectedTeeth(draft.selected),false,{details:draft.perTooth,colorByType:true,connections:draft.connections})',context);
 assert.equal(printed,web);
 assert.equal((printed.match(/data-tooth="/g)||[]).length,32);
 assert.equal((printed.match(/data-tooth-connection=/g)||[]).length,30);
 assert.match(printed,/data-tooth-connection="46-45" aria-checked="true"/);
 assert.doesNotMatch(printed,/role="(?:button|checkbox)"|tabindex=/);
});

test('old case sheets without connection metadata still export',()=>{
 context.draft={...draft,connections:undefined};
 assert.equal(vm.runInContext('renderPhysicalCaseSheet(order,draft)',context),true);
 assert.match(report,/Test patient/);
 assert.match(report,/Test note/);
 assert.match(report,/Solo/);
});
