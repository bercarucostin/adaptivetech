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
const names=['syncBatchToothHighlight','syncOrderConnectionControls','toggleOrderToothConnection','orderedActiveTeeth','commonBatchField','syncOrderJoinTeethControl','openOrderToothPopover','saveOrderToothPopover','removeActiveOrderTooth','closeOrderToothPopover','renderOrderToothPicker'];
const code=app.slice(app.indexOf('const FDI_UPPER='),app.indexOf('function hasMeaningfulCaseData('))+
 app.slice(app.indexOf('function orderedSelectedTeeth('),app.indexOf('function selectedToothRowHtml('))+names.map(fn).join('\n');
const ids=['orderToothChart','orderToothPopover','orderToothPopoverTitle','orderToothPopoverMeta','orderToothPreview','orderToothType','orderToothShade','orderToothNote','orderJoinTeeth','orderJoinTeethWrap','orderApplySameShade','orderSameShadeWrap','orderToothTypeSuggestions','orderToothRemoveBtn','orderToothSaveBtn'];
const setup=`
const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const normalize=value=>String(value||'').toLowerCase();
const auth={user:{}};
let readOnly=false,orderCaseDraft,activeOrderTooth,activeOrderToothAnchor,activeOrderTeeth=[],activeOrderConnectionChanges={},activeOrderMixedFields=new Set();
const orderToothViewMode='upperlower';
const orderShade=null,orderMethod=null,orderClinicNote={},orderProductionNotes={};
${ids.map(id=>`const ${id}=$('${id}');`).join('\n')}
// Unrelated modal placement, pricing and request side effects are outside this fixture.
const syncOrderCaseDraftFromInputs=()=>{},positionOrderToothPopover=()=>{},updateToothDetailBadge=()=>{},renderOrderToothDetails=()=>{},updateOrderToothDerivedScope=()=>{},renderOrderWorkTypeLegend=()=>{};
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
 orderCaseDraft={selected:[],perTooth:{},connections:[]};
 renderOrderToothPicker();
 const clickEdge=key=>edge(key).dispatchEvent(new MouseEvent('click',{bubbles:true}));
 const clickTooth=(tooth,ctrlKey=false)=>orderToothChart.querySelector('[data-tooth="'+tooth+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey}));
 clickEdge('46-45');
 check(orderCaseDraft.selected.length===0&&links()==='[]','No selection means no connection mutation or tooth inclusion');
 clickTooth(46);
 check(edge('46-45').getAttribute('aria-disabled')==='true','One selected endpoint is insufficient');
 clickTooth(45,true);
 check(edge('46-45').getAttribute('aria-disabled')==='false','Both clicked teeth enable dot without prior configuration');
 orderToothType.value='Crown';orderToothNote.value='pending note';
 clickEdge('46-45');
 check(edge('46-45').classList.contains('checked'),'Click previews green connection');
 check(orderCaseDraft.selected.length===0&&Object.keys(orderCaseDraft.perTooth).length===0&&links()==='[]','Preview never creates shaded configured teeth');
 check(orderToothNote.value==='pending note'&&orderToothType.value==='Crown','Point preserves pending popover edits');
 clickTooth(45,true);
 check(edge('46-45').getAttribute('aria-disabled')==='true'&&!edge('46-45').classList.contains('checked'),'Deselecting endpoint disables dot and clears preview');
 check(!orderToothChart.querySelector('[data-tooth="45"]').classList.contains('batch-selected')&&!orderToothChart.querySelector('[data-tooth="45"]').classList.contains('selected'),'Deselected new tooth has no residual shading');
 clickTooth(45,true);
 check(!edge('46-45').classList.contains('checked'),'Reselecting does not resurrect discarded connection');
 edge('46-45').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
 check(edge('46-45').classList.contains('checked'),'Keyboard toggles enabled point');
 orderToothType.value='Crown';orderToothSaveBtn.click();
 check(links()==='[[46,45]]'&&orderCaseDraft.selected.includes(46)&&orderCaseDraft.selected.includes(45),'Applying selection commits configured teeth and connection');
 check(edge('46-45').getAttribute('aria-disabled')==='true'&&edge('46-45').classList.contains('checked'),'Saved green point still requires active selection to edit');
 clickEdge('46-45');check(links()==='[[46,45]]','Click on saved point without selection is ignored');
 openOrderToothPopover(46,null,{batch:[46,45]});clickEdge('46-45');closeOrderToothPopover();
 check(links()==='[[46,45]]'&&edge('46-45').classList.contains('checked'),'Cancel restores saved connection');
 openOrderToothPopover(46,null,{batch:[46,45,44]});
 check(orderJoinTeeth.indeterminate,'Partial group opens mixed checkbox');
 clickEdge('45-44');orderToothType.value='Crown';orderToothSaveBtn.click();
 check(links()==='[[46,45],[45,44]]','Applying temporary edge extends group');
 openOrderToothPopover(45,null,{batch:[45,44]});orderJoinTeeth.click();orderToothSaveBtn.click();
 check(links()==='[[46,45]]','Batch uncheck leaves external connection intact');
 openOrderToothPopover(46,null,{batch:[46,45]});readOnly=true;renderOrderToothPicker();clickEdge('46-45');
 check(links()==='[[46,45]]'&&Object.keys(activeOrderConnectionChanges).length===0,'Readonly blocks pending changes');
 readOnly=false;closeOrderToothPopover();
 openOrderToothPopover(45);removeActiveOrderTooth();
 check(links()==='[]','Removing configured tooth clears incident links');
 orderCaseDraft.selected=[...FDI_UPPER,...FDI_LOWER];
 orderCaseDraft.connections=[[46,45],[45,44],[44,43],[43,42],[42,41],[41,31],[31,32],[32,33],[33,34],[34,35],[35,36]];
 renderOrderToothPicker();
 const frame=orderToothChart.querySelector('svg').viewBox.baseVal;
 for(const control of orderToothChart.querySelectorAll('[data-tooth-connection]')){
  const p=control.transform.baseVal.consolidate().matrix;
  check(p.e-11>=frame.x&&p.e+11<=frame.x+frame.width&&p.f-11>=frame.y&&p.f+11<=frame.y+frame.height,'Control fits viewBox: '+control.dataset.toothConnection);
 }
 const payload=caseDraftPayload(orderCaseDraft);
 const restored=draftFromServerCase({id:1,items:orderCaseDraft.selected.map(tooth_number=>({tooth_number,work_type:'Crown'}))},{tooth_details:payload.tooth_details,case_snapshot:payload.tooth_details.__case});
 check(JSON.stringify(restored.connections)===links(),'Round trip retains connected groups');
 openOrderToothPopover(46,null,{batch:[46,45,44]});
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
