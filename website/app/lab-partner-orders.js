/* Commercial Lab Partner orders use dedicated RPCs; no clinical fields are sent. */
const labPartnerUi={types:[],rows:[],editing:0,quote:null,timer:null,request:0,files:[]};

function bucharestParts(date){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.map(part=>[part.type,part.value]));
}
function bucharestLocalValue(date){
  const p=bucharestParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function bucharestDeadlineIso(value){
  const match=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(String(value||''));
  if(!match)throw new Error('Alege data și ora termenului.');
  const [year,month,day,hour,minute]=match.slice(1).map(Number);
  const target=Date.UTC(year,month-1,day,hour,minute);
  let stamp=target;
  for(let n=0;n<3;n++){
    const p=bucharestParts(new Date(stamp));
    const shown=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));
    stamp+=target-shown;
  }
  if(bucharestLocalValue(new Date(stamp))!==value)throw new Error('Ora aleasă nu există în fusul Europe/Bucharest.');
  if(stamp<=Date.now())throw new Error('Termenul trebuie să fie în viitor.');
  return new Date(stamp).toISOString();
}
function labPartnerRowsHtml(){
  const types=labPartnerUi.types;
  return labPartnerUi.rows.map((row,index)=>{
    const selected=types.find(type=>type.tip_lucrare===row.work_type);
    return `<div class="lab-partner-line" data-line="${index}">
      <label>Tip lucrare<select data-field="work_type" required>${optionHtml(types.map(type=>type.tip_lucrare),row.work_type,true)}</select></label>
      <label>Culoare<input data-field="color" maxlength="120" value="${escapeHtml(row.color||'')}" placeholder="Opțional"></label>
      <label>Cantitate<input data-field="quantity" type="number" min="1" max="99999" step="1" required value="${escapeHtml(row.quantity||1)}"></label>
      <label class="lab-partner-processing ${selected?.processing_enabled?'':'hidden'}"><input data-field="processing_requested" type="checkbox" ${row.processing_requested?'checked':''}> Prelucrare</label>
      <button class="secondary-btn" type="button" data-remove-line="${index}" aria-label="Elimină rândul">×</button>
    </div>`;
  }).join('');
}
function labPartnerReadRows(){
  const dialog=document.getElementById('labPartnerOrderDialog');
  labPartnerUi.rows=[...dialog.querySelectorAll('.lab-partner-line')].map(line=>({
    work_type:line.querySelector('[data-field="work_type"]').value,
    color:line.querySelector('[data-field="color"]').value.trim(),
    quantity:Number(line.querySelector('[data-field="quantity"]').value),
    processing_requested:line.querySelector('[data-field="processing_requested"]').checked
  }));
}
function labPartnerPaintRows(){
  const host=document.getElementById('labPartnerLineList');
  if(!host)return;
  host.innerHTML=labPartnerRowsHtml();
  host.querySelectorAll('input,select').forEach(input=>input.addEventListener('change',()=>{
    labPartnerReadRows();
    if(input.dataset.field==='work_type')labPartnerPaintRows();
    labPartnerScheduleQuote();
  }));
  host.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{
    labPartnerReadRows();labPartnerScheduleQuote();
  }));
  host.querySelectorAll('[data-remove-line]').forEach(button=>button.addEventListener('click',()=>{
    labPartnerReadRows();labPartnerUi.rows.splice(Number(button.dataset.removeLine),1);
    if(!labPartnerUi.rows.length)labPartnerUi.rows.push({work_type:'',color:'',quantity:1,processing_requested:false});
    labPartnerPaintRows();labPartnerScheduleQuote();
  }));
}
function labPartnerScheduleQuote(){
  clearTimeout(labPartnerUi.timer);
  const box=document.getElementById('labPartnerQuote');
  labPartnerUi.quote=null;
  if(box)box.textContent='Calculez prețul…';
  labPartnerUi.timer=setTimeout(labPartnerRefreshQuote,350);
}
async function labPartnerRefreshQuote(){
  const request=++labPartnerUi.request;
  const box=document.getElementById('labPartnerQuote');
  if(!box)return;
  try{
    const deadline=bucharestDeadlineIso(document.getElementById('labPartnerDeadline').value);
    labPartnerReadRows();
    const quote=await sbRpc('estimate_lab_partner_work_order_price',{
      p_lab:await resolveLabOrganizationId(),p_items:labPartnerUi.rows,p_deadline_at:deadline
    });
    if(request!==labPartnerUi.request)return;
    labPartnerUi.quote=quote;
    box.innerHTML=`${quote.urgent?'<strong class="lab-partner-urgent">Termen urgent: se aplică majorarea configurată.</strong>':'<span>Termen standard</span>'}
      <div>Interval urgență: ${Number(quote.urgent_window_hours)} ore</div>
      ${(quote.lines||[]).map(line=>`<div>${escapeHtml(line.work_type)} × ${line.quantity} · contract ${escapeHtml(line.contract)} · bază ${money(line.base_subtotal)}${line.processing_requested?` · prelucrare ${money(line.processing_subtotal)}`:''}${line.urgent_percent?` · urgență ${line.urgent_percent}% (${money(line.urgency_surcharge)})`:''} = <strong>${money(line.line_total)}</strong></div>`).join('')}
      <strong>Total: ${money(quote.final_price)}</strong>`;
  }catch(error){
    if(request===labPartnerUi.request)box.textContent=error.message;
  }
}
async function labPartnerLoadFiles(orderId){
  const host=document.getElementById('labPartnerSavedFiles');
  if(!host||!orderId)return;
  try{
    const result=await callFileAuthorization('list',orderId);
    host.innerHTML=(result.files||[]).map(file=>`<div>${escapeHtml(file.original_file_name)} <button type="button" data-file-id="${escapeHtml(file.id)}">Descarcă</button>${isLabPartner()?` <button type="button" data-delete-file-id="${escapeHtml(file.id)}">Șterge</button>`:''}</div>`).join('')||'Niciun fișier atașat.';
    host.querySelectorAll('[data-file-id]').forEach(button=>button.addEventListener('click',async()=>{
      try{const result=await callFileAuthorization('download',orderId,{file_id:button.dataset.fileId});window.open(result.signed_url,'_blank','noopener');}
      catch(error){alert(error.message);}
    }));
    host.querySelectorAll('[data-delete-file-id]').forEach(button=>button.addEventListener('click',async()=>{
      if(!confirm('Ștergi acest fișier?'))return;
      try{await callFileAuthorization('delete',orderId,{file_id:button.dataset.deleteFileId});await labPartnerLoadFiles(orderId);}
      catch(error){alert(error.message);}
    }));
  }catch(error){host.textContent=error.message;}
}
async function labPartnerUploadFiles(orderId){
  const files=[...document.getElementById('labPartnerFiles').files];
  const failures=[];
  for(const file of files){
    try{
      const authz=await callFileAuthorization('upload',orderId,{file_name:file.name,file_size:file.size,mime_type:file.type||'application/octet-stream',file_kind:caseFileExtension(file.name)});
      const upload=authz.upload;
      const {error}=await supabaseClient.storage.from(upload.bucket).uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type||'application/octet-stream'});
      if(error)throw error;
    }catch(error){failures.push(`${file.name}: ${error.message}`);}
  }
  if(failures.length)throw new Error(`Lucrarea #${orderId} a fost salvată, dar unele fișiere nu s-au încărcat:\n${failures.join('\n')}`);
}
async function openLabPartnerOrder(orderId=0){
  labPartnerUi.editing=Number(orderId)||0;
  labPartnerUi.rows=[{work_type:'',color:'',quantity:1,processing_requested:false}];
  let detail=null;
  if(orderId){
    detail=await sbRpc('get_lab_partner_work_order',{p_lab:await resolveLabOrganizationId(),p_order:Number(orderId)});
    if(!detail)throw new Error('Lucrarea nu mai este disponibilă.');
    labPartnerUi.rows=detail.items||[];
  }
  const editable=isLabPartner()&&(!orderId||detail.approval_state==='rejected');
  let dialog=document.getElementById('labPartnerOrderDialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='labPartnerOrderDialog';dialog.className='lab-partner-dialog';document.body.appendChild(dialog);}
  dialog.innerHTML=`<form id="labPartnerForm">
    <header><h2>${orderId?`Lucrarea #${Number(orderId)}`:'Lucrare nouă'}</h2><button type="button" id="labPartnerClose" aria-label="Închide">×</button></header>
    ${detail?`<p>Stare aprobare: <strong>${escapeHtml(detail.approval_state)}</strong>${detail.approval_reason?` · motiv: ${escapeHtml(detail.approval_reason)}`:''}</p>`:''}
    <label>Termen (Europe/Bucharest)<input id="labPartnerDeadline" type="datetime-local" required value="${detail?.deadline_at?bucharestLocalValue(new Date(detail.deadline_at)):bucharestLocalValue(new Date(Date.now()+2*86400000))}"></label>
    <div id="labPartnerLineList"></div>
    ${editable?'<button type="button" id="labPartnerAddLine" class="secondary-btn">+ Adaugă lucrare</button>':''}
    <label>Note<textarea id="labPartnerNote" maxlength="2000" rows="3">${escapeHtml(detail?.items?.[0]?.note||'')}</textarea></label>
    <section id="labPartnerQuote" aria-live="polite"></section>
    <label>Fișiere atașate<input id="labPartnerFiles" type="file" multiple accept=".zip,.rar,.stl,.ply,.obj,.pdf,.jpg,.jpeg,.png"></label>
    <div id="labPartnerSavedFiles"></div>
    <footer><button type="button" id="labPartnerCancel" class="secondary-btn">Închide</button>${orderId?'<button type="button" id="labPartnerUploadFiles" class="secondary-btn">Încarcă fișiere</button>':''}${editable?`<button type="submit" class="primary-btn">${orderId?'Retrimite spre aprobare':'Trimite spre aprobare'}</button>`:''}</footer>
  </form>`;
  labPartnerPaintRows();
  if(!editable)dialog.querySelectorAll('#labPartnerLineList input,#labPartnerLineList select,#labPartnerDeadline,#labPartnerNote').forEach(el=>el.disabled=true);
  document.getElementById('labPartnerAddLine')?.addEventListener('click',()=>{
    labPartnerReadRows();labPartnerUi.rows.push({work_type:'',color:'',quantity:1,processing_requested:false});labPartnerPaintRows();labPartnerScheduleQuote();
  });
  document.getElementById('labPartnerDeadline').addEventListener('change',labPartnerScheduleQuote);
  document.getElementById('labPartnerUploadFiles')?.addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{await labPartnerUploadFiles(Number(orderId));document.getElementById('labPartnerFiles').value='';await labPartnerLoadFiles(Number(orderId));}
    catch(error){alert(error.message);}finally{button.disabled=false;}
  });
  for(const id of ['labPartnerClose','labPartnerCancel'])document.getElementById(id).addEventListener('click',()=>dialog.close());
  dialog.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=dialog.querySelector('[type="submit"]');button.disabled=true;
    let savedOrderId=0;
    try{
      labPartnerReadRows();
      const payload={p_lab:await resolveLabOrganizationId(),p_deadline_at:bucharestDeadlineIso(document.getElementById('labPartnerDeadline').value),p_items:labPartnerUi.rows,p_note:document.getElementById('labPartnerNote').value};
      const id=labPartnerUi.editing
        ? (await sbRpc('resubmit_lab_partner_work_order',{...payload,p_order:labPartnerUi.editing}),labPartnerUi.editing)
        : Number(await sbRpc('create_lab_partner_work_order',payload));
      savedOrderId=id;
      labPartnerUi.editing=id;
      await labPartnerUploadFiles(id);
      dialog.close();await loadAll(false);
    }catch(error){
      alert(error.message);
      if(savedOrderId){dialog.close();await loadAll(false);}
    }finally{button.disabled=false;}
  });
  dialog.showModal();
  if(editable)labPartnerScheduleQuote();
  else{
    document.getElementById('labPartnerQuote').innerHTML=`${(detail.price_lines||[]).map(line=>`<div>${escapeHtml(line.contract)} · bază ${money(line.base_subtotal)} · urgență ${line.urgent_percent}% (${money(line.urgency_surcharge)}) · total ${money(line.line_total)}</div>`).join('')}<strong>Total salvat: ${money(detail.final_price)}</strong>`;
  }
  if(orderId)await labPartnerLoadFiles(orderId);
}

function renderLabPartnerOrders(){
  pageTitle.textContent='Lucrările mele';pageSubtitle.textContent='Comenzi comerciale pentru partenerul tău';
  const rows=orders;
  content.innerHTML=`<div class="card panel"><h3>Lucrări</h3><div class="table-wrap"><table><thead><tr><th>Lucrare</th><th>Termen</th><th>Tipuri</th><th>Stare aprobare</th><th>Total</th><th>Acțiuni</th></tr></thead><tbody>
  ${rows.map(o=>`<tr><td>#${o.id}</td><td>${escapeHtml(o.deadlineAt?new Date(o.deadlineAt).toLocaleString('ro-RO',{timeZone:'Europe/Bucharest'}):o.deadline)}</td><td>${escapeHtml(o.workType)}</td><td><strong>${escapeHtml(o.approvalState)}</strong>${o.approvalReason?`<br>${escapeHtml(o.approvalReason)}`:''}</td><td>${money(o.finalPrice)}</td><td><button type="button" data-partner-order="${o.id}">${o.approvalState==='rejected'?'Editează și retrimite':'Vezi'}</button></td></tr>`).join('')||'<tr><td colspan="6">Nu ai încă lucrări.</td></tr>'}
  </tbody></table></div></div>`;
  content.querySelectorAll('[data-partner-order]').forEach(button=>button.addEventListener('click',()=>openLabPartnerOrder(Number(button.dataset.partnerOrder)).catch(error=>alert(error.message))));
}

const previousLabLoadAll=loadAll;
loadAll=async function(show=true,options={}){
  const renderRequested=options.renderUI!==false;
  if(isLabPartner()){
    if(show)showLoading('Actualizez','Încarc lucrările partenerului...');
    try{
      const lab=await resolveLabOrganizationId();
      const [rows,reference]=await Promise.all([
        sbRpc('list_lab_partner_work_orders',{p_lab:lab}),
        sbRpc('get_work_order_reference_data',{p_lab_organization_id:lab})
      ]);
      labPartnerUi.types=(reference.work_types||[]).filter(type=>type.active);
      orders=(rows||[]).map(row=>({id:Number(row.id),deadline:row.deadline,deadlineAt:row.deadline_at,
        workType:(row.items||[]).map(item=>item.work_type).join(' / '),approvalState:row.approval_state,
        approvalReason:row.approval_reason,finalPrice:Number(row.final_price),status:row.status}));
      workTypes=labPartnerUi.types.map(type=>type.tip_lucrare);
      currentView='workorders';
      if(renderRequested)render();
      return;
    }finally{if(show)hideLoading();}
  }
  const result=await previousLabLoadAll(show,{...options,renderUI:false});
  if((isManagement()||isDoctor())&&orders.length){
    const summary=await sbRpc('get_work_order_approval_summary',{p_lab:await resolveLabOrganizationId(),p_orders:orders.map(order=>order.id)});
    for(const order of orders){const row=summary?.[String(order.id)];if(row){order.approvalState=row.state;order.approvalReason=row.reason;order.approvalReviewedAt=row.reviewed_at;order.deadlineAt=row.deadline_at;order.orderOrigin=row.origin;}}
  }
  if(renderRequested)render();
  return result;
};

const previousLabRenderWorkOrders=renderWorkOrders;
renderWorkOrders=function(...args){return isLabPartner()?renderLabPartnerOrders():previousLabRenderWorkOrders(...args);};
const previousLabOpenNewOrder=openNewOrder;
openNewOrder=function(){return isLabPartner()?openLabPartnerOrder().catch(error=>alert(error.message)):previousLabOpenNewOrder();};
window.openNewOrder=openNewOrder;
const previousLabEditOrder=editOrder;
editOrder=function(id){
  const order=orders.find(item=>Number(item.id)===Number(id));
  return isLabPartner()||order?.orderOrigin==='lab_partner'
    ?openLabPartnerOrder(id).catch(error=>alert(error.message)):previousLabEditOrder(id);
};
window.editOrder=editOrder;

async function reviewExternalOrder(orderId,decision){
  if(!isManagement())return;
  const reason=decision==='reject'?window.prompt('Motivul refuzului (opțional):',''):null;
  if(decision==='reject'&&reason===null)return;
  try{
    await sbRpc('review_external_work_order',{p_lab:await resolveLabOrganizationId(),
      p_order:Number(orderId),p_decision:decision,p_reason:reason});
    await loadAll(false);
  }catch(error){alert(`Revizuirea a eșuat: ${error.message}`);}
}
window.reviewExternalOrder=reviewExternalOrder;

for(const input of [dueDate,document.getElementById('dueTime')]){
  input?.addEventListener('change',()=>{if(isDoctor())recalcFormPrice();});
}

let labPricingAdmin={settings:null,defaults:[]};
const previousAdminLoadAll=loadAll;
loadAll=async function(show=true,options={}){
  const renderRequested=options.renderUI!==false;
  const result=await previousAdminLoadAll(show,{...options,renderUI:false});
  if(isAdmin()){
    const lab=await resolveLabOrganizationId();
    const [settings,defaults]=await Promise.all([
      supabaseClient.from('lab_order_pricing_settings').select('default_contract,urgent_window_hours').eq('lab_organization_id',lab).maybeSingle(),
      supabaseClient.from('lab_contract_pricing_defaults').select('contract,urgent_percent,processing_amount').eq('lab_organization_id',lab)
    ]);
    if(settings.error)throw settings.error;
    if(defaults.error)throw defaults.error;
    labPricingAdmin={settings:settings.data,defaults:defaults.data||[]};
  }
  if(renderRequested)render();
  return result;
};

function labPricingOptionalNumber(value){
  if(String(value).trim()==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw new Error('Valoarea trebuie să fie un număr pozitiv.');
  return n;
}
const previousAdminConfigRequest=adminConfigRequest;
adminConfigRequest=async function(entity,action,data={}){
  if(entity==='user'&&(action==='create'||action==='update')){
    data={...data,Partner_ID:document.getElementById(action==='create'?'newUserPartnerId':'editUserPartnerId')?.value||''};
  }
  if(entity==='work_type'&&(action==='create'||action==='update')){
    const id=action==='create'?'newWorkTypeProcessing':`workTypeProcessing${data.ID}`;
    data={...data,Processing_Enabled:Boolean(document.getElementById(id)?.checked)};
  }
  if(entity==='price'&&(action==='create'||action==='update')){
    const suffix=action==='create'?'New':String(data.ID);
    data={...data,
      Urgent_Percent_Override:labPricingOptionalNumber(document.getElementById(`priceUrgent${suffix}`)?.value||''),
      Processing_Amount_Override:labPricingOptionalNumber(document.getElementById(`priceProcessing${suffix}`)?.value||'')};
  }
  return previousAdminConfigRequest(entity,action,data);
};

const previousSupabaseAdminMutation=supabaseAdminMutation;
supabaseAdminMutation=async function(entity,action,data={}){
  if(entity==='price'&&(action==='create'||action==='update')){
    const lab=await resolveLabOrganizationId();
    if(action==='create'){
      const row={lab_organization_id:lab,id:`price_${crypto.randomUUID()}`,contract:String(data.Contract||'').trim(),
        tip_lucrare:String(data.Tip_Lucrare||'').trim(),pret:Number(data.Pret),
        urgent_percent_override:data.Urgent_Percent_Override,
        processing_amount_override:data.Processing_Amount_Override};
      const {error}=await supabaseClient.from('lab_contract_work_prices').insert(row);
      if(error)throw error;return;
    }
    const current=adminPriceByUiId(data.ID);
    if(!current)throw new Error('Prețul nu mai există.');
    const {error}=await supabaseClient.from('lab_contract_work_prices').update({
      contract:String(data.Contract||'').trim(),tip_lucrare:String(data.Tip_Lucrare||'').trim(),pret:Number(data.Pret),
      urgent_percent_override:data.Urgent_Percent_Override,processing_amount_override:data.Processing_Amount_Override,
      updated_at:new Date().toISOString()
    }).eq('lab_organization_id',lab).eq('id',current._supabase_id);
    if(error)throw error;return;
  }
  if(entity==='work_type'&&(action==='create'||action==='update')){
    const lab=await resolveLabOrganizationId();
    if(action==='create'){
      const {error}=await supabaseClient.from('lab_work_types').insert({lab_organization_id:lab,id:await nextWorkTypeId(),
        tip_lucrare:String(data.Tip_Lucrare||'').trim(),active:Boolean(data.Active),
        billing_mode:normalizeBillingMode(data.Billing_Mode),processing_enabled:Boolean(data.Processing_Enabled)});
      if(error)throw error;return;
    }
    const {error}=await supabaseClient.from('lab_work_types').update({tip_lucrare:String(data.Tip_Lucrare||'').trim(),
      active:Boolean(data.Active),billing_mode:normalizeBillingMode(data.Billing_Mode),
      processing_enabled:Boolean(data.Processing_Enabled),updated_at:new Date().toISOString()})
      .eq('lab_organization_id',lab).eq('id',Number(data.ID));
    if(error)throw error;return;
  }
  return previousSupabaseAdminMutation(entity,action,data);
};

async function saveLabPricingSettings(){
  try{
    const lab=await resolveLabOrganizationId();
    const defaultContract=document.getElementById('pricingDefaultContract').value;
    const hours=Number(document.getElementById('pricingUrgentHours').value);
    if(!defaultContract||!Number.isInteger(hours)||hours<0)throw new Error('Alege contractul implicit și un interval valid.');
    const {error}=await supabaseClient.from('lab_order_pricing_settings').upsert({lab_organization_id:lab,
      default_contract:defaultContract,urgent_window_hours:hours,timezone:'Europe/Bucharest',updated_at:new Date().toISOString()});
    if(error)throw error;
    await loadAll(false);
  }catch(error){alert(error.message);}
}
async function saveLabContractDefaults(){
  try{
    const lab=await resolveLabOrganizationId(),contract=selectedAdminContract;
    const urgent=labPricingOptionalNumber(document.getElementById('contractUrgentPercent').value);
    const processing=labPricingOptionalNumber(document.getElementById('contractProcessingAmount').value);
    if(!contract||urgent===null||processing===null)throw new Error('Completează procentele și tarifele contractului.');
    const {error}=await supabaseClient.from('lab_contract_pricing_defaults').upsert({lab_organization_id:lab,
      contract,urgent_percent:urgent,processing_amount:processing},{onConflict:'lab_organization_id,contract'});
    if(error)throw error;
    await loadAll(false);
  }catch(error){alert(error.message);}
}
function labPartnerMappingSelect(id,current=''){
  const partners=partnerCatalog.filter(partner=>partner.active||partner.id===current);
  return `<label>Partener asociat pentru Lab Partner<select id="${id}">${optionHtml(partners.map(partner=>partner.id),current,true).replace(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g,(whole,value,attrs)=>{
    const partner=partners.find(row=>row.id===value);return partner?`<option value="${escapeHtml(value)}"${attrs}>${escapeHtml(partner.name)}</option>`:whole;
  })}</select></label>`;
}
const previousRenderAdminConfig=renderAdminConfig;
renderAdminConfig=function(...args){
  const result=previousRenderAdminConfig(...args);
  if(!isAdmin())return result;
  if(adminConfigTab==='users'){
    const selected=adminConfigData.users.find(user=>String(user.User_ID)===String(selectedAdminUser));
    document.querySelector('.admin-user-create-grid')?.insertAdjacentHTML('beforeend',labPartnerMappingSelect('newUserPartnerId'));
    document.querySelector('.admin-user-editor-grid')?.insertAdjacentHTML('beforeend',labPartnerMappingSelect('editUserPartnerId',selected?.Partner_ID||''));
  }
  if(adminConfigTab==='types'){
    const create=document.querySelector('.admin-worktype-add');
    create?.insertAdjacentHTML('beforeend','<label><input id="newWorkTypeProcessing" type="checkbox"> Prelucrare disponibilă</label>');
    const rows=[...document.querySelectorAll('.admin-config-table tbody tr')];
    rows.forEach((tr,index)=>{
      const record=adminConfigData.workTypes.filter(row=>!adminConfigSearch||normalize([row.Tip_Lucrare,row.Active].join(' ')).includes(normalize(adminConfigSearch)))
        .sort((a,b)=>String(a.Tip_Lucrare).localeCompare(String(b.Tip_Lucrare)))[index];
      if(record)tr.lastElementChild?.insertAdjacentHTML('beforebegin',`<td><label><input id="workTypeProcessing${record.ID}" type="checkbox" ${record.Processing_Enabled?'checked':''}> Prelucrare</label></td>`);
    });
    document.querySelector('.admin-config-table thead tr')?.lastElementChild?.insertAdjacentHTML('beforebegin','<th>Prelucrare</th>');
  }
  if(adminConfigTab==='prices'){
    const detail=document.querySelector('.admin-contract-detail');
    if(!detail)return result;
    const contracts=adminConfigData.contracts||[];
    detail.insertAdjacentHTML('afterbegin',`<div class="lab-pricing-settings card">
      <label>Contract implicit<select id="pricingDefaultContract">${optionHtml(contracts,labPricingAdmin.settings?.default_contract||'General',false)}</select></label>
      <label>Interval urgență (ore)<input id="pricingUrgentHours" type="number" min="0" step="1" value="${Number(labPricingAdmin.settings?.urgent_window_hours??24)}"></label>
      <button type="button" class="secondary-btn" id="savePricingSettings">Salvează regulile</button></div>`);
    document.getElementById('savePricingSettings').addEventListener('click',saveLabPricingSettings);
    if(selectedAdminContract){
      const defaults=labPricingAdmin.defaults.find(row=>row.contract===selectedAdminContract)||{};
      detail.querySelector('.admin-create-card')?.insertAdjacentHTML('beforebegin',`<div class="lab-pricing-settings card">
        <label>Urgență contract (%)<input id="contractUrgentPercent" type="number" min="0" step="0.01" value="${Number(defaults.urgent_percent??0)}"></label>
        <label>Prelucrare contract (sumă / bucată)<input id="contractProcessingAmount" type="number" min="0" step="0.01" value="${Number(defaults.processing_amount??0)}"></label>
        <button type="button" class="secondary-btn" id="saveContractDefaults">Salvează contractul</button></div>`);
      document.getElementById('saveContractDefaults').addEventListener('click',saveLabContractDefaults);
    }
    detail.querySelector('.admin-add-grid')?.insertAdjacentHTML('beforeend','<label>Urgență % (override)<input id="priceUrgentNew" type="number" min="0" step="0.01" placeholder="Moștenește"></label><label>Prelucrare (override)<input id="priceProcessingNew" type="number" min="0" step="0.01" placeholder="Moștenește"></label>');
    const visible=adminConfigData.prices.filter(row=>row.Contract===selectedAdminContract&&(!adminConfigSearch||normalize([row.Contract,row.Tip_Lucrare,row.Pret].join(' ')).includes(normalize(adminConfigSearch)))).sort((a,b)=>String(a.Tip_Lucrare).localeCompare(String(b.Tip_Lucrare)));
    detail.querySelectorAll('tbody tr').forEach((tr,index)=>{
      const row=visible[index];if(!row)return;
      tr.lastElementChild?.insertAdjacentHTML('beforebegin',`<td><input id="priceUrgent${row.ID}" type="number" min="0" step="0.01" value="${row.Urgent_Percent_Override??''}" placeholder="Contract"></td><td><input id="priceProcessing${row.ID}" type="number" min="0" step="0.01" value="${row.Processing_Amount_Override??''}" placeholder="Contract"></td>`);
    });
    detail.querySelector('thead tr')?.lastElementChild?.insertAdjacentHTML('beforebegin','<th>Urgență %</th><th>Prelucrare</th>');
  }
  return result;
};
