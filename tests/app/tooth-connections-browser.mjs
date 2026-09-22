// Generate a disposable browser fixture from the production chart and popover.
// node tests/app/tooth-connections-browser.mjs /tmp/tooth-connections.html
import fs from 'node:fs';
const app=fs.readFileSync('website/app/app.js','utf8');
const html=fs.readFileSync('website/app/index.html','utf8');
const css=fs.readFileSync('website/app/styles.css','utf8');
function fn(name){
 const start=app.indexOf(`function ${name}(`);
 const end=app.indexOf('\nfunction ',start+1);
 return app.slice(start,end);
}
const popover=html.slice(html.indexOf('<div id="orderToothPopover"'),html.indexOf('\n              </main>',html.indexOf('<div id="orderToothPopover"')));
const names=['orderedActiveTeeth','commonBatchField','syncOrderJoinTeethControl','openOrderToothPopover','saveOrderToothPopover','removeActiveOrderTooth','closeOrderToothPopover','renderOrderToothPicker'];
const code=app.slice(app.indexOf('const FDI_UPPER='),app.indexOf('function hasMeaningfulCaseData('))+
 app.slice(app.indexOf('function orderedSelectedTeeth('),app.indexOf('function selectedToothRowHtml('))+names.map(fn).join('\n');
const ids=['orderToothChart','orderToothPopover','orderToothPopoverTitle','orderToothPopoverMeta','orderToothPreview','orderToothType','orderToothShade','orderToothNote','orderJoinTeeth','orderJoinTeethWrap','orderApplySameShade','orderSameShadeWrap','orderToothTypeSuggestions','orderToothRemoveBtn','orderToothSaveBtn'];
const setup=`
const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const normalize=value=>String(value||'').toLowerCase();
const auth={user:{}};
let readOnly=false,orderCaseDraft,activeOrderTooth,activeOrderToothAnchor,activeOrderTeeth=[],activeOrderMixedFields=new Set();
const orderToothViewMode='upperlower';
const orderShade=null,orderMethod=null,orderClinicNote={},orderProductionNotes={};
${ids.map(id=>`const ${id}=$('${id}');`).join('\n')}
// Unrelated modal placement, pricing and request side effects are outside this fixture.
const syncOrderCaseDraftFromInputs=()=>{},syncBatchToothHighlight=()=>{},positionOrderToothPopover=()=>{},updateToothDetailBadge=()=>{},renderOrderToothDetails=()=>{},updateOrderToothDerivedScope=()=>{},renderOrderWorkTypeLegend=()=>{};
const batchPreviewHtml=teeth=>teeth.join(', '),toothLabel=String,doctorModalReadOnly=()=>readOnly;
`;
const checks=`
const results=[];
const check=(ok,message)=>{if(!ok)throw Error(message);results.push(message);};
const edge=key=>orderToothChart.querySelector('[data-tooth-connection="'+key+'"]');
const links=()=>JSON.stringify(orderCaseDraft.connections);
try{
 orderJoinTeeth.addEventListener('change',()=>{orderJoinTeeth.dataset.changed='true';});
 orderToothSaveBtn.addEventListener('click',saveOrderToothPopover);
 orderCaseDraft={selected:[46],perTooth:{46:{type:'Crown',shade:'A2'}},connections:[]};
 renderOrderToothPicker();openOrderToothPopover(46);
 orderToothType.value='Bridge';orderToothNote.value='pending note';orderToothShade.value='A3';
 edge('46-45').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 check(orderToothType.value==='Bridge'&&orderToothNote.value==='pending note','Expanding selection preserves pending type and note');
 check(orderToothShade.value==='A3'&&orderApplySameShade.checked,'Expanding selection preserves pending shade');
 orderToothSaveBtn.click();
 check(orderCaseDraft.perTooth[45].type==='Bridge'&&orderCaseDraft.perTooth[45].note==='pending note'&&orderCaseDraft.perTooth[45].shade==='A3','Pending edits save to expanded selection');
 orderCaseDraft={selected:[11,21,46,45,44],perTooth:Object.fromEntries([11,21,46,45,44].map(t=>[t,{type:'Crown',shade:'A2'}])),connections:[]};
 renderOrderToothPicker();
 edge('46-45').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 check(links()==='[[46,45]]','Click creates adjacent link');
 edge('45-44').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
 check(links()==='[[46,45],[45,44]]','Keyboard extends connected group');
 edge('44-43').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 check(links()==='[[46,45],[45,44],[44,43]]','Direct point includes unconfigured endpoint and joins it');
 check(orderCaseDraft.selected.includes(43),'New endpoint belongs to draft');
 check(!orderToothPopover.classList.contains('hidden'),'New endpoint opens configuration');
 check(edge('44-43').getAttribute('aria-checked')==='true','New connection turns green immediately');
 edge('44-43').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 closeOrderToothPopover();
 edge('45-44').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 openOrderToothPopover(46,null,{batch:[46,45,44]});
 check(orderJoinTeeth.indeterminate,'Partial group opens mixed checkbox');
 orderToothNote.value='keep links';orderToothSaveBtn.click();
 check(links()==='[[46,45]]','Saving notes leaves mixed links unchanged');
 openOrderToothPopover(46,null,{batch:[46,45,44]});orderJoinTeeth.click();orderToothSaveBtn.click();
 check(links()==='[[46,45],[45,44]]','Checking batch joins neighbors');
 openOrderToothPopover(45,null,{batch:[45,44]});orderJoinTeeth.click();orderToothSaveBtn.click();
 check(links()==='[[46,45]]','Unchecking batch preserves external link');
 const before=links();readOnly=true;renderOrderToothPicker();
 edge('46-45').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 check(links()===before,'Readonly blocks link mutation');readOnly=false;
 openOrderToothPopover(45);removeActiveOrderTooth();
 check(links()==='[]','Removing tooth clears incident links');
 orderCaseDraft.selected.push(45);orderCaseDraft.perTooth[45]={type:'Crown'};renderOrderToothPicker();
 check(links()==='[]','Readding removed tooth does not resurrect links');
 orderCaseDraft.selected=[...FDI_UPPER,...FDI_LOWER];
 orderCaseDraft.connections=[[46,45],[45,44],[44,43],[43,42],[42,41],[41,31],[31,32],[32,33],[33,34],[34,35],[35,36]];
 renderOrderToothPicker();
 for(const control of orderToothChart.querySelectorAll('[data-tooth-connection]')){
  const p=control.transform.baseVal.consolidate().matrix;
  check(p.e-11>=0&&p.e+11<=474&&p.f-11>=-26&&p.f+11<=800,'Control fits viewBox: '+control.dataset.toothConnection);
 }
 const payload=caseDraftPayload(orderCaseDraft);
 const restored=draftFromServerCase({id:1,items:orderCaseDraft.selected.map(tooth_number=>({tooth_number,work_type:'Crown'}))},{tooth_details:payload.tooth_details,case_snapshot:payload.tooth_details.__case});
 check(JSON.stringify(restored.connections)===links(),'Round trip retains connected groups');
 openOrderToothPopover(46,null,{batch:[46,45,44]});
 orderToothNote.value='unsaved note';
 edge('46-45').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 check(orderToothNote.value==='unsaved note'&&!orderToothPopover.classList.contains('hidden'),'Direct point preserves open popover edits');
 for(const checkbox of [orderJoinTeeth,orderApplySameShade]){
  const style=getComputedStyle(checkbox),row=getComputedStyle(checkbox.parentElement);
  check(style.width==='15px'&&style.height==='15px','Checkbox is compact');
  check(style.accentColor==='rgb(22, 148, 71)','Checkbox uses green accent');
  check(row.display==='flex'&&row.alignItems==='center','Checkbox aligns with label');
 }
 document.getElementById('result').textContent='PASS '+results.length+' browser assertions';
 document.body.dataset.result='pass';
}catch(error){document.getElementById('result').textContent='FAIL '+error.stack;document.body.dataset.result='fail';}
`;
fs.writeFileSync(process.argv[2]||'/tmp/tooth-connections.html',`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}
body{background:#fff;color:#222;padding:10px}#fixture{width:min(${Number(process.argv[3])||390}px,100%);margin:auto}#result{white-space:pre-wrap;font-size:12px;color:#18582f}.order-tooth-chart{width:100%;max-height:none!important}.dental-chart-svg{width:100%;height:auto!important;max-height:none!important}#orderToothPopover:not(.hidden){display:block!important;position:relative!important;inset:auto!important;width:100%!important;max-width:none!important;transform:none!important;margin-top:20px}</style><body><pre id="result"></pre><div id="fixture"><main class="tooth-studio-center"><div id="orderToothChart" class="order-tooth-chart"></div>${popover}</main><p id="orderConnectionsSummary"></p></div><script>${setup}\n${code}\n${checks}</script></body></html>`);
