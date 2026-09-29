/* Scanned work orders are temporary modal data, never part of a report/export. */
let qrOpening=false;
let qrModalContext=null;
function closeScannedWorkOrder(){
  if(!qrModalContext)return;
  const {row,previous}=qrModalContext;
  const index=orders.indexOf(row);
  if(index>=0){if(previous)orders[index]=previous;else orders.splice(index,1);}
  qrModalContext=null;
}
async function openScannedWorkOrder(){
  if(!auth||qrOpening||qrModalContext)return;
  let token;
  try{token=WorkOrderQR.token(location.hash);}catch(error){alert(error.message);history.replaceState(null,'',location.pathname+location.search);return;}
  if(!token)return;
  qrOpening=true;
  const epoch=authEpoch,userId=auth.user.User_ID;
  showLoading('Deschid lucrarea','Verific accesul la fișa scanată…');
  try{
    const lab=await resolveLabOrganizationId();
    const row=await sbRpc('resolve_work_order_qr',{p_lab_organization_id:lab,p_token:token});
    if(!requestContextValid(epoch,userId))return;
    if(!row)throw new Error('Lucrarea nu este disponibilă sau nu ai acces. Verifică dacă folosești contul corect.');
    const order=dashboardMapRow(row);
    const index=orders.findIndex(o=>Number(o.id)===Number(order.id));
    qrModalContext={row:order,previous:index>=0?orders[index]:null};
    if(index>=0)orders[index]=order;else orders.push(order);
    await editOrder(order.id);
    if(modalBackdrop.classList.contains('hidden'))closeScannedWorkOrder();
    if(requestContextValid(epoch,userId))history.replaceState(null,'',location.pathname+location.search);
  }catch(error){
    if(requestContextValid(epoch,userId))alert(error.message);
    closeScannedWorkOrder();
  }finally{qrOpening=false;hideLoading();}
}
async function renderCaseSheetWithQr(order,draft){
  if(!orderedSelectedTeeth(draft.selected).length||!String(order.patient||'').trim()){
    return renderPhysicalCaseSheet(order,draft);
  }
  const reportWindow=window.open('','_blank','width=1050,height=850');
  if(!reportWindow){alert('Permite ferestrele pop-up pentru exportul fișei.');return false;}
  reportWindow.document.body.textContent='Pregătesc fișa și codul QR…';
  const epoch=authEpoch,userId=auth?.user?.User_ID;
  try{
    let markup='<p class="qr-draft-note">Salvează lucrarea pentru a genera codul QR.</p>';
    if(Number.isSafeInteger(Number(order.id))&&Number(order.id)>0){
      const lab=await resolveLabOrganizationId();
      const token=await sbRpc('get_work_order_qr_token',{p_lab_organization_id:lab,p_work_order_id:Number(order.id)});
      if(!requestContextValid(epoch,userId))throw new Error('Sesiunea s-a schimbat. Redeschide lucrarea.');
      const url=WorkOrderQR.link(token,new URL('./',location.href).href);
      markup=`<div class="case-qr"><a href="${escapeHtml(url)}" aria-label="Deschide lucrarea ${Number(order.id)}">${WorkOrderQR.svg(url)}</a><div><strong>Lucrare #${Number(order.id)}</strong><br>Scanează pentru fișa actualizată.<br>Acces cu autentificare.</div></div>`;
    }
    if(reportWindow.closed)return false;
    return renderPhysicalCaseSheet(order,draft,markup,reportWindow);
  }catch(error){reportWindow.close();throw error;}
}
window.addEventListener('hashchange',()=>{if(auth)void openScannedWorkOrder();});
