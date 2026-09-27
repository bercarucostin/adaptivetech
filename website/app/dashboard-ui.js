/* Integration with the existing work-order, production and reporting views. */
const dashboardViews=new Set(['workorders','production','partners','patients','technicians']);
const dashboardReader=DashboardData.create(args=>sbRpc('get_work_orders_page',args));
let dashboardState={signature:'',loadedKey:'',pendingKey:'',offset:0,page:null,error:'',timer:null,exporting:false};

function dashboardRange(scope){
  const range=viewDateRanges[scope]||{};
  if(!range.dashboardInitialized){
    const existing=Object.values(range).some(Boolean)?{...range}:{};
    Object.assign(range,DashboardData.defaultRange(),existing,{dashboardInitialized:true});
    viewDateRanges[scope]=range;
  }
  return range;
}
function dashboardRequestFilters(scope){
  const dates=DashboardData.dateFilters(dashboardRange(scope));
  const report=scope==='partners'?partnerReportFilters:scope==='patients'?patientReportFilters:scope==='technicians'?technicianReportFilters:scope==='workorders'?workQuickFilters:{};
  const sort=scope==='workorders'?workSort:scope==='technicians'?techSort:scope==='patients'?patientSort:scope==='production'?{key:'deadline',dir:'asc'}:{key:'id',dir:'desc'};
  const columns=scope==='workorders'?{...workFilters}:scope==='technicians'?{...techFilters}:{};
  const search=columns.mobileSearch||'';delete columns.mobileSearch;
  // Translate supported controls only; the RPC rejects unknown column names.
  const supported=new Set(['id','status','patient','partner','contract','workType','elements','listPrice','discount','finalPrice','modelTech','statusModel','modelingTech','statusModeling','ceramicTech','statusCerFin','ownCost','selectedCost','stages','deadline']);
  for(const key of Object.keys(columns))if(!supported.has(key))delete columns[key];
  const supportedSort=new Set([...supported,'deadline','receptionDate']);
  const operational=scope==='production'&&(isTechnician()||isDoctor()||isDashboard());
  return {...dates,...(operational?{status_in:['Not Started','Started','Finished','Shipped']}:{}),hide_old:hideOldOrders,status:report.status||null,partner:report.partner||null,
    patient:report.patient||null,work_type:report.workType||null,
    technician:scope==='technicians'?(report.technician||(isTechnician()?auth?.user?.Technician_Name:null)):null,
    search,columns,sort_key:supportedSort.has(sort.key)?sort.key:'id',sort_dir:sort.dir||'desc'};
}
function dashboardQuery(scope){
  const filters=dashboardRequestFilters(scope);
  const signature=JSON.stringify([authEpoch,auth?.user?.User_ID,labOrganizationId,scope,filters]);
  if(signature!==dashboardState.signature){
    dashboardReader.invalidate();
    dashboardState.signature=signature;dashboardState.offset=0;dashboardState.error='';
  }
  return {signature,key:signature+':'+dashboardState.offset,filters};
}
function dashboardMapRow(row){
  const order=mapSupabaseOrder(row);
  order.listPrice=nullableMoney(row.snapshot_list_price??row.list_price);
  order.finalPrice=nullableMoney(row.snapshot_final_price??row.final_price);
  order.receptionDate=row.data_receptie||row.created_at||'';
  if(isTechnician()){
    order.salaryStages=(row.salary_stages||[]).map(stage=>({
      workOrderId:num(row.id),stageKey:stage.stage_key,stageLabel:stage.stage_label||stage.stage_key,
      stageStatus:stage.stage_status||'Not Started',paymentStatus:stage.payment_status||'Not Paid',
      amount:nullableMoney(stage.amount),unitCost:nullableMoney(stage.unit_cost)
    }));
    order.ownCost=order.salaryStages.some(stage=>stage.amount===null)?null:order.salaryStages.reduce((sum,stage)=>sum+stage.amount,0);
    order.myStages=(order.myStages||[]).map(stage=>{
      const salary=order.salaryStages.find(value=>costStageKey(value.stageKey)===costStageKey(stage.stage));
      return salary?{...stage,cost:salary.amount,paid:salary.paymentStatus}:stage;
    });
  }
  order.selectedTechnicianCost=nullableMoney(row.selected_technician_cost);
  return order;
}
function dashboardPriceTotal(rows){
  return rows.some(row=>row.finalPrice===null)?null:rows.reduce((sum,row)=>sum+row.finalPrice,0);
}
async function dashboardLoadPage(scope,labId){
  const query=dashboardQuery(scope),epoch=authEpoch,userId=auth?.user?.User_ID;
  const offset=dashboardState.offset;
  dashboardState.pendingKey=query.key;dashboardState.error='';
  try{
    const page=await dashboardReader.load({p_lab_organization_id:labId,p_filters:query.filters,p_limit:100,p_offset:offset});
    if(!page||!requestContextValid(epoch,userId)||dashboardState.signature!==query.signature)return null;
    if(offset>=page.total&&offset>0){
      dashboardState.offset=Math.max(0,Math.floor((page.total-1)/100)*100);
      return dashboardLoadPage(scope,labId);
    }
    dashboardState.page=page;dashboardState.loadedKey=query.key;dashboardState.pendingKey='';
    orders=page.rows.map(dashboardMapRow);
    technicianSalaryRows=orders.flatMap(order=>order.salaryStages||[]);
    workOrderScope={returned:orders.length,total:page.total,days:90};
    updateDatasetScope();
    return page;
  }catch(error){
    if(requestContextValid(epoch,userId)&&dashboardState.signature===query.signature){
      dashboardState.error=error.message;dashboardState.loadedKey=query.key;dashboardState.pendingKey='';
      dashboardState.page=null;orders=[];
    }
    throw error;
  }
}
function dashboardFacet(name,fallback=[]){
  return dashboardState.page?.facets?.[name]||fallback;
}
function dashboardRememberFocus(){
  const el=document.activeElement;
  if(!el||!['INPUT','SELECT'].includes(el.tagName))return ()=>{};
  const attr=['data-work-filter','data-work-quick-filter','data-partner-report-filter','data-patient-report-filter','data-technician-report-filter','data-tech-filter','data-date-range-key'].find(key=>el.hasAttribute(key));
  const selector=el.id?`#${el.id}`:attr?`[${attr}="${el.getAttribute(attr)}"]`:null;
  const start=el.selectionStart,end=el.selectionEnd;
  return ()=>{const next=selector&&document.querySelector(selector);if(next){next.focus();try{next.setSelectionRange(start,end);}catch{}}};
}
function dashboardRenderScope(scope,original,args){
  if(!auth)return original(...args);
  let query;
  try{query=dashboardQuery(scope);}catch(error){
    dashboardReader.invalidate();clearTimeout(dashboardState.timer);dashboardState.pendingKey='';
    dashboardState.error=error.message;orders=[];original(...args);dashboardChrome(scope,false);return;
  }
  const ready=dashboardState.loadedKey===query.key;
  if(!ready){
    orders=[];
    if(dashboardState.pendingKey!==query.key){
      clearTimeout(dashboardState.timer);dashboardState.pendingKey=query.key;
      dashboardState.timer=setTimeout(async()=>{
        try{const lab=await resolveLabOrganizationId();if(currentView===scope)await dashboardLoadPage(scope,lab);}
        catch(error){dashboardState.error=error.message;}
        if(currentView===scope){const restore=dashboardRememberFocus();render();restore();}
      },180);
    }
  }
  original(...args);
  dashboardChrome(scope,!ready);
}
function dashboardChrome(scope,loading){
  const page=dashboardState.page,summary=page?.summary||{},error=dashboardState.error;
  content.querySelectorAll('.kpi-grid,.dashboard-pagination,.dashboard-dataset-note,.dashboard-server-summary').forEach(el=>el.remove());
  const total=loading?0:page?.total||0,offset=dashboardState.offset;
  const status=error?error:loading?'Încarc lucrările pentru filtrele selectate…':`${total} lucrări în interval · ${orders.length?offset+1:0}–${offset+orders.length} afișate`;
  const filterCard=content.querySelector('.date-range-filter-card');
  const showIntervalStatus=scope==='partners'||scope==='technicians';
  let note=null;
  if(showIntervalStatus){
    note=document.createElement('div');note.className='dashboard-dataset-note'+(error?' error-text':'');note.setAttribute('role','status');note.textContent=status;
    if(filterCard)filterCard.after(note);else content.prepend(note);
  }
  content.setAttribute('aria-busy',String(loading));
  if(scope!=="production"&&!loading&&!error&&page){
    const amounts=(isManagement()||isDoctor())?kpi('Valoare totală',money(summary.final_price),summary.final_price===null?'Total incomplet: există prețuri neconfigurate':'Toate lucrările filtrate'):'';
    const tech=scope==='technicians'?kpi('Cost tehnician',technicianMoney(summary.technician_cost),'Toate lucrările filtrate'):'';
    const box=document.createElement('div');box.className='dashboard-server-summary kpi-grid';
    box.innerHTML=kpi('Lucrări',total,'Întregul interval filtrat')+kpi('Elemente',num(summary.elements),'Întregul interval filtrat')+amounts+tech;
    if(note)note.after(box);else if(filterCard)filterCard.after(box);else content.prepend(box);
  }
  const navigation=document.createElement('div');navigation.className='dashboard-pagination';
  navigation.innerHTML=`<button type="button" class="secondary-btn" data-dashboard-page="previous" ${loading||error||offset===0?'disabled':''}>← Anterior</button><span>Pagina ${Math.floor(offset/100)+1} din ${Math.max(1,Math.ceil(total/100))}</span><button type="button" class="secondary-btn" data-dashboard-page="next" ${loading||error||offset+100>=total?'disabled':''}>Următor →</button>`;
  content.append(navigation);
  navigation.querySelectorAll('[data-dashboard-page]').forEach(button=>button.addEventListener('click',()=>{
    dashboardState.offset=Math.max(0,dashboardState.offset+(button.dataset.dashboardPage==='next'?100:-100));render();
  }));
  const topNavigation=navigation.cloneNode(true);
  const summaryBox=content.querySelector('.dashboard-server-summary');
  if(summaryBox)summaryBox.after(topNavigation);else if(note)note.after(topNavigation);else if(filterCard)filterCard.after(topNavigation);else content.prepend(topNavigation);
  topNavigation.querySelectorAll('[data-dashboard-page]').forEach(button=>button.addEventListener('click',()=>{
    dashboardState.offset=Math.max(0,dashboardState.offset+(button.dataset.dashboardPage==='next'?100:-100));render();
  }));
  content.querySelectorAll('.table-count').forEach(el=>{el.textContent=`${orders.length} lucrări pe această pagină · ${total} în interval`;});
  if(scope==='partners'){
    const label=content.querySelector('.table-tools strong');if(label)label.textContent='Parteneri — lucrările din pagina curentă';
    const pageNote=document.createElement('p');pageNote.className='dashboard-dataset-note';pageNote.textContent='Detaliile pe partener de mai jos însumează pagina curentă. Totalurile de sus și exportul includ întregul interval.';navigation.before(pageNote);
  }
  if(scope==='production'){
    const pageNote=document.createElement('p');pageNote.className='dashboard-dataset-note';pageNote.textContent='Coloanele de producție afișează lucrările din pagina curentă.';navigation.before(pageNote);
  }
  content.querySelectorAll('[data-tech-filter]').forEach(el=>{
    if(!['id','status','patient','partner','contract','workType','elements','listPrice','discount','finalPrice','modelTech','statusModel','modelingTech','statusModeling','ceramicTech','statusCerFin','ownCost','selectedCost','stages','deadline'].includes(el.dataset.techFilter)){
      el.disabled=true;el.placeholder='Folosește filtrele de sus';el.title='Filtrarea se aplică pe server prin controalele de sus.';
    }
  });
  // Prevent legacy click handlers from exporting only the visible page.
  for(const id of ['workOrdersPdfBtn','mobileWorkOrdersPdfBtn','partnerPdfBtn','patientPdfBtn','technicianPdfBtn']){
    const old=document.getElementById(id);if(!old)continue;
    const button=old.cloneNode(true);old.replaceWith(button);
    button.disabled=loading||Boolean(error)||dashboardState.exporting||button.disabled;
    button.addEventListener('click',()=>dashboardExport(scope,button));
  }
}
async function dashboardExport(scope,button){
  if(dashboardState.exporting)return;
  const query=dashboardQuery(scope),epoch=authEpoch,userId=auth?.user?.User_ID;
  // Open synchronously, before awaits, so the browser does not treat it as a popup.
  const reportWindow=window.open('','_blank','width=1100,height=820');
  if(!reportWindow){alert('Permite ferestrele pop-up pentru export.');return;}
  reportWindow.document.body.textContent='Pregătesc toate lucrările din interval…';
  dashboardState.exporting=true;button.disabled=true;
  try{
    const lab=await resolveLabOrganizationId();
    const rows=(await dashboardReader.exportRows({p_lab_organization_id:lab,p_filters:query.filters},{
      isCurrent:()=>requestContextValid(epoch,userId)&&currentView===scope&&dashboardQuery(scope).signature===query.signature,
      onProgress:(count,total)=>{reportWindow.document.body.textContent=`Pregătesc raportul: ${count} / ${total} lucrări…`;}
    })).map(dashboardMapRow);
    const filters=dashboardFilterDescription(scope);
    if(scope==='workorders'){exportWorkOrdersPdf(rows,reportWindow,filters);return;}
    const selected=technicianReportFilters.technician||(isTechnician()?auth?.user?.Technician_Name:'');
    if(scope==='technicians'){
      if(!selected)throw new Error('Selectează un tehnician pentru export.');
      const cost=row=>isTechnician()?row.ownCost:row.selectedTechnicianCost;
      const sum=rows.some(row=>cost(row)===null)?null:rows.reduce((value,row)=>value+cost(row),0);
      openPdfReport({title:`Raport tehnician — ${selected}`,filters,reportWindow,orientation:'landscape',
        columns:['Lucrare','Pacient','Partener','Elemente','Cost tehnician','Status'],
        totals:[{label:'Lucrări',value:String(rows.length)},{label:'Cost tehnician',value:technicianMoney(sum)}],
        rows:rows.map(row=>[`#${row.id}`,row.patient,row.partner,String(row.elements),technicianMoney(cost(row)),uiText(row.status)])});
    }else{
      openPdfReport({title:scope==='partners'?'Raport parteneri':'Raport pacienți',filters,reportWindow,orientation:'landscape',
        columns:['Lucrare','Pacient','Partener','Termen','Tip lucrare','Elemente','Total','Status'],
        totals:[{label:'Lucrări',value:String(rows.length)},{label:dashboardPriceTotal(rows)===null?'Total incomplet — prețuri neconfigurate':'Total',value:money(dashboardPriceTotal(rows))}],
        rows:rows.map(row=>[`#${row.id}`,row.patient,row.partner,fmtDate(row.deadline),row.workType,String(row.elements),money(row.finalPrice),uiText(row.status)])});
    }
  }catch(error){reportWindow.close();alert(error.message);}
  finally{dashboardState.exporting=false;button.disabled=false;}
}
function dashboardFilterDescription(scope){
  const filters=dashboardRequestFilters(scope),labels={reception_from:'Recepție de la',reception_to:'Recepție până la',deadline_from:'Livrare de la',deadline_to:'Livrare până la',status:'Status',partner:'Partener',patient:'Pacient',work_type:'Tip lucrare',technician:'Tehnician',search:'Căutare'};
  const parts=Object.entries(labels).filter(([key])=>filters[key]).map(([key,label])=>`${label}: ${filters[key]}`);
  if(filters.hide_old)parts.push('Lucrări vechi finalizate: ascunse');
  for(const [key,value] of Object.entries(filters.columns))if(value)parts.push(`${key}: ${value}`);
  return parts;
}
function initializeDashboardPagination(){
  displayedOrders=()=>orders; // Hide-old and date filters are already enforced by SQL.
  const localDateFilter=applyViewDateRanges;
  applyViewDateRanges=(rows,scope)=>dashboardViews.has(scope)?rows:localDateFilter(rows,scope);
  applyWorkQuickFilters=rows=>rows;
  filterByReportControls=rows=>rows;
  const originals={workorders:renderWorkOrders,production:renderProduction,partners:renderPartners,patients:renderPatients,technicians:renderTechnicians};
  renderWorkOrders=(...args)=>dashboardRenderScope('workorders',originals.workorders,args);
  renderProduction=(...args)=>dashboardRenderScope('production',originals.production,args);
  renderPartners=(...args)=>dashboardRenderScope('partners',originals.partners,args);
  renderPatients=(...args)=>dashboardRenderScope('patients',originals.patients,args);
  renderTechnicians=(...args)=>dashboardRenderScope('technicians',originals.technicians,args);
  const previousClearAuth=clearAuth;
  clearAuth=function(...args){dashboardReader.invalidate();clearTimeout(dashboardState.timer);dashboardState={signature:'',loadedKey:'',pendingKey:'',offset:0,page:null,error:'',timer:null,exporting:false};return previousClearAuth(...args);};
}
