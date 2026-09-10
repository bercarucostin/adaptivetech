
const RUNTIME_CONFIG=window.FLOWRISE_RUNTIME||{};
const API_BASE=String(RUNTIME_CONFIG.n8nBaseUrl||"https://n8n.flowrisedental.ro/webhook").replace(/\/+$/,"");
const API={
  ai:`${API_BASE}/dental-lab-ai`
};

const AUTO_REFRESH_MS=5*60*1000;
const REQUEST_TIMEOUT_MS=600000;

const $=id=>document.getElementById(id);

const loginScreen=$("loginScreen"),appShell=$("appShell"),loginForm=$("loginForm"),loginUser=$("loginUser"),loginPassword=$("loginPassword"),loginBtn=$("loginBtn"),loginError=$("loginError");
const pageTitle=$("pageTitle"),pageSubtitle=$("pageSubtitle"),content=$("content"),connectionBadge=$("connectionBadge"),loadOlderBtn=$("loadOlderBtn"),toggleOldBtn=$("toggleOldBtn"),refreshBtn=$("refreshBtn"),newOrderBtn=$("newOrderBtn"),exportBtn=$("exportBtn"),lastRefresh=$("lastRefresh"),datasetScope=$("datasetScope"),logoutBtn=$("logoutBtn");
const userName=$("userName"),userRole=$("userRole"),userAvatar=$("userAvatar"),aiMode=$("aiMode");
const modalBackdrop=$("modalBackdrop"),modalTitle=$("modalTitle"),modalSubtitle=$("modalSubtitle"),closeModalBtn=$("closeModalBtn"),cancelModalBtn=$("cancelModalBtn"),orderForm=$("orderForm"),orderId=$("orderId"),dueDate=$("dueDate"),receptionDate=$("receptionDate"),status=$("status"),patient=$("patient"),patientSuggestions=$("patientSuggestions"),partner=$("partner"),partnerSuggestions=$("partnerSuggestions"),contract=$("contract"),discount=$("discount"),myStage=$("myStage");
const modelTech=$("modelTech"),statusModel=$("statusModel"),paidModel=$("paidModel"),modelingTech=$("modelingTech"),statusModeling=$("statusModeling"),paidModeling=$("paidModeling"),ceramicTech=$("ceramicTech"),statusCerFin=$("statusCerFin"),paidCerFin=$("paidCerFin"),listPrice=$("listPrice"),finalPrice=$("finalPrice"),priceHint=$("priceHint"),saveOrderBtn=$("saveOrderBtn");
const modelNotApplicable=$("modelNotApplicable"),modelingNotApplicable=$("modelingNotApplicable"),ceramicNotApplicable=$("ceramicNotApplicable");
const orderToothChart=$("orderToothChart"),orderToothStage=$("orderToothStage"),orderWorkTypeLegend=$("orderWorkTypeLegend"),orderToothPopover=$("orderToothPopover"),orderToothPopoverTitle=$("orderToothPopoverTitle"),orderToothPopoverMeta=$("orderToothPopoverMeta"),orderToothPreview=$("orderToothPreview"),orderToothTypeBadge=$("orderToothTypeBadge"),orderToothEmpty=$("orderToothEmpty"),orderToothForm=$("orderToothForm"),orderToothType=$("orderToothType"),orderToothTypeSuggestions=$("orderToothTypeSuggestions"),orderToothShade=$("orderToothShade"),orderToothMethod=$("orderToothMethod"),orderToothNote=$("orderToothNote"),orderToothPopoverClose=$("orderToothPopoverClose"),orderToothCancelBtn=$("orderToothCancelBtn"),orderToothSaveBtn=$("orderToothSaveBtn"),orderToothRemoveBtn=$("orderToothRemoveBtn"),orderTeethSelected=$("orderTeethSelected"),orderShade=$("orderShade"),orderMethod=$("orderMethod"),orderClinicNote=$("orderClinicNote"),orderProductionNotes=$("orderProductionNotes"),orderToothDetailsBody=$("orderToothDetailsBody"),orderSelectAnteriorBtn=$("orderSelectAnteriorBtn"),orderClearTeethBtn=$("orderClearTeethBtn"),orderCasePdfBtn=$("orderCasePdfBtn");
const orderApplySameShade=$("orderApplySameShade"),orderSameShadeWrap=$("orderSameShadeWrap");
const chatMessages=$("chatMessages"),chatForm=$("chatForm"),chatInput=$("chatInput"),sendBtn=$("sendBtn"),photoInput=$("photoInput"),voiceBtn=$("voiceBtn"),voiceState=$("voiceState"),newChatBtn=$("newChatBtn");
const mobileMenuBtn=$("mobileMenuBtn"),mobileSidebarCloseBtn=$("mobileSidebarCloseBtn"),mobileAiBtn=$("mobileAiBtn"),mobileAiCloseBtn=$("mobileAiCloseBtn"),mobileBackdrop=$("mobileBackdrop");
const sidebarCollapseBtn=$("sidebarCollapseBtn"),sidebarExpandBtn=$("sidebarExpandBtn"),aiCollapseBtn=$("aiCollapseBtn"),aiExpandBtn=$("aiExpandBtn");
const sidebar=document.querySelector(".sidebar"),aiPanel=document.querySelector(".ai-panel");
const caseSheetBackdrop=$("caseSheetBackdrop"),caseSheetTitle=$("caseSheetTitle"),caseSheetSubtitle=$("caseSheetSubtitle"),caseSheetContent=$("caseSheetContent"),closeCaseSheetBtn=$("closeCaseSheetBtn"),cancelCaseSheetBtn=$("cancelCaseSheetBtn"),saveCaseSheetBtn=$("saveCaseSheetBtn"),printCaseSheetBtn=$("printCaseSheetBtn"),caseSheetFooterHint=$("caseSheetFooterHint");
const partnershipNavLabel=$("partnershipNavLabel");
const caseFileInput=$("caseFileInput"),caseFileUploadBtn=$("caseFileUploadBtn"),caseFileQueue=$("caseFileQueue"),caseFileList=$("caseFileList"),caseFilesSetupNotice=$("caseFilesSetupNotice"),caseFilesPlanBadge=$("caseFilesPlanBadge");
const technicianAssignmentSummary=$("technicianAssignmentSummary");
const SUPABASE_CONFIG=window.FLOWRISE_SUPABASE||{};

const supabaseClient=(()=>{
  if(!SUPABASE_CONFIG?.enabled || !SUPABASE_CONFIG?.projectUrl || !SUPABASE_CONFIG?.publishableKey)return null;
  if(!window.supabase?.createClient)return null;

  return window.supabase.createClient(
    SUPABASE_CONFIG.projectUrl,
    SUPABASE_CONFIG.publishableKey,
    {
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        storage:window.sessionStorage,
        storageKey:"flowrise_supabase_auth"
      }
    }
  );
})();



let auth=null;
let orders=[];
let technicianSalaryRows=[];
let priceRules=[],technicianCostRules=[],contracts=[],workTypes=[],technicians=["Robert","Gabi","Denis"],statuses=["Not Started","Started","Finished","Shipped","List Sent","Paid"],stageStatuses=["Not Started","Started","Finished"],paidStatuses=["Paid","Not Paid"];
let currentView="workorders",workFilters={},workQuickFilters={status:"",partner:"",workType:""},techFilters={},loadingCount=0;
let workSort={key:"id",dir:"desc"};
let techSort={key:"id",dir:"desc"};
let patientSort={key:"deadline",dir:"desc"};
let partnerSort={key:"final",dir:"desc"};
let partnerReportFilters={status:"",partner:"",patient:"",workType:""};
let patientReportFilters={status:"",patient:"",partner:"",workType:""};
let technicianReportFilters={status:"",technician:"",partner:"",patient:"",workType:""};
let viewDateRanges={
  workorders:{deadlineFrom:"",deadlineTo:"",receptionDateFrom:"",receptionDateTo:""},
  production:{deadlineFrom:"",deadlineTo:""},
  partners:{deadlineFrom:"",deadlineTo:""},
  patients:{deadlineFrom:"",deadlineTo:""},
  technicians:{deadlineFrom:"",deadlineTo:""},
  materials:{lastUpdateFrom:"",lastUpdateTo:""}
};
let adminConfigData={prices:[],technicianCosts:[],workTypes:[],contracts:[],users:[],roles:[]};
let adminConfigTab="prices",adminConfigSearch="",selectedAdminContract="",selectedAdminTechnician="",selectedAdminUser="";
let calendarEvents=[],calendarLoaded=false,calendarLoading=false,calendarEditor=null;
let calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let materialsInventory=[],materialsLoaded=false,materialsLoading=false,materialsSearch="",materialEditor=null,materialSaving=false;
let partnershipTab="active";
let caseFileSelection=[];
let caseFilesSaved=[];
let caseFilesLoading=false;
let caseFilesUploading=false;

let caseSheetDrafts={};
let activeCaseSheetOrderId=null;
let orderCaseDraft=null;
let orderCaseLoaded=false;
let activeOrderTooth=null;
let activeOrderToothAnchor=null;
let activeOrderTeeth=[];
let activeOrderMixedFields=new Set();
let orderToothViewMode="upperlower";
let includeOlderOrders=false;
let workOrderScope={include_older:false,days:45,returned:0,total:0,cutoff_date:""};
let authEpoch=0;
let activeChatGeneration=0;
const activeControllers=new Set();
let hideOldOrders=localStorage.getItem("flowrise_hide_old_orders")==="true";
let mediaRecorder=null,mediaStream=null,audioChunks=[],isRecording=false;
let SESSION_ID=null;
let aiPendingOperation=null;

function aiPendingStorageKey(sessionId=SESSION_ID){return `flowrise_ai_pending_${String(sessionId||"")}`;}
function setAiPendingOperation(operation){
  aiPendingOperation=operation&&typeof operation==="object"?operation:null;
  if(!SESSION_ID)return;
  if(aiPendingOperation)sessionStorage.setItem(aiPendingStorageKey(),JSON.stringify(aiPendingOperation));
  else sessionStorage.removeItem(aiPendingStorageKey());
}
function restoreAiPendingOperation(){
  try{aiPendingOperation=JSON.parse(sessionStorage.getItem(aiPendingStorageKey())||"null");}
  catch{aiPendingOperation=null;}
}
function trackAiOperationResponse(data){
  if(data?.pending_operation)setAiPendingOperation(data.pending_operation);
  else if((data?.intent==="execute"&&data?.mutation?.ok)||data?.clear_pending)setAiPendingOperation(null);
}
function aiClientRequestId(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;}

function normalize(v){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function boolish(v){return v===true||v===1||["true","1","yes","y","locked"].includes(String(v??"").trim().toLowerCase());}
function money(v){return new Intl.NumberFormat("ro-RO",{style:"currency",currency:"RON",maximumFractionDigits:0}).format(num(v));}
function fmtDate(d){
  if(!d)return "—";
  const raw=String(d).trim();
  const parsed=/^\d{4}-\d{2}-\d{2}$/.test(raw)?`${raw}T12:00:00`:raw;
  const x=new Date(parsed);
  return Number.isNaN(x.getTime())?raw:x.toLocaleDateString("ro-RO",{day:"2-digit",month:"short",year:"numeric"});
}
function toDateInputValue(d){
  const raw=String(d??"").trim();
  const m=raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?m[1]:"";
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

const UI_TEXT_MAP={
  "Not Started":"Neînceput",
  "Started":"În lucru",
  "Finished":"Finalizat",
  "Shipped":"Expediat",
  "List Sent":"Listă trimisă",
  "Paid":"Plătit",
  "Not Paid":"Neplătit",
  "Coroană":"Coroană",
  "Corp de punte":"Corp de punte",
  "Fațetă":"Fațetă",
  "Coroană pe implant":"Coroană pe implant",
  "Provizoriu":"Provizoriu",
  "Structură":"Structură",
  "Altul":"Altul",
  "Metalo-ceramică":"Metalo-ceramică",
  "Compozit":"Compozit"
};
function uiText(value){
  const s=String(value??"");
  return UI_TEXT_MAP[s]??s;
}

function kpi(label,value,foot){return `<div class="card kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;}
function isTechnician(){return String(auth?.user?.Role||"").toLowerCase()==="technician";}
function isDoctor(){return String(auth?.user?.Role||"").toLowerCase()==="doctor";}
function isAdmin(){return String(auth?.user?.Role||"").toLowerCase()==="admin";}
function isManager(){return String(auth?.user?.Role||"").toLowerCase()==="manager";}
function isManagement(){return isAdmin()||isManager();}
function isClinicSide(){return isDoctor();}
function isLabSide(){return isManagement();}
function can(p){return Boolean(auth?.permissions?.[p]);}

function supabaseConfigured(){
  return Boolean(
    SUPABASE_CONFIG?.enabled &&
    String(SUPABASE_CONFIG?.projectUrl||"").trim() &&
    String(SUPABASE_CONFIG?.publishableKey||"").trim()
  );
}
function currentUploadLimitMB(){
  const value=Number(SUPABASE_CONFIG?.currentUploadLimitMB||45);
  return Number.isFinite(value)&&value>0?value:45;
}
function futureUploadLimitMB(){
  const value=Number(SUPABASE_CONFIG?.futureUploadLimitMB||200);
  return Number.isFinite(value)&&value>0?value:200;
}
function humanFileSize(bytes){
  const n=Number(bytes||0);
  if(n<1024)return `${n} B`;
  if(n<1024**2)return `${(n/1024).toFixed(1)} KB`;
  if(n<1024**3)return `${(n/1024**2).toFixed(1)} MB`;
  return `${(n/1024**3).toFixed(2)} GB`;
}


async function callFileAuthorization(action,workOrderId,extra={}){
  if(!supabaseClient)throw new Error("Conexiunea cu baza de date nu este disponibilă.");

  const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError||!session?.access_token){
    throw new Error("Sesiunea ta nu mai este validă. Autentifică-te din nou.");
  }

  const endpoint=`${String(SUPABASE_CONFIG.projectUrl).replace(/\/+$/,"")}/functions/v1/authorize-work-order-file`;

  const controller=new AbortController();
  activeControllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);

  try{
    const response=await fetch(endpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${session.access_token}`,
        "apikey":SUPABASE_CONFIG.publishableKey
      },
      body:JSON.stringify({
        action,
        work_order_id:Number(workOrderId),
        ...extra
      }),
      signal:controller.signal,
      cache:"no-store"
    });

    const text=await response.text();
    let payload=null;
    try{payload=text?JSON.parse(text):null;}catch{payload={message:text};}

    if(!response.ok||!payload?.ok){
      throw new Error(payload?.message||`File authorization failed (${response.status}).`);
    }

    return payload;
  }finally{
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}


function isMobileLayout(){return window.matchMedia("(max-width: 860px)").matches;}
function authPayload(extra={}){
  // Transitional bridge: n8n CRUD still validates the legacy 06 users password.
  // Remove password from this payload after CRUD migrates to Supabase/RLS.
  return {user_id:auth.user.User_ID,password:auth.password,...extra};
}

function makeSessionId(userId){
  return `session_${String(userId||"user").replace(/[^a-zA-Z0-9_-]/g,"")}_${crypto.randomUUID?.()||Date.now()}`;
}

function startFreshSession(userId){
  if(SESSION_ID)sessionStorage.removeItem(aiPendingStorageKey());
  SESSION_ID=makeSessionId(userId);
  sessionStorage.setItem("dental_lab_session_id",SESSION_ID);
  sessionStorage.setItem("dental_lab_session_user",String(userId||""));
  activeChatGeneration++;
  aiPendingOperation=null;
  chatMessages.innerHTML="";
}

function restoreSessionForUser(userId){
  const savedUser=sessionStorage.getItem("dental_lab_session_user");
  const savedSession=sessionStorage.getItem("dental_lab_session_id");
  if(savedUser===String(userId||"")&&savedSession){
    SESSION_ID=savedSession;
    restoreAiPendingOperation();
  }else{
    startFreshSession(userId);
  }
}

function abortActiveRequests(){
  for(const controller of [...activeControllers]){
    try{controller.abort();}catch{}
  }
  activeControllers.clear();
}

function resetRuntimeState(){
  orders=[];
  priceRules=[];
  contracts=[];
  workTypes=[];
  technicians=["Robert","Gabi","Denis"];
  statuses=["Not Started","Started","Finished","Shipped","List Sent","Paid"];
  stageStatuses=["Not Started","Started","Finished"];
  paidStatuses=["Paid","Not Paid"];
  currentView="workorders";
  workFilters={};
  workQuickFilters={status:"",partner:"",workType:""};
  techFilters={};
  workSort={key:"id",dir:"desc"};
  techSort={key:"id",dir:"desc"};
  patientSort={key:"deadline",dir:"desc"};
  partnerSort={key:"final",dir:"desc"};
  partnerReportFilters={status:"",partner:"",patient:"",workType:""};
  patientReportFilters={status:"",patient:"",partner:"",workType:""};
  technicianReportFilters={status:"",technician:"",partner:"",patient:"",workType:""};
  viewDateRanges={
    workorders:{deadlineFrom:"",deadlineTo:"",receptionDateFrom:"",receptionDateTo:""},
    production:{deadlineFrom:"",deadlineTo:""},
    partners:{deadlineFrom:"",deadlineTo:""},
    patients:{deadlineFrom:"",deadlineTo:""},
    technicians:{deadlineFrom:"",deadlineTo:""},
    materials:{lastUpdateFrom:"",lastUpdateTo:""}
  };
  adminConfigData={prices:[],technicianCosts:[],workTypes:[],contracts:[],users:[],roles:[]};
  adminConfigTab="prices";adminConfigSearch="";selectedAdminContract="";selectedAdminTechnician="";selectedAdminUser="";
  calendarEvents=[];calendarLoaded=false;calendarLoading=false;calendarEditor=null;
  calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  materialsInventory=[];materialsLoaded=false;materialsLoading=false;materialsSearch="";materialEditor=null;materialSaving=false;
  partnershipTab="active";
  caseFileSelection=[];
  caseFilesSaved=[];
  caseFilesLoading=false;
  caseFilesUploading=false;

  caseSheetDrafts={};
  activeCaseSheetOrderId=null;
  orderCaseDraft=null;
  orderCaseLoaded=false;
  activeOrderTooth=null;
  activeOrderToothAnchor=null;
  activeOrderTeeth=[];
  activeOrderMixedFields=new Set();
  orderToothViewMode="upperlower";
  includeOlderOrders=false;
  workOrderScope={include_older:false,days:45,returned:0,total:0,cutoff_date:""};
  if(caseSheetBackdrop)caseSheetBackdrop.classList.add("hidden");
  chatMessages.innerHTML="";
  content.innerHTML="";
  lastRefresh.textContent="Neactualizat încă";
  setConnection(null,"Se conectează...");
  activeChatGeneration++;
}

function requestContextValid(epoch,userId,chatGeneration=null){
  if(!auth||epoch!==authEpoch||String(auth.user.User_ID)!==String(userId))return false;
  if(chatGeneration!==null&&chatGeneration!==activeChatGeneration)return false;
  return true;
}

function applyDesktopPanelState(){
  const leftCollapsed=sessionStorage.getItem("flowrise_sidebar_collapsed")==="1";
  const aiCollapsed=sessionStorage.getItem("flowrise_ai_collapsed")==="1";
  appShell.classList.toggle("sidebar-collapsed",leftCollapsed&&!isMobileLayout());
  appShell.classList.toggle("ai-collapsed",aiCollapsed&&!isMobileLayout());
}

function setSidebarCollapsed(collapsed){
  sessionStorage.setItem("flowrise_sidebar_collapsed",collapsed?"1":"0");
  appShell.classList.toggle("sidebar-collapsed",Boolean(collapsed)&&!isMobileLayout());
}

function setAiCollapsed(collapsed){
  sessionStorage.setItem("flowrise_ai_collapsed",collapsed?"1":"0");
  appShell.classList.toggle("ai-collapsed",Boolean(collapsed)&&!isMobileLayout());
}

function openMobileMenu(){
  if(!isMobileLayout())return;
  closeMobileAi();
  sidebar?.classList.add("mobile-open");
  mobileBackdrop?.classList.remove("hidden");
  document.body.classList.add("mobile-drawer-active");
}
function closeMobileMenu(){
  sidebar?.classList.remove("mobile-open");
  if(!aiPanel?.classList.contains("mobile-open"))mobileBackdrop?.classList.add("hidden");
  if(!aiPanel?.classList.contains("mobile-open"))document.body.classList.remove("mobile-drawer-active");
}
function openMobileAi(){
  if(!isMobileLayout())return;
  closeMobileMenu();
  aiPanel?.classList.add("mobile-open");
  mobileAiBtn?.classList.add("active");
  mobileBackdrop?.classList.remove("hidden");
  document.body.classList.add("mobile-drawer-active");
  setTimeout(()=>chatInput?.focus(),180);
}
function closeMobileAi(){
  aiPanel?.classList.remove("mobile-open");
  mobileAiBtn?.classList.remove("active");
  if(!sidebar?.classList.contains("mobile-open"))mobileBackdrop?.classList.add("hidden");
  if(!sidebar?.classList.contains("mobile-open"))document.body.classList.remove("mobile-drawer-active");
}
function closeMobileDrawers(){
  closeMobileMenu();
  closeMobileAi();
}

function isOldOrder(o){
  if(!o?.deadline)return false;
  const d=new Date(`${o.deadline}T23:59:59`);
  if(Number.isNaN(d.getTime()))return false;
  const today=new Date();today.setHours(0,0,0,0);
  const oldStatuses=new Set(["Finished","Shipped","List Sent","Paid"]);
  return d<today && oldStatuses.has(o.status);
}
function displayedOrders(){return hideOldOrders?orders.filter(o=>!isOldOrder(o)):orders;}
function updateDatasetScope(){
  if(!loadOlderBtn||!datasetScope)return;
  const returned=Number(workOrderScope?.returned??orders.length);
  const total=Number(workOrderScope?.total??returned);
  const hidden=Math.max(0,total-returned);

  if(includeOlderOrders){
    loadOlderBtn.textContent="Ultimele 45 zile";
    loadOlderBtn.title="Revino la fereastra implicită de 45 de zile";
    loadOlderBtn.classList.add("active-toggle");
    datasetScope.textContent=`Istoric complet încărcat · ${returned} lucrări`;
  }else{
    loadOlderBtn.textContent=hidden>0?`Încarcă mai vechi (${hidden})`:"Încarcă mai vechi";
    loadOlderBtn.title="Încarcă lucrări cu termen mai vechi de 45 de zile";
    loadOlderBtn.classList.remove("active-toggle");
    datasetScope.textContent=`Default: last 45 days by Deadline · ${returned} loaded${hidden>0?` · ${hidden} older not loaded`:""}`;
  }
}

function updateOldToggle(){
  if(!toggleOldBtn)return;
  const oldCount=orders.filter(isOldOrder).length;
  toggleOldBtn.textContent=hideOldOrders?`Arată vechi (${oldCount})`:`Ascunde vechi (${oldCount})`;
  toggleOldBtn.classList.toggle("active-toggle",hideOldOrders);
  toggleOldBtn.disabled=oldCount===0;
}

function showLoading(title="Se încarcă...",text="Pun lucrurile în ordine..."){
  loadingCount++;$("flowLoadingTitle").textContent=title;$("flowLoadingText").textContent=text;$("flowLoading").classList.remove("hidden");
}
function hideLoading(){loadingCount=Math.max(0,loadingCount-1);if(loadingCount===0)$("flowLoading").classList.add("hidden");}
function setConnection(ok,text){connectionBadge.textContent=text;connectionBadge.classList.toggle("ok",ok===true);connectionBadge.classList.toggle("error",ok===false);}

async function fetchJson(url,body){
  const controller=new AbortController();
  activeControllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const r=await fetch(url,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Cache-Control":"no-cache, no-store, max-age=0",
        "Pragma":"no-cache"
      },
      cache:"no-store",
      body:JSON.stringify(body),
      signal:controller.signal
    });
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null;}catch{data=text;}
    if(!r.ok)throw new Error(data?.reply||data?.message||`${r.status} ${r.statusText}`);
    return data;
  }finally{
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

async function fetchForm(url,formData){
  const controller=new AbortController();
  activeControllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const r=await fetch(url,{
      method:"POST",
      headers:{
        "Cache-Control":"no-cache, no-store, max-age=0",
        "Pragma":"no-cache"
      },
      cache:"no-store",
      body:formData,
      signal:controller.signal
    });
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null;}catch{data=text;}
    if(!r.ok)throw new Error(data?.reply||data?.message||`${r.status} ${r.statusText}`);
    return data;
  }finally{
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}


async function supabaseIdentifierLogin(identifier,password){
  if(!supabaseConfigured()||!supabaseClient){
    throw new Error("Autentificarea nu este configurată corect.");
  }

  const fn=String(SUPABASE_CONFIG.loginFunction||"login-with-identifier").trim();
  const endpoint=`${String(SUPABASE_CONFIG.projectUrl).replace(/\/+$/,"")}/functions/v1/${encodeURIComponent(fn)}`;

  const controller=new AbortController();
  activeControllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);

  try{
    const response=await fetch(endpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":SUPABASE_CONFIG.publishableKey
      },
      body:JSON.stringify({identifier,password}),
      signal:controller.signal,
      cache:"no-store"
    });

    let payload=null;
    const text=await response.text();
    try{payload=text?JSON.parse(text):null;}catch{payload={message:text};}

    if(!response.ok){
      throw new Error(payload?.message||payload?.error||"Credentiale invalide.");
    }

    const session=payload?.session;
    const profile=payload?.profile;

    if(!session?.access_token||!session?.refresh_token||!profile?.id){
      throw new Error("Răspuns de autentificare incomplet.");
    }

    const {error:setError}=await supabaseClient.auth.setSession({
      access_token:session.access_token,
      refresh_token:session.refresh_token
    });
    if(setError)throw setError;

    return {session,profile};
  }finally{
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

async function validateSupabaseSavedSession(saved){
  if(!supabaseClient||!saved?.supabaseProfile?.id)return false;
  try{
    const {data,error}=await supabaseClient.auth.getSession();
    if(error||!data?.session?.user?.id)return false;
    return String(data.session.user.id)===String(saved.supabaseProfile.id);
  }catch{
    return false;
  }
}

function saveAuth(a){
  sessionStorage.setItem("dental_lab_auth",JSON.stringify({
    user:a.user,
    permissions:a.permissions,
    password:a.password,
    supabaseProfile:a.supabaseProfile||null,
    loginIdentifier:a.loginIdentifier||""
  }));
}

function loadSavedAuth(){
  try{
    const x=JSON.parse(sessionStorage.getItem("dental_lab_auth")||"null");
    if(x?.user?.User_ID&&x?.password&&x?.supabaseProfile?.id)return x;
  }catch{}
  return null;
}

function clearAuth({skipSupabaseSignOut=false}={}){
  abortActiveRequests();

  if(!skipSupabaseSignOut&&supabaseClient){
    // Fire-and-forget here; explicit Logout awaits signOut separately.
    supabaseClient.auth.signOut({scope:"local"}).catch(()=>{});
  }

  sessionStorage.removeItem("dental_lab_auth");
  sessionStorage.removeItem("dental_lab_session_id");
  sessionStorage.removeItem("dental_lab_session_user");
  if(SESSION_ID)sessionStorage.removeItem(aiPendingStorageKey());
  SESSION_ID=null;
  aiPendingOperation=null;
  auth=null;
  authEpoch++;
  resetRuntimeState();
}

async function login(identifier,password){
  const cleanIdentifier=String(identifier||"").trim().toLowerCase();
  if(!cleanIdentifier)throw new Error("Introdu nickname-ul sau emailul.");

  // 1) Supabase is now the real authentication layer.
  const sb=await supabaseIdentifierLogin(cleanIdentifier,password);
  const legacyIdentifier=String(sb.profile.legacy_user_id||"").trim();

  if(!legacyIdentifier){
    await supabaseClient?.auth.signOut({scope:"local"}).catch(()=>{});
    throw new Error("Profilul contului nu este complet configurat.");
  }

  // 2) Temporary bridge while Work Orders / AI still live in n8n.
  // The same password must exist in 06 users during this transition.
  let data;
  try{
    data=await fetchJson(API.login,{identifier:legacyIdentifier,password});
  }catch(err){
    await supabaseClient?.auth.signOut({scope:"local"}).catch(()=>{});
    throw new Error(
      `Autentificarea a reușit, dar profilul nu a putut fi validat. (${err.message})`
    );
  }

  if(!data?.ok){
    await supabaseClient?.auth.signOut({scope:"local"}).catch(()=>{});
    throw new Error(data?.reply||"Autentificarea nu a putut fi finalizată");
  }

  auth={
    user:data.user,
    permissions:data.permissions,
    password,
    supabaseProfile:sb.profile,
    loginIdentifier:cleanIdentifier
  };
  authEpoch++;
  saveAuth(auth);
  startFreshSession(auth.user.User_ID);
}

function applyRoleUI(){
  userName.textContent=auth.user.Name||auth.user.User_ID;
  const nickname=String(auth?.supabaseProfile?.username||"").trim();
  userRole.textContent=nickname?`${auth.user.Role} · @${nickname}`:auth.user.Role;
  userAvatar.textContent=(auth.user.Name||auth.user.User_ID||"?").charAt(0).toUpperCase();

  if(isDoctor()){
    aiMode.textContent=`Portal medic · ${auth.user.Partner_Name||"partener neconfigurat"}`;
    chatInput.placeholder="AI-ul nu este disponibil pentru rolul Doctor.";
  }else if(isTechnician()){
    aiMode.textContent=`AI ghidat tehnician · ${auth.user.Technician_Name}`;
    chatInput.placeholder="Întreabă despre lucrările alocate sau actualizează etapa ta...";
  }else{
    aiMode.textContent="";
    chatInput.placeholder="Întreabă despre datele laboratorului sau creează / actualizează / șterge lucrări...";
  }

  document.querySelectorAll("[data-permission]").forEach(el=>{
    const allowed=can(el.dataset.permission);
    el.classList.toggle("hidden",!allowed);
  });

  document.querySelectorAll(".management-only").forEach(el=>el.classList.toggle("hidden",!isManagement()));
  document.querySelectorAll(".technician-only").forEach(el=>el.classList.toggle("hidden",!isTechnician()));
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin()));
  document.querySelectorAll(".doctor-hidden").forEach(el=>el.classList.toggle("hidden",isDoctor()));
  document.querySelectorAll(".doctor-management-only").forEach(el=>el.classList.toggle("hidden",isTechnician()));

  if(partnershipNavLabel){
    partnershipNavLabel.textContent=isDoctor()?"Laboratoare":"Clinici & colaborări";
  }

  newOrderBtn.classList.toggle("hidden",!(can("Can_Create_Work_Orders")||isTechnician()));

  // Doctor uses the clinic-facing subset: Work Orders, Production and Clinic↔Lab partnerships.
  appShell.classList.toggle("doctor-role-mode",isDoctor());
  mobileAiBtn?.classList.toggle("hidden",isDoctor());
  aiExpandBtn?.classList.toggle("hidden",isDoctor());
  if(isDoctor()){
    closeMobileAi();
    aiPanel?.classList.remove("mobile-open");
  }

  const visibleNav=[...document.querySelectorAll(".nav-item:not(.hidden)")];
  if(!visibleNav.some(x=>x.dataset.view===currentView)){
    currentView=visibleNav[0]?.dataset.view||"workorders";
  }
}

function showApp(){
  loginScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  applyRoleUI();
  applyDesktopPanelState();
}

function showLogin(){
  appShell.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginPassword.value="";
  loginError.textContent="";
}

loginForm.addEventListener("submit",async e=>{
  e.preventDefault();
  loginBtn.disabled=true;
  loginError.textContent="";
  showLoading("Autentificare","Verific accesul și pregătesc spațiul de lucru...");

  try{
    abortActiveRequests();
    resetRuntimeState();
    await login(loginUser.value.trim(),loginPassword.value);

    // Keep login screen visible until ALL role-scoped data has loaded.
    await initializeApp({showLoader:false});
    showApp();
  }catch(err){
    loginError.textContent=err.message;
    clearAuth();
    showLogin();
  }finally{
    hideLoading();
    loginBtn.disabled=false;
  }
});

logoutBtn.addEventListener("click",async()=>{
  closeMobileDrawers();
  try{
    if(supabaseClient)await supabaseClient.auth.signOut({scope:"local"});
  }catch{}
  clearAuth({skipSupabaseSignOut:true});
  showLogin();
});

function serverOrder(r){
  return {
    id:num(r.ID),deadline:r.Deadline??"",receptionDate:r.Data_Receptie??"",status:r.Status??"Not Started",patient:r.Nume_Pacient??"",partner:r.Nume_Partener??"",
    contract:r.Contract??"",items:Array.isArray(r.Items)?r.Items:[],workTypes:Array.isArray(r.Work_Types)?r.Work_Types:[],workType:r.Work_Type_Summary??"",elements:num(r.Element_Count),
    modelTech:r.Tehnician_Model??"",modelingTech:r.Tehnician1_Modelare??"",ceramicTech:r.Tehnician2_Cer_Fin??"",
    statusModel:r.Status_Model??"Not Started",statusModeling:r.Status_Modelare??"Not Started",statusCerFin:r.Status_Cer_Fin??"Not Started",
    paidModel:r.Paid_Model??"Not Paid",paidModeling:r.Paid_Modelare??"Not Paid",paidCerFin:r.Paid_Cer_Fin??"Not Paid",
    discount:num(r.Discount),listPrice:num(r.Total_Pret_Lista),finalPrice:num(r.Total_dupa_Discount),
    costModel:num(r.Cost_Model),costModeling:num(r.Cost_Modelare),costCerFin:num(r.Cost_Cer_Fin),totalTechCost:num(r.Cost_Total_Tehnicieni),
    myStages:Array.isArray(r.My_Stages)?r.My_Stages:[],ownCost:num(r.Own_Technician_Cost),
    clinicNote:String(r.Clinic_Note??""),locked:boolish(r.Locked)
  };
}

async function loadAll(show=true){
  if(!auth)throw new Error("Neautentificat");
  const epoch=authEpoch;
  const userId=auth.user.User_ID;

  if(show)showLoading("Actualizez","Caut cele mai noi date...");

  try{
    const adminPromise=isAdmin()
      ? fetchJson(API.adminConfig,authPayload({action:"list"}))
      : Promise.resolve(null);

    const [wo,ref,adminData]=await Promise.all([
      fetchJson(API.workOrders,authPayload({include_older:includeOlderOrders})),
      fetchJson(API.referenceData,authPayload()),
      adminPromise
    ]);

    if(!requestContextValid(epoch,userId))return;
    if(!Array.isArray(wo?.work_orders))throw new Error("Răspuns neașteptat pentru lucrări.");

    // Replace every dataset atomically. Never retain a prior user's values.
    orders=wo.work_orders.map(serverOrder);
    workOrderScope=wo?.scope??{include_older:includeOlderOrders,days:45,returned:orders.length,total:orders.length,cutoff_date:""};
    includeOlderOrders=Boolean(workOrderScope.include_older);
    updateDatasetScope();
    priceRules=Array.isArray(ref?.prices)?ref.prices:[];
    contracts=Array.isArray(ref?.contracts)?ref.contracts:[];
    workTypes=Array.isArray(ref?.work_types)?ref.work_types:[];
    technicians=Array.isArray(ref?.technicians)
      ? [...ref.technicians]
      : (isTechnician()?[auth.user.Technician_Name].filter(Boolean):["Robert","Gabi","Denis"]);
    statuses=Array.isArray(ref?.statuses)?[...ref.statuses]:["Not Started","Started","Finished","Shipped","List Sent","Paid"];
    stageStatuses=Array.isArray(ref?.stage_statuses)?[...ref.stage_statuses]:["Not Started","Started","Finished"];
    paidStatuses=Array.isArray(ref?.paid_statuses)?[...ref.paid_statuses]:["Paid","Not Paid"];
    calendarLoaded=false;
    materialsLoaded=false;

    if(isAdmin()){
      if(!adminData?.ok)throw new Error(adminData?.reply||"Nu s-a putut încărca Configurarea admin");
      adminConfigData={
        prices:Array.isArray(adminData.prices)?adminData.prices:[],
        technicianCosts:Array.isArray(adminData.technician_costs)?adminData.technician_costs:[],
        workTypes:Array.isArray(adminData.work_types)?adminData.work_types:[],
        contracts:Array.isArray(adminData.contracts)?adminData.contracts:[],
        users:Array.isArray(adminData.users)?adminData.users:[],
        roles:Array.isArray(adminData.roles)?adminData.roles:[]
      };
    }else{
      adminConfigData={prices:[],technicianCosts:[],workTypes:[],contracts:[],users:[],roles:[]};
    }

    lastRefresh.textContent=`Updated ${new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
    setConnection(true,"Conectat");
    render();
  }catch(err){
    if(requestContextValid(epoch,userId)){
      setConnection(false,"Eroare de conexiune");
      if(String(err.message).toLowerCase().includes("invalid user")||
         String(err.message).toLowerCase().includes("unauthorized")){
        clearAuth();
        showLogin();
      }
    }
    throw err;
  }finally{
    if(show)hideLoading();
  }
}

function optionHtml(values,current="",allowBlank=true){
  const unique=[...new Set(values.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").map(String))];
  if(current&&!unique.includes(current))unique.unshift(current);
  return `${allowBlank?'<option value="">—</option>':""}${unique.map(v=>`<option value="${escapeHtml(v)}" ${v===current?"selected":""}>${escapeHtml(uiText(v))}</option>`).join("")}`;
}

function orderStageRows(o={}){
  return [
    {stage:"Model",field:"Status_Model",tech:o.modelTech||"",status:o.statusModel||"Not Started",notApplicable:Boolean(o.modelNotApplicable)},
    {stage:"Modelare",field:"Status_Modelare",tech:o.modelingTech||"",status:o.statusModeling||"Not Started",notApplicable:Boolean(o.modelingNotApplicable)},
    {stage:"Cer / Fin",field:"Status_Cer_Fin",tech:o.ceramicTech||"",status:o.statusCerFin||"Not Started",notApplicable:Boolean(o.ceramicNotApplicable)}
  ];
}

function allowedOrderStatuses(o={}){
  const applicable=orderStageRows(o).filter(s=>!s.notApplicable);
  const unfinished=applicable.some(s=>s.status!=="Finished");
  return unfinished?["Not Started","Started"]:statuses;
}

function visibleProductionStatuses(){
  return isDashboard()
    ? statuses.filter(stage=>!['List Sent','Paid'].includes(stage))
    : statuses;
}

function orderStatusOptions(o={}){
  const allowed=allowedOrderStatuses(o);
  const current=allowed.includes(o.status)?o.status:(o.status==="Not Started"?"Not Started":"Started");
  return optionHtml(allowed,current,false);
}

function renderTechnicianAssignmentSummary(o=null){
  if(!technicianAssignmentSummary)return;
  if(!isTechnician()||!o){
    technicianAssignmentSummary.classList.add("hidden");
    technicianAssignmentSummary.innerHTML="";
    return;
  }

  const ownTech=normalize(auth?.user?.Technician_Name||"");
  technicianAssignmentSummary.innerHTML=orderStageRows(o).map(stage=>{
    const mine=Boolean(ownTech)&&normalize(stage.tech)===ownTech;
    if(stage.notApplicable){
      return `<article class="technician-assignment-card is-not-applicable">
        <div class="technician-assignment-head"><strong>${escapeHtml(stage.stage)}</strong><span>Nu se aplică</span></div>
        <div class="technician-assignment-value">Etapă exclusă din flux</div>
      </article>`;
    }
    const editable=mine&&!Boolean(o.locked);
    const statusControl=editable
      ? `<select class="technician-stage-status-select" data-technician-stage-field="${escapeHtml(stage.field)}" aria-label="Status ${escapeHtml(stage.stage)}">${optionHtml(stageStatuses,stage.status,false)}</select>`
      : `<strong>${escapeHtml(uiText(stage.status))}</strong>`;
    return `<article class="technician-assignment-card ${mine?"is-mine":""}">
      <div class="technician-assignment-head"><strong>${escapeHtml(stage.stage)}</strong>${mine?'<span class="technician-own-stage">Etapa ta</span>':""}</div>
      <div class="technician-assignment-row"><span>Tehnician</span><strong>${escapeHtml(stage.tech)||"Neasignat"}</strong></div>
      <div class="technician-assignment-row"><span>Status</span>${statusControl}</div>
    </article>`;
  }).join("");
  technicianAssignmentSummary.classList.remove("hidden");
}

function populateFormOptions(o={}){
  status.innerHTML=orderStatusOptions(o);
  contract.innerHTML=optionHtml(contracts,o.contract||"",false);
  modelTech.innerHTML=optionHtml(technicians,o.modelTech||"",true);
  modelingTech.innerHTML=optionHtml(technicians,o.modelingTech||"",true);
  ceramicTech.innerHTML=optionHtml(technicians,o.ceramicTech||"",true);
  statusModel.innerHTML=optionHtml(stageStatuses,o.statusModel||"Not Started",false);
  statusModeling.innerHTML=optionHtml(stageStatuses,o.statusModeling||"Not Started",false);
  statusCerFin.innerHTML=optionHtml(stageStatuses,o.statusCerFin||"Not Started",false);
  paidModel.innerHTML=optionHtml(paidStatuses,o.paidModel||"Not Paid",false);
  paidModeling.innerHTML=optionHtml(paidStatuses,o.paidModeling||"Not Paid",false);
  paidCerFin.innerHTML=optionHtml(paidStatuses,o.paidCerFin||"Not Paid",false);
  modelNotApplicable.checked=Boolean(o.modelNotApplicable);
  modelingNotApplicable.checked=Boolean(o.modelingNotApplicable);
  ceramicNotApplicable.checked=Boolean(o.ceramicNotApplicable);
  syncStageApplicabilityControls();
}

function formOrderStatusSnapshot(){
  return {
    status:status?.value||"Not Started",
    statusModel:statusModel?.value||"Not Started",
    statusModeling:statusModeling?.value||"Not Started",
    statusCerFin:statusCerFin?.value||"Not Started",
    modelNotApplicable:Boolean(modelNotApplicable?.checked),
    modelingNotApplicable:Boolean(modelingNotApplicable?.checked),
    ceramicNotApplicable:Boolean(ceramicNotApplicable?.checked)
  };
}

function syncOrderStatusChoices(){
  if(!status)return;
  const snapshot=formOrderStatusSnapshot();
  const allowed=allowedOrderStatuses(snapshot);
  const next=allowed.includes(snapshot.status)?snapshot.status:(snapshot.status==="Not Started"?"Not Started":"Started");
  status.innerHTML=optionHtml(allowed,next,false);
}

function syncStageApplicabilityControls(){
  [
    [modelNotApplicable,modelTech,statusModel,paidModel],
    [modelingNotApplicable,modelingTech,statusModeling,paidModeling],
    [ceramicNotApplicable,ceramicTech,statusCerFin,paidCerFin]
  ].forEach(([checkbox,techControl,statusControl,paidControl])=>{
    if(!checkbox)return;
    const inactive=checkbox.checked;
    checkbox.closest(".production-stage-card")?.classList.toggle("stage-not-applicable",inactive);
    [techControl,statusControl,paidControl].forEach(control=>{if(control)control.disabled=inactive;});
    if(inactive){
      if(techControl)techControl.value="";
      if(statusControl)statusControl.value="Not Started";
      if(paidControl)paidControl.value="Not Paid";
    }
  });
  syncOrderStatusChoices();
}
function setFormContractValue(value){
  const next=String(value||"General").trim()||"General";
  const existingOption=contract
    ? Array.from(contract.options||[]).find(option=>normalize(option.value)===normalize(next))
    : null;
  if(contract&&!existingOption){
    const option=document.createElement("option");
    option.value=next;
    option.textContent=next;
    contract.appendChild(option);
  }
  if(contract)contract.value=existingOption?.value||next;
}

function sortComparable(value,type="text"){
  if(value===null||value===undefined||value==="")return null;

  if(type==="number"){
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }

  if(type==="date"){
    const raw=String(value).trim();
    const t=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw)?`${raw}T12:00:00`:raw);
    return Number.isFinite(t)?t:null;
  }

  return normalize(value);
}

function sortedByColumns(rows,cols,sortState){
  if(!sortState?.key)return [...rows];

  const col=cols.find(c=>c.key===sortState.key);
  if(!col)return [...rows];

  const dir=sortState.dir==="desc"?-1:1;
  const type=col.sortType||col.type||"text";

  return [...rows].sort((a,b)=>{
    const rawA=typeof col.sortValue==="function"?col.sortValue(a):a[col.key];
    const rawB=typeof col.sortValue==="function"?col.sortValue(b):b[col.key];
    const va=sortComparable(rawA,type);
    const vb=sortComparable(rawB,type);

    if(va===null&&vb===null)return 0;
    if(va===null)return 1;
    if(vb===null)return -1;

    if(typeof va==="number"&&typeof vb==="number"){
      return (va-vb)*dir;
    }
    return String(va).localeCompare(String(vb),undefined,{numeric:true,sensitivity:"base"})*dir;
  });
}

function sortableHeader(col,scope,sortState){
  if(col.type==="none"||col.sortable===false)return `<th>${col.label}</th>`;
  const active=sortState?.key===col.key;
  const arrow=active?(sortState.dir==="asc"?"▲":"▼"):"↕";
  return `<th>
    <button class="sort-header ${active?"active":""}" type="button"
      data-sort-scope="${scope}" data-sort-key="${col.key}"
      title="Sortează după ${escapeHtml(col.label)}">
      <span>${col.label}</span><span class="sort-arrow">${arrow}</span>
    </button>
  </th>`;
}

function changeSort(scope,key){
  const map={
    work:workSort,
    tech:techSort,
    patient:patientSort,
    partner:partnerSort
  };
  const state=map[scope];
  if(!state)return;

  if(state.key===key){
    state.dir=state.dir==="asc"?"desc":"asc";
  }else{
    state.key=key;
    state.dir="asc";
  }

  if(scope==="work")renderWorkOrders();
  else if(scope==="tech")renderTechnicians();
  else if(scope==="patient")renderPatients();
  else if(scope==="partner")renderPartners();
}

function wireSortHeaders(){
  document.querySelectorAll("[data-sort-scope][data-sort-key]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      changeSort(btn.dataset.sortScope,btn.dataset.sortKey);
    });
  });
}

function filterMatch(value,filter,type){
  if(filter===undefined||filter===null||String(filter).trim()==="")return true;
  if(type==="number"){
    const f=String(filter).trim(),m=f.match(/^(>=|<=|>|<|=)\s*(-?\d+(\.\d+)?)$/);
    if(m){const v=num(value),x=Number(m[2]);if(m[1]===">=")return v>=x;if(m[1]==="<=")return v<=x;if(m[1]===">")return v>x;if(m[1]==="<")return v<x;return v===x;}
    return String(value).includes(f);
  }
  return normalize(value).includes(normalize(filter));
}


function dateOnlyValue(value){
  return toDateInputValue(value)||"";
}

function dateValueInRange(value,from,to){
  const d=dateOnlyValue(value);
  if(!from&&!to)return true;
  if(!d)return false;
  if(from&&d<from)return false;
  if(to&&d>to)return false;
  return true;
}

function applyViewDateRanges(rows,scope){
  const f=viewDateRanges[scope]||{};
  return (rows||[]).filter(row=>{
    const pairs=[];
    if("deadlineFrom" in f||"deadlineTo" in f)pairs.push([row.deadline,f.deadlineFrom,f.deadlineTo]);
    if("receptionDateFrom" in f||"receptionDateTo" in f)pairs.push([row.receptionDate,f.receptionDateFrom,f.receptionDateTo]);
    if("lastUpdateFrom" in f||"lastUpdateTo" in f)pairs.push([row.lastUpdate,f.lastUpdateFrom,f.lastUpdateTo]);
    return pairs.every(([value,from,to])=>dateValueInRange(value,from,to));
  });
}

function openRangeDatePicker(button){
  const input=button?.parentElement?.querySelector('input[type="date"]');
  if(!input)return;
  try{
    if(typeof input.showPicker==="function"){
      input.showPicker();
      return;
    }
  }catch(_err){}
  input.focus();
  input.click();
}
window.openRangeDatePicker=openRangeDatePicker;

function dateRangeFilterBar(scope,definitions){
  const f=viewDateRanges[scope]||{};
  const groups=(definitions||[]).map(def=>{
    const fromKey=`${def.field}From`,toKey=`${def.field}To`;
    return `<div class="date-range-group">
      <span class="date-range-label">${escapeHtml(def.label)}</span>
      <label>De la
        <div class="range-date-input">
          <input type="date" data-date-range-scope="${scope}" data-date-range-key="${fromKey}" value="${escapeHtml(f[fromKey]||"")}">
          <button type="button" onclick="openRangeDatePicker(this)" title="Deschide calendar">📅</button>
        </div>
      </label>
      <label>Până la
        <div class="range-date-input">
          <input type="date" data-date-range-scope="${scope}" data-date-range-key="${toKey}" value="${escapeHtml(f[toKey]||"")}">
          <button type="button" onclick="openRangeDatePicker(this)" title="Deschide calendar">📅</button>
        </div>
      </label>
    </div>`;
  }).join("");

  const hasValue=Object.values(f).some(Boolean);
  return `<div class="date-range-filter-card">
    <div class="date-range-filter-head"><strong>Interval de timp</strong><span>Selectează cu mouse-ul sau introdu manual data.</span></div>
    <div class="date-range-filter-body">${groups}</div>
    ${hasValue?`<button class="secondary-btn date-range-clear" type="button" data-clear-date-range="${scope}">Resetează intervalul</button>`:""}
  </div>`;
}

function clearViewDateRange(scope){
  const f=viewDateRanges[scope];
  if(!f)return;
  Object.keys(f).forEach(k=>f[k]="");
}

function wireDateRangeFilters(scope,rerender){
  document.querySelectorAll(`[data-date-range-scope="${scope}"]`).forEach(input=>{
    input.addEventListener("change",e=>{
      const key=e.target.dataset.dateRangeKey;
      viewDateRanges[scope][key]=e.target.value||"";
      rerender();
    });
  });
  document.querySelector(`[data-clear-date-range="${scope}"]`)?.addEventListener("click",()=>{
    clearViewDateRange(scope);
    rerender();
  });
}

function rangeFilterCell(key){
  return key==="deadline"||key==="receptionDate"
    ? '<span class="range-filter-note">interval sus</span>'
    : null;
}

function updateTopActionsForView(){
  const orderView=["workorders","production","patients"].includes(currentView);
  newOrderBtn?.classList.toggle("hidden",!orderView||!(can("Can_Create_Work_Orders")||isTechnician()));
  const usesOrders=["workorders","production","partners","patients","technicians"].includes(currentView);
  loadOlderBtn?.classList.toggle("hidden",!usesOrders);
  toggleOldBtn?.classList.toggle("hidden",!usesOrders);
  datasetScope?.classList.toggle("hidden",!usesOrders);
}

function render(){
  if(currentView!=="production")document.body.classList.remove("dashboard-production-maximized");
  document.querySelectorAll(".nav-item,.mobile-nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView));
  updateTopActionsForView();
  if(currentView==="workorders")renderWorkOrders();
  else if(currentView==="production")renderProduction();
  else if(currentView==="partners")renderPartners();
  else if(currentView==="patients")renderPatients();
  else if(currentView==="technicians")renderTechnicians();
  else if(currentView==="calendar")renderCalendar();
  else if(currentView==="materials")renderMaterials();
  else if(currentView==="partnerships")renderPartnerships();
  else if(currentView==="adminconfig")renderAdminConfig();
}

function technicianStageHtml(o,editable=true){
  const ownTech=normalize(auth?.user?.Technician_Name||"");
  const rows=orderStageRows(o);
  return `<div class="stage-stack">${rows.map(s=>{
    if(s.notApplicable)return `<div class="stage-pill stage-pill-na"><span class="stage-name">${escapeHtml(s.stage)}</span><span>Nu se aplică</span></div>`;
    const mine=Boolean(ownTech)&&normalize(s.tech)===ownTech;
    const statusControl=editable&&mine&&!Boolean(o.locked)&&can("Can_Edit_Own_Stage_Status")
      ? `<select class="status-select" onchange="quickUpdate(${o.id},'${s.field}',this.value)">${optionHtml(stageStatuses,s.status,false)}</select>`
      : `<span>${escapeHtml(uiText(s.status))}</span>`;
    return `<div class="stage-pill ${mine?"stage-pill-mine":""}"><span class="stage-name">${escapeHtml(s.stage)}</span><span class="stage-technician">${escapeHtml(s.tech)||"Neasignat"}</span>${statusControl}</div>`;
  }).join("")}</div>`;
}


function mobileOrderSearchText(o){
  return normalize([
    o.id,o.deadline,o.receptionDate,o.status,o.patient,o.partner,o.contract,o.workType,o.elements,
    o.modelTech,o.modelingTech,o.ceramicTech,o.statusModel,o.statusModeling,o.statusCerFin
  ].join(" "));
}

function mobileWorkOrderCard(o){
  if(isTechnician()){
    return `<article class="mobile-order-card">
      <div class="mobile-card-actions mobile-card-actions-left technician-view-actions">
        <button class="edit-btn mobile-touch-btn" type="button" onclick="editOrder(${o.id})">🦷 Vezi fișa</button>
      </div>
      <div class="mobile-card-head">
        <div>
          <div class="mobile-id">#${o.id}</div>
          <strong>${escapeHtml(o.patient)||"—"}</strong>
          <div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div>
        </div>
        <div class="mobile-card-badges">
          <span class="mobile-status-badge">${escapeHtml(o.status||"Not Started")}</span>
          <span class="mobile-deadline">${fmtDate(o.deadline)}</span>
        </div>
      </div>
      <div class="mobile-card-grid">
        <div><span>Work type</span><strong>${escapeHtml(o.workType)||"—"}</strong></div>
        <div><span>Elements</span><strong>${o.elements}</strong></div>
      </div>
      <div class="mobile-stage-block">
        <div class="mobile-section-label">Etape și tehnicieni asignați</div>
        ${technicianStageHtml(o,true)}
      </div>
    </article>`;
  }

  return `<article class="mobile-order-card">
    <div class="mobile-card-actions mobile-card-actions-left">
      <button class="edit-btn mobile-touch-btn" type="button" onclick="editOrder(${o.id})">Editează</button>
      ${can("Can_Edit_All_Work_Orders")?`<button class="lock-btn mobile-touch-btn ${o.locked?"is-locked":""}" type="button" onclick="setOrderLock(${o.id},${o.locked?"false":"true"})">${o.locked?"🔓 Deblochează":"🔒 Blochează"}</button><button class="danger-btn mobile-touch-btn" type="button" onclick="deleteOrder(${o.id})">Șterge</button>`:""}
    </div>
    <div class="mobile-card-head">
      <div>
        <div class="mobile-id">#${o.id}</div>
        <strong>${escapeHtml(o.patient)||"—"}</strong>
        <div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div>
      </div>
      <span class="mobile-deadline">${fmtDate(o.deadline)}</span>
    </div>

    <div class="mobile-primary-status">
      <label>Status
        <select class="status-select" onchange="quickUpdate(${o.id},'Status',this.value)">
          ${orderStatusOptions(o)}
        </select>
      </label>
    </div>

    <div class="mobile-card-grid">
      <div><span>Work type</span><strong>${escapeHtml(o.workType)||"—"}</strong></div>
      <div><span>Elements</span><strong>${o.elements}</strong></div>
      <div><span>Final value</span><strong>${money(o.finalPrice)}</strong></div>
      <div><span>Discount</span><strong>${o.discount}%</strong></div>
    </div>

    <details class="mobile-details">
      <summary>More details</summary>
      <div class="mobile-detail-list">
        <div><span>Data recepție</span><strong>${fmtDate(o.receptionDate)}</strong></div>
        <div><span>Contract</span><strong>${escapeHtml(o.contract)||"—"}</strong></div>
        <div><span>List value</span><strong>${money(o.listPrice)}</strong></div>
        <div><span>Model</span><strong>${escapeHtml(o.modelTech)||"—"} · ${escapeHtml(uiText(o.statusModel))||"—"}</strong></div>
        <div><span>Modelare</span><strong>${escapeHtml(o.modelingTech)||"—"} · ${escapeHtml(uiText(o.statusModeling))||"—"}</strong></div>
        <div><span>Cer Fin</span><strong>${escapeHtml(o.ceramicTech)||"—"} · ${escapeHtml(uiText(o.statusCerFin))||"—"}</strong></div>
      </div>
    </details>

  </article>`;
}


function applyWorkQuickFilters(rows){
  const f=workQuickFilters||{};
  return (rows||[]).filter(o=>{
    if(f.status && String(o.status||"")!==String(f.status))return false;
    if(f.partner && String(o.partner||"")!==String(f.partner))return false;
    if(f.workType && String(o.workType||"")!==String(f.workType))return false;
    return true;
  });
}

function workOrdersQuickFilterBar(){
  const available=displayedOrders();
  const partnerValues=[...new Set(available.map(o=>String(o.partner||"").trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  const workTypeValues=[...new Set(available.map(o=>String(o.workType||"").trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  const hasValue=Object.values(workQuickFilters||{}).some(Boolean);

  return `<div class="work-quick-filter-card">
    <div class="work-quick-filter-head">
      <div><strong>Filtre lucrări</strong><span>${isDoctor()?"Status și tip lucrare":"Status, partener și tip lucrare"}</span></div>
      ${hasValue?'<button class="secondary-btn" id="clearWorkQuickFilters" type="button">Resetează</button>':""}
    </div>
    <div class="work-quick-filter-grid ${isDoctor()?"doctor-quick-filter-grid":""}">
      <label>Status lucrare
        <select data-work-quick-filter="status">
          <option value="">Toate statusurile</option>
          ${optionHtml(statuses,workQuickFilters.status||"",false)}
        </select>
      </label>
      ${isDoctor()?"":`<label>Nume partener
        <select data-work-quick-filter="partner">
          <option value="">Toți partenerii</option>
          ${optionHtml(partnerValues,workQuickFilters.partner||"",false)}
        </select>
      </label>`}
      <label>Tip lucrare
        <select data-work-quick-filter="workType">
          <option value="">Toate tipurile</option>
          ${optionHtml(workTypeValues,workQuickFilters.workType||"",false)}
        </select>
      </label>
    </div>
  </div>`;
}

function wireWorkQuickFilters(){
  document.querySelectorAll("[data-work-quick-filter]").forEach(el=>{
    el.addEventListener("change",e=>{
      const key=e.target.dataset.workQuickFilter;
      workQuickFilters[key]=e.target.value||"";
      renderWorkOrders();
    });
  });

  $("clearWorkQuickFilters")?.addEventListener("click",()=>{
    workQuickFilters={status:"",partner:"",workType:""};
    renderWorkOrders();
  });
}

function workTableFilterControl(column){
  if(column.type==="none")return "";
  const rangeNote=rangeFilterCell(column.key);
  if(rangeNote)return rangeNote;

  if(["statusModel","statusModeling","statusCerFin"].includes(column.key)){
    return `<select class="filter-input work-stage-filter-select" data-work-filter="${column.key}">
      <option value="">Toate</option>
      ${optionHtml(stageStatuses,workFilters[column.key]||"",false)}
    </select>`;
  }

  return `<input class="filter-input" data-work-filter="${column.key}" value="${escapeHtml(workFilters[column.key]??"")}" placeholder="filter...">`;
}

function wireWorkTableFilters(){
  document.querySelectorAll("[data-work-filter]").forEach(el=>{
    const eventName=el.tagName==="SELECT"?"change":"input";
    el.addEventListener(eventName,e=>{
      const key=e.target.dataset.workFilter;
      workFilters[key]=e.target.value;
      renderWorkOrders();

      // Restore focus only for text/number inputs. Selects should simply
      // keep the chosen option after the re-render.
      const next=document.querySelector(`[data-work-filter="${key}"]`);
      if(next&&next.tagName==="INPUT"){
        next.focus();
        try{next.selectionStart=next.selectionEnd=next.value.length;}catch(_err){}
      }
    });
  });
}



function doctorCanModifyOrder(order){
  return Boolean(order) && !Boolean(order.locked) && String(order.status||"Not Started")==="Not Started";
}

function currentModalOrder(){
  const id=Number(orderId?.value||0);
  return id>0?orders.find(o=>Number(o.id)===id)||null:null;
}

function doctorModalReadOnly(){
  return isDoctor() && Boolean(orderId?.value) && !doctorCanModifyOrder(currentModalOrder());
}

function orderLockBadge(order){
  return order?.locked?'<span class="order-lock-badge" title="Lucrare blocată">🔒 Blocat</span>':"";
}

function doctorActionButtonsHtml(orderId,compact=false){
  const id=Number(orderId);
  const order=orders.find(o=>Number(o.id)===id);
  const editable=doctorCanModifyOrder(order);
  const cls=compact?" doctor-action-stack-mobile":"";

  return `<div class="doctor-action-stack${cls}">
    <button class="doctor-action-btn doctor-action-edit" type="button" onclick="editOrder(${id})" aria-label="${editable?"Editează":"Vezi"} lucrarea">
      <span class="doctor-action-icon" aria-hidden="true">${editable?"✎":"◉"}</span>
      <span class="doctor-action-label">${editable?"Editează":"Vezi"}</span>
      <span class="doctor-action-chevron" aria-hidden="true">›</span>
    </button>

    <button class="doctor-action-btn doctor-action-export" type="button" onclick="exportProductionCaseSheet(${id})" aria-label="Exportă fișa de lucru">
      <span class="doctor-action-icon" aria-hidden="true">⇩</span>
      <span class="doctor-action-label">Export fișă</span>
      <span class="doctor-action-chevron" aria-hidden="true">›</span>
    </button>

    ${editable?`<button class="doctor-action-btn doctor-action-delete" type="button" onclick="deleteOrder(${id})" aria-label="Șterge lucrarea">
      <span class="doctor-action-icon" aria-hidden="true">⌫</span>
      <span class="doctor-action-label">Șterge</span>
      <span class="doctor-action-chevron" aria-hidden="true">›</span>
    </button>`:""}

    ${!editable?`<div class="doctor-readonly-reason">${order?.locked?"🔒 Lucrare blocată":"Statusul lucrării nu mai permite modificări"}</div>`:""}
  </div>`;
}

function renderMobileWorkOrders(baseOrders){
  const q=String(workFilters.mobileSearch??"");
  const nq=normalize(q);
  const rows=nq?baseOrders.filter(o=>mobileOrderSearchText(o).includes(nq)):baseOrders;

  const dateBar=dateRangeFilterBar("workorders",[
    {field:"deadline",label:"Termen"},
    {field:"receptionDate",label:"Data recepție"}
  ]);
  const quickBar=workOrdersQuickFilterBar();
  if(isDoctor()){
    content.innerHTML=dateBar+quickBar+`<div class="mobile-list-toolbar">
      <div>
        <strong>Lucrările mele</strong>
        <span class="table-count">${rows.length} vizibile · ${orders.length} total</span>
      </div>
      <div class="mobile-list-actions">
        <button id="mobileWorkOrdersPdfBtn" class="primary-btn" type="button">Exportă PDF</button>
        <div class="mobile-search-wrap">
          <input id="mobileWorkSearch" class="filter-input mobile-search-input" value="${escapeHtml(q)}" placeholder="Caută pacient, status, tip lucrare...">
          ${q?'<button id="clearMobileSearch" class="mobile-clear-search" type="button">×</button>':""}
        </div>
      </div>
    </div>
    <div class="doctor-partner-context mobile-doctor-context">Vizualizare: <strong>lucrările asignate medicului sau clinicii</strong></div>
    <div class="mobile-card-list">
      ${rows.length?rows.map(o=>`<article class="mobile-order-card doctor-mobile-order-card">
        <div class="mobile-card-head">
          <div><strong>${escapeHtml(o.patient)||"—"}</strong><div class="mobile-muted">${escapeHtml(o.workType)||"—"} · ${o.elements} elem.</div></div>
          <span class="mobile-status-badge">${escapeHtml(uiText(o.status||"—"))}</span>
        </div>
        <div class="doctor-mobile-grid">
          <div><span>Termen</span><strong>${fmtDate(o.deadline)}</strong></div>
          <div><span>Total plată</span><strong>${money(o.finalPrice)}</strong></div>
        </div>
        ${o.clinicNote?`<div class="doctor-mobile-note"><span>Notă clinică</span>${escapeHtml(o.clinicNote)}</div>`:""}
        ${doctorActionButtonsHtml(o.id,true)}
      </article>`).join(""):'<div class="empty-state mobile-empty">Nu există lucrări pentru filtrele selectate.</div>'}
    </div>`;

    const input=$("mobileWorkSearch");
    input?.addEventListener("input",e=>{
      workFilters.mobileSearch=e.target.value;
      renderWorkOrders();
      const next=$("mobileWorkSearch");
      if(next){next.focus();next.selectionStart=next.selectionEnd=next.value.length;}
    });
    $("clearMobileSearch")?.addEventListener("click",()=>{delete workFilters.mobileSearch;renderWorkOrders();});
    $("mobileWorkOrdersPdfBtn")?.addEventListener("click",()=>exportWorkOrdersPdf(rows));
    wireDateRangeFilters("workorders",renderWorkOrders);
    wireWorkQuickFilters();
    return;
  }

  content.innerHTML=dateBar+quickBar+`<div class="mobile-list-toolbar">
      <div>
        <strong>${isTechnician()?"Lucrările mele":"Lucrări"}</strong>
        <span class="table-count">${rows.length} visible · ${orders.length} total</span>
      </div>
      <div class="mobile-list-actions">
        ${!isTechnician()&&can("Can_View_Client_Pricing")?'<button id="mobileWorkOrdersPdfBtn" class="primary-btn" type="button">Exportă PDF</button>':""}
        <div class="mobile-search-wrap">
          <input id="mobileWorkSearch" class="filter-input mobile-search-input" value="${escapeHtml(q)}" placeholder="Caută ID, pacient, partener, status...">
          ${q?'<button id="clearMobileSearch" class="mobile-clear-search" type="button">×</button>':""}
        </div>
      </div>
    </div>
    <div class="mobile-card-list">
      ${rows.length?rows.map(mobileWorkOrderCard).join(""):'<div class="empty-state mobile-empty">No matching work orders.</div>'}
    </div>`;

  const input=$("mobileWorkSearch");
  input?.addEventListener("input",e=>{
    workFilters.mobileSearch=e.target.value;
    renderWorkOrders();
    const next=$("mobileWorkSearch");
    if(next){
      next.focus();
      next.selectionStart=next.selectionEnd=next.value.length;
    }
  });
  $("clearMobileSearch")?.addEventListener("click",()=>{
    delete workFilters.mobileSearch;
    renderWorkOrders();
  });
  $("mobileWorkOrdersPdfBtn")?.addEventListener("click",()=>exportWorkOrdersPdf(rows));
  wireDateRangeFilters("workorders",renderWorkOrders);
  wireWorkQuickFilters();
}

function renderWorkOrders(){
  pageTitle.textContent="Lucrări";
  pageSubtitle.textContent=isTechnician()
    ? `Assigned work orders · ${includeOlderOrders?"full history":"last 45 days by Deadline"}`
    : `Work order view · ${includeOlderOrders?"full history":"last 45 days by Deadline"}`;
  const datedOrders=applyViewDateRanges(displayedOrders(),"workorders");
  const baseOrders=applyWorkQuickFilters(datedOrders);
  const dateBar=dateRangeFilterBar("workorders",[
    {field:"deadline",label:"Termen"},
    {field:"receptionDate",label:"Data recepție"}
  ]);
  const quickBar=workOrdersQuickFilterBar();
  updateOldToggle();
  let currentRowsForPdf=[];

  if(isMobileLayout()){
    renderMobileWorkOrders(baseOrders);
    return;
  }


  if(isDoctor()){
    const cols=[
      {key:"actions",label:"Acțiuni",type:"none",r:o=>doctorActionButtonsHtml(o.id,false)},
      {key:"deadline",label:"Termen",type:"text",sortType:"date",r:o=>fmtDate(o.deadline)},
      {key:"status",label:"Status",type:"text",r:o=>`<span class="doctor-status-readonly">${escapeHtml(uiText(o.status))}</span>`},
      {key:"patient",label:"Nume pacient",type:"text",r:o=>escapeHtml(o.patient)},
      {key:"workType",label:"Tip lucrare",type:"text",r:o=>escapeHtml(o.workType)},
      {key:"elements",label:"Nr. elemente",type:"number",r:o=>o.elements},
      {key:"clinicNote",label:"Notă clinică",type:"text",r:o=>`<span class="doctor-clinic-note">${escapeHtml(o.clinicNote)||"—"}</span>`},
      {key:"finalPrice",label:"Total plată",type:"number",r:o=>`<strong>${money(o.finalPrice)}</strong>`}
    ];

    let rows=baseOrders.filter(o=>cols.every(c=>{
      if(c.type==="none"||c.key==="deadline")return true;
      return filterMatch(o[c.key],workFilters[c.key],c.type);
    }));
    rows=sortedByColumns(rows,cols,workSort);
    currentRowsForPdf=rows;

    content.innerHTML=dateBar+quickBar+`<div class="card panel doctor-workorders-panel">
      <div class="table-tools">
        <div><strong>Lucrările mele</strong> <span class="table-count">${rows.length} vizibile · ${orders.length} total</span></div>
        <div class="table-tool-actions">
          <button id="workOrdersPdfBtn" class="primary-btn" type="button">Exportă PDF</button>
          <button id="clearWorkFilters" class="secondary-btn">Clear filters</button>
        </div>
      </div>
      <div class="doctor-partner-context">Sunt afișate doar lucrările asignate <strong>medicului sau clinicii sale</strong>. Contractul și regulile de preț sunt aplicate automat.</div>
      <div class="table-wrap"><table>
        <thead>
          <tr>${cols.map(c=>sortableHeader(c,"work",workSort)).join("")}</tr>
          <tr class="filter-row">${cols.map(c=>`<th>${workTableFilterControl(c)}</th>`).join("")}</tr>
        </thead>
        <tbody>${rows.length?rows.map(o=>`<tr>${cols.map(c=>`<td>${c.r(o)}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${cols.length}">Nu există lucrări pentru filtrele selectate.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  }else if(isTechnician()){
    const cols=[
      {key:"actions",label:"Fișă",type:"none",r:o=>`<button class="edit-btn technician-case-view-btn" type="button" onclick="editOrder(${o.id})">🦷 Vezi</button>`},
      {key:"id",label:"ID",type:"number",r:o=>`#${o.id}`},
      {key:"deadline",label:"Termen",type:"text",sortType:"date",r:o=>fmtDate(o.deadline)},
      {key:"receptionDate",label:"Data recepție",type:"text",sortType:"date",r:o=>fmtDate(o.receptionDate)},
      {key:"status",label:"Status general",type:"text",r:o=>escapeHtml(uiText(o.status))},
      {key:"patient",label:"Nume Pacient",type:"text",r:o=>escapeHtml(o.patient)},
      {key:"partner",label:"Nume Partener",type:"text",r:o=>escapeHtml(o.partner)},
      {key:"workType",label:"Tip Lucrare",type:"text",r:o=>escapeHtml(o.workType)},
      {key:"elements",label:"Nr Elemente",type:"number",r:o=>o.elements},
      {key:"myStages",label:"Etape și tehnicieni asignați",type:"text",sortValue:o=>orderStageRows(o).map(x=>`${x.stage} ${x.tech}`).join(" "),r:o=>technicianStageHtml(o,true)}
    ];
    let rows=baseOrders.filter(o=>cols.every(c=>{
      if(c.key==="deadline"||c.key==="receptionDate")return true;
      return filterMatch(c.key==="myStages"?orderStageRows(o).map(x=>`${x.stage} ${x.tech}`).join(" "):o[c.key],workFilters[c.key],c.type);
    }));
    rows=sortedByColumns(rows,cols,workSort);
    content.innerHTML=dateBar+quickBar+`<div class="card panel">
      <div class="table-tools"><div><strong>My Work Orders</strong> <span class="table-count">${rows.length} visible · ${orders.length} total</span></div><button id="clearWorkFilters" class="secondary-btn">Clear filters</button></div>
      <div class="table-wrap"><table><thead><tr>${cols.map(c=>sortableHeader(c,"work",workSort)).join("")}</tr>
      <tr class="filter-row">${cols.map(c=>`<th>${workTableFilterControl(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(o=>`<tr>${cols.map(c=>`<td>${c.r(o)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  }else{
    const cols=[
      {key:"actions",label:"Acțiuni",type:"none",r:o=>`<div class="row-actions management-order-actions"><button class="edit-btn" onclick="editOrder(${o.id})">Editează</button>${can("Can_Edit_All_Work_Orders")?`<button class="lock-btn ${o.locked?"is-locked":""}" onclick="setOrderLock(${o.id},${o.locked?"false":"true"})">${o.locked?"🔓 Deblochează":"🔒 Blochează"}</button><button class="danger-btn" onclick="deleteOrder(${o.id})">Șterge</button>`:""}</div>`},
      {key:"id",label:"ID",type:"number",r:o=>`#${o.id}`},
      {key:"deadline",label:"Termen",type:"text",sortType:"date",r:o=>fmtDate(o.deadline)},
      {key:"receptionDate",label:"Data recepție",type:"text",sortType:"date",r:o=>fmtDate(o.receptionDate)},
      {key:"status",label:"Status",type:"text",r:o=>`<select class="status-select" onchange="quickUpdate(${o.id},'Status',this.value)">${orderStatusOptions(o)}</select>`},
      {key:"patient",label:"Nume pacient",type:"text",r:o=>escapeHtml(o.patient)},
      {key:"partner",label:"Nume partener",type:"text",r:o=>escapeHtml(o.partner)},
      {key:"contract",label:"Contract",type:"text",r:o=>escapeHtml(o.contract)},
      {key:"workType",label:"Tip lucrare",type:"text",r:o=>escapeHtml(o.workType)},
      {key:"elements",label:"Nr. elemente",type:"number",r:o=>o.elements},
      {key:"listPrice",label:"Total preț listă",type:"number",r:o=>money(o.listPrice)},
      {key:"discount",label:"Discount %",type:"number",r:o=>`${o.discount}%`},
      {key:"finalPrice",label:"Total după discount",type:"number",r:o=>money(o.finalPrice)},
      {key:"modelTech",label:"Tehnician model",type:"text",r:o=>escapeHtml(o.modelTech)||"—"},
      {key:"statusModel",label:"Status model",type:"text",r:o=>escapeHtml(uiText(o.statusModel))},
      {key:"modelingTech",label:"Tehnician modelare",type:"text",r:o=>escapeHtml(o.modelingTech)||"—"},
      {key:"statusModeling",label:"Status modelare",type:"text",r:o=>escapeHtml(uiText(o.statusModeling))},
      {key:"ceramicTech",label:"Tehnician cer/fin",type:"text",r:o=>escapeHtml(o.ceramicTech)||"—"},
      {key:"statusCerFin",label:"Status cer/fin",type:"text",r:o=>escapeHtml(uiText(o.statusCerFin))}
    ];
    let rows=baseOrders.filter(o=>cols.every(c=>{
      if(c.type==="none"||c.key==="deadline"||c.key==="receptionDate")return true;
      return filterMatch(o[c.key],workFilters[c.key],c.type);
    }));
    rows=sortedByColumns(rows,cols,workSort);
    currentRowsForPdf=rows;
    content.innerHTML=dateBar+quickBar+`<div class="card panel">
      <div class="table-tools"><div><strong>Work Orders</strong> <span class="table-count">${rows.length} visible · ${orders.length} total</span></div><div class="table-tool-actions"><button id="workOrdersPdfBtn" class="primary-btn" type="button">Exportă PDF</button><button id="clearWorkFilters" class="secondary-btn">Clear filters</button></div></div>
      <div class="table-wrap"><table><thead><tr>${cols.map(c=>sortableHeader(c,"work",workSort)).join("")}</tr>
      <tr class="filter-row">${cols.map(c=>`<th>${workTableFilterControl(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(o=>`<tr>${cols.map(c=>`<td>${c.r(o)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  }

  wireWorkTableFilters();
  $("clearWorkFilters")?.addEventListener("click",()=>{
    workFilters={};
    workQuickFilters={status:"",partner:"",workType:""};
    clearViewDateRange("workorders");
    renderWorkOrders();
  });
  $("workOrdersPdfBtn")?.addEventListener("click",()=>exportWorkOrdersPdf(currentRowsForPdf));
  wireDateRangeFilters("workorders",renderWorkOrders);
  wireWorkQuickFilters();
  wireSortHeaders();
}




function exportWorkOrdersPdf(rows){
  const list=[...(rows||[])];
  const reportWindow=window.open("","_blank","width=1100,height=820");
  if(!reportWindow){
    alert("Browserul a blocat fereastra PDF. Permite pop-up-urile pentru această pagină.");
    return;
  }

  const total=list.reduce((sum,o)=>sum+num(o.finalPrice),0);
  const logoUrl=new URL("assets/flowrise-brand.jpg",window.location.href).href;
  const generated=new Date().toLocaleString("ro-RO");

  reportWindow.document.open();
  reportWindow.document.write(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Raport lucrări - Flowrise Dental Studio</title><style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#191713;background:#fff;font-size:10pt}.page{padding:10mm}.actions{display:flex;justify-content:flex-end;margin-bottom:10px}.actions button{border:0;border-radius:6px;padding:9px 13px;background:#c99a36;color:#fff;font-weight:700;cursor:pointer}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:2px solid #a5824e;padding-bottom:10px;margin-bottom:14px}.brand{display:flex;align-items:center;gap:12px}.brand img{width:82px;height:52px;object-fit:cover;border-radius:5px}h1{font-size:19pt;margin:0 0 3px}.meta{color:#74695b;font-size:8.5pt}table{width:100%;border-collapse:collapse}th{background:#f5efe2;color:#4a4033;text-align:left;padding:7px 6px;font-size:8.5pt}td{padding:7px 6px;border-bottom:1px solid #ddd8d0}td.money{text-align:right;font-weight:700}tfoot td{border-top:2px solid #a5824e;border-bottom:0;background:#f6f1e9;font-size:11pt;font-weight:800}.empty{text-align:center;color:#777;padding:25px}@page{size:A4 landscape;margin:10mm}@media print{.actions{display:none}.page{padding:0}thead{display:table-header-group}tr{break-inside:avoid}}
  </style></head><body><div class="page"><div class="actions"><button onclick="window.print()">Tipărește / Salvează PDF</button></div><div class="head"><div class="brand"><img src="${logoUrl}"><div><h1>Raport lucrări</h1><div class="meta">Flowrise Dental Studio · ${list.length} lucrări filtrate</div></div></div><div class="meta">Generat: ${escapeHtml(generated)}</div></div><table><thead><tr><th>Termen</th><th>Nume pacient</th><th>Tip lucrare</th><th>Nr. elemente</th><th style="text-align:right">Total</th></tr></thead><tbody>${list.length?list.map(o=>`<tr><td>${fmtDate(o.deadline)}</td><td>${escapeHtml(o.patient||"—")}</td><td>${escapeHtml(o.workType||"—")}</td><td>${o.elements}</td><td class="money">${money(o.finalPrice)}</td></tr>`).join(""):`<tr><td class="empty" colspan="5">Nu există lucrări pentru filtrele selectate.</td></tr>`}</tbody><tfoot><tr><td colspan="4">TOTAL</td><td class="money">${money(total)}</td></tr></tfoot></table></div></body></html>`);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(()=>reportWindow.print(),350);
}

function productionDeadlineInfo(order){
  const status=String(order?.status||"");
  if(!["Not Started","Started","Finished"].includes(status)){
    return {className:"",days:null,tomorrow:false,today:false};
  }

  const raw=toDateInputValue(order?.deadline);
  if(!raw){
    return {className:"",days:null,tomorrow:false,today:false};
  }

  const parts=raw.split("-").map(Number);
  if(parts.length!==3||parts.some(v=>!Number.isFinite(v))){
    return {className:"",days:null,tomorrow:false,today:false};
  }

  const [year,month,day]=parts;
  const now=new Date();

  // UTC date arithmetic avoids 23/25-hour DST edge cases.
  const todayUtc=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const dueUtc=Date.UTC(year,month-1,day);
  const days=Math.round((dueUtc-todayUtc)/86400000);

  if(days<7){
    return {
      className:"deadline-priority-red",
      days,
      tomorrow:days===1,
      today:days===0
    };
  }

  if(days<=14){
    return {
      className:"deadline-priority-gold",
      days,
      tomorrow:false,
      today:false
    };
  }

  return {
    className:"deadline-priority-grey",
    days,
    tomorrow:false
  };
}

// Production is prioritized by the nearest deadline. Missing deadlines are
// intentionally placed last, with the work-order ID as a stable tie-breaker.
function sortProductionByDeadline(list){
  return [...(Array.isArray(list)?list:[])].sort((a,b)=>{
    const da=toDateInputValue(a?.deadline);
    const db=toDateInputValue(b?.deadline);
    if(!da&&!db)return Number(a?.id||0)-Number(b?.id||0);
    if(!da)return 1;
    if(!db)return -1;
    return da.localeCompare(db)||Number(a?.id||0)-Number(b?.id||0);
  });
}

function productionDeadlineClass(order){
  return productionDeadlineInfo(order).className;
}

function productionTomorrowBadge(order){
  const info=productionDeadlineInfo(order);
  if(info.today){
    return `<span class="production-today-alert" title="Termen azi" aria-label="Termen azi">azi</span>`;
  }
  return info.tomorrow
    ? `<span class="production-tomorrow-alert" title="Termen mâine" aria-label="Termen mâine">mâine</span>`
    : "";
}

function closeProductionCardMenus(exceptId=null){
  document.querySelectorAll(".kanban-card-menu").forEach(menu=>{
    if(exceptId!==null && String(menu.dataset.productionMenu)===String(exceptId))return;
    menu.classList.add("hidden");
  });
}

function toggleProductionCardMenu(event,orderId){
  event?.preventDefault();
  event?.stopPropagation();

  const menu=document.querySelector(`.kanban-card-menu[data-production-menu="${Number(orderId)}"]`);
  if(!menu)return;

  const willOpen=menu.classList.contains("hidden");
  closeProductionCardMenus(willOpen?Number(orderId):null);
  menu.classList.toggle("hidden",!willOpen);
}

async function exportProductionCaseSheet(orderId){
  // Intentionally allowed in read-only Doctor mode (Locked or Status != Not Started).
  // This path only GETs patient-case data and renders/prints the sheet.
  closeProductionCardMenus();

  const id=Number(orderId);
  const order=orders.find(o=>Number(o.id)===id);
  if(!order){
    alert(`Lucrarea #${id} nu a fost găsită.`);
    return;
  }

  showLoading("Pregătesc fișa","Caut definiția dentară...");
  try{
    const saved=await fetchPatientCase(id);
    const draft=draftFromServerCase(order,saved);

    if(!draft || !orderedSelectedTeeth(draft.selected).length){
      alert(`Lucrarea #${id} nu are încă dinți configurați în fișa de caz.`);
      return;
    }

    renderPhysicalCaseSheet(order,draft);
  }catch(err){
    alert(`Nu am putut exporta fișa lucrării #${id}: ${err.message}`);
  }finally{
    hideLoading();
  }
}

async function copyProductionOrderId(orderId){
  closeProductionCardMenus();
  const value=String(Number(orderId));

  try{
    await navigator.clipboard.writeText(value);
    setConnection(true,`ID #${value} copiat`);
    return;
  }catch(_err){
    const textarea=document.createElement("textarea");
    textarea.value=value;
    textarea.setAttribute("readonly","");
    textarea.style.position="fixed";
    textarea.style.opacity="0";
    document.body.appendChild(textarea);
    textarea.select();

    try{
      document.execCommand("copy");
      setConnection(true,`ID #${value} copiat`);
    }finally{
      textarea.remove();
    }
  }
}

function editProductionOrder(orderId){
  closeProductionCardMenus();
  editOrder(Number(orderId));
}

window.toggleProductionCardMenu=toggleProductionCardMenu;
window.exportProductionCaseSheet=exportProductionCaseSheet;
window.copyProductionOrderId=copyProductionOrderId;
window.editProductionOrder=editProductionOrder;

function productionStageStatusClass(value){
  const v=String(value||"");
  if(v==="Finished")return "stage-status-finished";
  if(v==="Started")return "stage-status-started";
  return "stage-status-not-started";
}

function productionStageStatusSelect(order,label,field,value){
  const stage=orderStageRows(order).find(s=>s.field===field);
  if(stage?.notApplicable)return `<div class="production-mini-stage stage-mini-na"><span>${escapeHtml(label)}</span><strong>Nu se aplică</strong></div>`;
  return `
    <label class="production-mini-stage">
      <span>${escapeHtml(label)}</span>
      <select
        class="production-mini-status ${productionStageStatusClass(value)}"
        onchange="quickUpdate(${order.id},'${field}',this.value)"
        onmousedown="event.stopPropagation()"
        onclick="event.stopPropagation()"
        draggable="false"
        aria-label="${escapeHtml(label)}"
      >
        ${optionHtml(stageStatuses,value||"Not Started",false)}
      </select>
    </label>`;
}

function productionStageControls(order){
  // Keep the stage details visually quiet unless the overall work order
  // is actively in production.
  if(String(order.status||"")!=="Started")return "";

  return `
    <div class="production-mini-stages" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
      ${productionStageStatusSelect(order,"Model","Status_Model",order.statusModel)}
      ${productionStageStatusSelect(order,"Modelare","Status_Modelare",order.statusModeling)}
      ${productionStageStatusSelect(order,"Cer / Fin","Status_Cer_Fin",order.statusCerFin)}
    </div>`;
}

function renderProduction(){
  pageTitle.textContent="Producție";
  pageSubtitle.textContent=isTechnician()?"Etapele de producție alocate":"Flux de producție";
  const baseOrders=applyViewDateRanges(displayedOrders(),"production");
  const dateBar=dateRangeFilterBar("production",[{field:"deadline",label:"Termen"}]);
  updateOldToggle();

  if(isMobileLayout()){
    if(isDoctor()){
      const doctorStatuses=["Not Started","Started","Finished","Shipped"];
      const doctorOrders=baseOrders.filter(o=>doctorStatuses.includes(String(o.status||"")));
      content.innerHTML=dateBar+`
        <div class="doctor-production-note">View read-only · doar lucrările medicului / clinicii · statusuri operaționale</div>
        <div class="mobile-production-stack">${doctorStatuses.map(stage=>{
          const list=sortProductionByDeadline(doctorOrders.filter(o=>o.status===stage));
          return `<section class="mobile-production-section doctor-production-section">
            <div class="mobile-production-title"><span>${escapeHtml(uiText(stage))}</span><span>${list.length}</span></div>
            ${list.length?list.map(o=>`<article class="mobile-kanban-card ${productionDeadlineClass(o)}">
              <div class="mobile-card-head">
                <div><div class="mobile-id">#${o.id} ${orderLockBadge(o)}</div><strong>${escapeHtml(o.patient)||"—"}</strong></div>
                <span class="mobile-deadline">${fmtDate(o.deadline)}</span>
              </div>
              <div class="mobile-muted">${escapeHtml(o.workType)} · ${o.elements} elem.</div>
              <div class="doctor-production-status">${escapeHtml(uiText(o.status))}</div>
            </article>`).join(""):'<div class="mobile-stage-empty">Nicio lucrare</div>'}
          </section>`;
        }).join("")}</div>`;
      wireDateRangeFilters("production",renderProduction);
      return;
    }

    if(isTechnician()){
      const sortedOrders=sortProductionByDeadline(baseOrders);
      content.innerHTML=dateBar+`<div class="mobile-card-list">${sortedOrders.length?sortedOrders.map(o=>`
        <article class="mobile-order-card">
          <div class="mobile-card-head">
            <div><div class="mobile-id">#${o.id}</div><strong>${escapeHtml(o.patient)||"—"}</strong><div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div></div>
            <div class="production-deadline-stack">
              ${productionTomorrowBadge(o)}
              <span class="mobile-deadline">${fmtDate(o.deadline)}</span>
            </div>
          </div>
          <div class="mobile-card-grid">
            <div><span>Work type</span><strong>${escapeHtml(o.workType)||"—"}</strong></div>
            <div><span>Elements</span><strong>${o.elements}</strong></div>
          </div>
          <div class="mobile-stage-block">${technicianStageHtml(o,true)}</div>
        </article>`).join(""):'<div class="empty-state mobile-empty">No assigned production.</div>'}</div>`;
      wireDateRangeFilters("production",renderProduction);
      return;
    }

    content.innerHTML=dateBar+`<div class="mobile-production-stack">${visibleProductionStatuses().map(stage=>{
      const list=sortProductionByDeadline(baseOrders.filter(o=>o.status===stage));
      return `<section class="mobile-production-section">
        <div class="mobile-production-title"><span>${escapeHtml(uiText(stage))}</span><span>${list.length}</span></div>
        ${list.length?list.map(o=>`<article class="mobile-kanban-card ${productionDeadlineClass(o)}">
          <div class="mobile-card-head">
            <div><div class="mobile-id">#${o.id}</div><strong>${escapeHtml(o.patient)||"—"}</strong><div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div></div>
            <div class="production-deadline-stack">${productionTomorrowBadge(o)}<span class="mobile-deadline">${fmtDate(o.deadline)}</span></div>
          </div>
          <div class="mobile-muted">${escapeHtml(o.workType)} · ${o.elements} elem.</div>
          ${isDashboard()?"":`<select class="status-select mobile-full-select" onchange="quickUpdate(${o.id},'Status',this.value)">${orderStatusOptions(o)}</select>`}
          ${isDashboard()?"":productionStageControls(o)}
        </article>`).join(""):'<div class="mobile-stage-empty">Nicio lucrare</div>'}
      </section>`;
    }).join("")}</div>`;
    wireDateRangeFilters("production",renderProduction);
    return;
  }

  if(isDoctor()){
    const doctorStatuses=["Not Started","Started","Finished","Shipped"];
    const doctorOrders=baseOrders.filter(o=>doctorStatuses.includes(String(o.status||"")));
    content.innerHTML=dateBar+`
      <div class="doctor-production-note">View read-only · sunt afișate doar lucrările asignate medicului sau clinicii sale.</div>
      <div class="kanban-wrap doctor-production-wrap">
        <div class="kanban doctor-production-kanban">${doctorStatuses.map(stage=>{
          const list=sortProductionByDeadline(doctorOrders.filter(o=>o.status===stage));
          return `<div class="kanban-col doctor-production-col">
            <div class="kanban-title">
              <span>${escapeHtml(uiText(stage))}</span>
              <span class="kanban-count">${list.length}</span>
            </div>
            <div class="kanban-card-list">
              ${list.length?list.map(o=>`<div class="kanban-card doctor-production-card ${productionDeadlineClass(o)}">
                <div class="kanban-card-drag-head">
                  <strong>#${o.id} · ${escapeHtml(o.patient)}</strong>
                  ${orderLockBadge(o)}
                </div>
                <div class="kanban-meta">${escapeHtml(o.workType)} · ${o.elements} elem.</div>
                <div class="kanban-meta">Termen ${fmtDate(o.deadline)}</div>
                <div class="doctor-production-status">${escapeHtml(uiText(o.status))}</div>
              </div>`).join(""):'<div class="mobile-stage-empty">Nicio lucrare</div>'}
            </div>
          </div>`;
        }).join("")}</div>
      </div>`;
    wireDateRangeFilters("production",renderProduction);
    return;
  }

  if(isTechnician()){
    content.innerHTML=dateBar+`<div class="card panel"><div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Deadline</th><th>Patient</th><th>Partner</th><th>Work Type</th><th>Elements</th><th>My stages</th></tr></thead>
      <tbody>${sortProductionByDeadline(baseOrders).map(o=>`<tr><td>#${o.id}</td><td>${fmtDate(o.deadline)}</td><td>${escapeHtml(o.patient)}</td><td>${escapeHtml(o.partner)}</td><td>${escapeHtml(o.workType)}</td><td>${o.elements}</td><td>${technicianStageHtml(o,true)}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
    wireDateRangeFilters("production",renderProduction);
    return;
  }
  content.innerHTML=dateBar+`
    <div class="production-drag-hint">
      <span class="production-drag-icon">↔</span>
      Trage o lucrare cu mouse-ul în coloana statusului dorit. Dropdown-ul de status rămâne disponibil.
    </div>
    <div class="kanban-wrap">
      <div class="kanban">${visibleProductionStatuses().map(stage=>{
        const list=sortProductionByDeadline(baseOrders.filter(o=>o.status===stage));
        return `<div class="kanban-col" data-kanban-status="${escapeHtml(stage)}">
          <div class="kanban-title">
            <span>${escapeHtml(uiText(stage))}</span>
            <span class="kanban-count">${list.length}</span>
          </div>
          <div class="kanban-card-list">
            ${list.map(o=>`
              <div
                class="kanban-card kanban-draggable-card ${productionDeadlineClass(o)}"
                draggable="true"
                data-order-id="${o.id}"
                data-order-status="${escapeHtml(o.status)}"
                title="Trage lucrarea pentru a-i schimba statusul"
              >
                <div class="kanban-card-drag-head">
                  <strong>#${o.id} · ${escapeHtml(o.patient)} ${orderLockBadge(o)}</strong>
                  <div class="kanban-card-menu-wrap">
                    ${productionTomorrowBadge(o)}
                    <button
                      class="kanban-grip kanban-menu-btn"
                      type="button"
                      draggable="false"
                      aria-label="Acțiuni lucrare #${o.id}"
                      title="Acțiuni"
                      onclick="toggleProductionCardMenu(event,${o.id})"
                    >⋮⋮</button>
                    <div class="kanban-card-menu hidden" data-production-menu="${o.id}" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
                      <button type="button" onclick="editProductionOrder(${o.id})">
                        <span>✎</span><span>Editare lucrare</span>
                      </button>
                      <button type="button" onclick="exportProductionCaseSheet(${o.id})">
                        <span>⇩</span><span>Export fișă</span>
                      </button>
                      <button type="button" onclick="copyProductionOrderId(${o.id})">
                        <span>#</span><span>Copiază ID</span>
                      </button>
                      <button type="button" onclick="setOrderLock(${o.id},${o.locked?"false":"true"})">
                        <span>${o.locked?"🔓":"🔒"}</span><span>${o.locked?"Deblochează":"Blochează"} lucrarea</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="kanban-meta">${isDashboard()?`${escapeHtml(o.patient)} · ${escapeHtml(o.workType)}`:`${escapeHtml(o.partner)} · ${escapeHtml(o.contract)} · ${escapeHtml(o.workType)}`}</div>
                <div class="kanban-meta">${o.elements} elem. · Termen ${fmtDate(o.deadline)}</div>
                ${isDashboard()?"":`<select
                  class="status-select kanban-status-select"
                  draggable="false"
                  style="margin-top:9px"
                  onchange="quickUpdate(${o.id},'Status',this.value)"
                  onmousedown="event.stopPropagation()"
                  onclick="event.stopPropagation()"
                >
                  ${orderStatusOptions(o)}
                </select>`}
                ${isDashboard()?"":productionStageControls(o)}
              </div>`).join("")}
          </div>
          <div class="kanban-drop-zone">Mută aici</div>
        </div>`;
      }).join("")}</div>
    </div>`;

  wireProductionDragDrop();
  wireDateRangeFilters("production",renderProduction);

  // Only one card menu should stay open at a time.
  if(!document.body.dataset.productionMenuCloseWired){
    document.addEventListener("click",()=>closeProductionCardMenus());
    document.addEventListener("keydown",e=>{
      if(e.key==="Escape")closeProductionCardMenus();
    });
    document.body.dataset.productionMenuCloseWired="1";
  }
}



let productionDraggedOrderId=null;
let productionDraggedFromStatus="";

function clearProductionDragState(){
  productionDraggedOrderId=null;
  productionDraggedFromStatus="";
  document.body.classList.remove("kanban-drag-active");
  document.querySelectorAll(".kanban-col.drag-over").forEach(el=>el.classList.remove("drag-over"));
  document.querySelectorAll(".kanban-card.dragging").forEach(el=>el.classList.remove("dragging"));
}

async function updateProductionStatusByDrop(orderId,newStatus,card,targetColumn){
  const order=orders.find(o=>Number(o.id)===Number(orderId));
  if(!order)return;

  const previousStatus=String(order.status||"");
  if(previousStatus===newStatus){
    clearProductionDragState();
    return;
  }

  // Optimistic visual move: the card moves immediately so the interaction feels direct.
  const targetList=targetColumn?.querySelector(".kanban-card-list");
  if(targetList&&card){
    targetList.appendChild(card);
    card.dataset.orderStatus=newStatus;
    const select=card.querySelector(".kanban-status-select");
    if(select)select.value=newStatus;
    card.classList.remove("dragging");
    card.classList.add("drag-saving");
  }

  clearProductionDragState();

  try{
    const response=await fetchJson(
      API.updateOrder,
      authPayload({id:Number(orderId),fields:{Status:newStatus}})
    );

    if(response?.ok===false){
      throw new Error(response?.reply||"Backend-ul nu a confirmat actualizarea.");
    }

    // Reload because backend rules may update additional stage fields
    // (for example when global Status becomes Finished).
    await loadAll(false);
    setConnection(true,`Lucrarea #${orderId}: ${uiText(newStatus)}`);
  }catch(err){
    // Local order data has not been changed, therefore re-render restores
    // the card to the original column if the backend update failed.
    if(currentView==="production")renderProduction();
    alert(`Nu am putut actualiza statusul lucrării #${orderId}: ${err.message}`);
  }
}

function wireProductionDragDrop(){
  if(isMobileLayout()||isTechnician()||isDoctor())return;

  const cards=[...document.querySelectorAll(".kanban-draggable-card[data-order-id]")];
  const columns=[...document.querySelectorAll(".kanban-col[data-kanban-status]")];

  cards.forEach(card=>{
    card.addEventListener("dragstart",e=>{
      if(e.target.closest("select,button,input,textarea,label")){
        e.preventDefault();
        return;
      }

      productionDraggedOrderId=Number(card.dataset.orderId);
      productionDraggedFromStatus=String(card.dataset.orderStatus||"");

      card.classList.add("dragging");
      document.body.classList.add("kanban-drag-active");

      if(e.dataTransfer){
        e.dataTransfer.effectAllowed="move";
        e.dataTransfer.setData("text/plain",String(productionDraggedOrderId));
      }
    });

    card.addEventListener("dragend",()=>{
      clearProductionDragState();
    });
  });

  columns.forEach(column=>{
    column.addEventListener("dragenter",e=>{
      if(!productionDraggedOrderId)return;
      e.preventDefault();
      document.querySelectorAll(".kanban-col.drag-over").forEach(el=>{
        if(el!==column)el.classList.remove("drag-over");
      });
      column.classList.add("drag-over");
    });

    column.addEventListener("dragover",e=>{
      if(!productionDraggedOrderId)return;
      e.preventDefault();
      if(e.dataTransfer)e.dataTransfer.dropEffect="move";
      column.classList.add("drag-over");
    });

    column.addEventListener("dragleave",e=>{
      if(!column.contains(e.relatedTarget)){
        column.classList.remove("drag-over");
      }
    });

    column.addEventListener("drop",e=>{
      e.preventDefault();

      const orderId=productionDraggedOrderId || Number(e.dataTransfer?.getData("text/plain"));
      const newStatus=String(column.dataset.kanbanStatus||"");
      const card=document.querySelector(`.kanban-draggable-card[data-order-id="${orderId}"]`);

      if(!orderId||!newStatus){
        clearProductionDragState();
        return;
      }

      updateProductionStatusByDrop(orderId,newStatus,card,column);
    });
  });
}

function reportSelect(values,current="",placeholder="All"){
  const unique=[...new Set(values.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="").map(String))]
    .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  return `<option value="">${escapeHtml(placeholder)}</option>${unique.map(v=>`<option value="${escapeHtml(v)}" ${String(v)===String(current)?"selected":""}>${escapeHtml(uiText(v))}</option>`).join("")}`;
}

function filterByReportControls(rows,filters,{technician=false}={}){
  const f=filters||{};
  return rows.filter(o=>{
    if(f.status && o.status!==f.status)return false;
    if(f.partner && !normalize(o.partner).includes(normalize(f.partner)))return false;
    if(f.patient && !normalize(o.patient).includes(normalize(f.patient)))return false;
    if(f.workType && o.workType!==f.workType)return false;

    if(technician && f.technician){
      const t=normalize(f.technician);
      const assigned=[
        normalize(o.modelTech),
        normalize(o.modelingTech),
        normalize(o.ceramicTech)
      ].includes(t);

      // Technician-role data may intentionally hide other technician fields,
      // so ownCost/myStages is the authoritative fallback for the logged-in technician.
      if(isTechnician()){
        const own=normalize(auth?.user?.Technician_Name);
        if(t!==own)return false;
        if(!assigned && !(o.myStages?.length))return false;
      }else if(!assigned){
        return false;
      }
    }
    return true;
  });
}

function selectedTechnicianCost(o,technician){
  if(!technician)return 0;
  const t=normalize(technician);

  if(isTechnician() && t===normalize(auth?.user?.Technician_Name)){
    return num(o.ownCost);
  }

  let total=0;
  if(normalize(o.modelTech)===t)total+=num(o.costModel);
  if(normalize(o.modelingTech)===t)total+=num(o.costModeling);
  if(normalize(o.ceramicTech)===t)total+=num(o.costCerFin);
  return total;
}

function technicianSalaryStageHtml(o){
  const stages=Array.isArray(o?.salaryStages)?o.salaryStages:[];
  if(!stages.length)return "—";
  return `<div class="salary-stage-stack">${stages.map(s=>`
    <div class="salary-stage-row">
      <div><strong>${escapeHtml(s.stageLabel)}</strong><span>${escapeHtml(uiText(s.stageStatus))}</span></div>
      <span class="salary-payment-badge ${s.paymentStatus==="Paid"?"is-paid":"is-unpaid"}">${escapeHtml(uiText(s.paymentStatus))}</span>
      <strong class="salary-stage-amount">${money(s.amount)}</strong>
    </div>`).join("")}</div>`;
}

function technicianSalarySearchText(o){
  return (o.salaryStages||[]).map(s=>`${s.stageLabel} ${s.stageStatus} ${s.paymentStatus}`).join(" ");
}

function reportFilterSummary(filters){
  const parts=[];
  if(filters.status)parts.push(`Status: ${filters.status}`);
  if(filters.partner)parts.push(`Partner: ${filters.partner}`);
  if(filters.patient)parts.push(`Patient: ${filters.patient}`);
  if(filters.workType)parts.push(`Work type: ${filters.workType}`);
  if(filters.technician)parts.push(`Technician: ${filters.technician}`);
  parts.push(hideOldOrders?"Old completed work: hidden":"Old completed work: included");
  return parts;
}

function openPdfReport({title,rows,filters=[],totals=[],columns=null,orientation="portrait"}){
  const reportWindow=window.open("","_blank","width=1100,height=800");
  if(!reportWindow){
    alert("The PDF report window was blocked by the browser. Please allow pop-ups for this site.");
    return;
  }

  const generated=new Date().toLocaleString("ro-RO");
  const logoUrl=new URL("assets/flowrise-brand.jpg",window.location.href).href;
  const headers=columns?.length
    ? columns
    : ["Pacient","Partener","Elements",title.includes("Tehnician")?"Technician cost":"Total price","Status"];

  const filterHtml=(filters.length?filters:["No additional filters"])
    .map(x=>`<span class="filter-chip">${escapeHtml(x)}</span>`).join("");

  const totalHtml=totals.map(x=>`
    <div class="report-kpi">
      <span>${escapeHtml(x.label)}</span>
      <strong>${escapeHtml(x.value)}</strong>
    </div>`).join("");

  const bodyRows=rows.length
    ? rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="empty-report">No rows match the current filters.</td></tr>`;

  reportWindow.document.open();
  reportWindow.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} - Flowrise Dental Studio</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1815;margin:0;background:#fff;font-size:10pt}
  .page{padding:8mm 2mm}
  .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #a5824e;padding-bottom:10px;margin-bottom:12px}
  .brand{display:flex;gap:12px;align-items:center}
  .brand img{width:72px;height:48px;object-fit:cover;border-radius:4px}
  h1{font-size:18pt;margin:0 0 4px}
  .meta{font-size:9pt;color:#6f6559}
  .filters{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}
  .filter-chip{border:1px solid #d6c6ae;background:#f8f4ee;padding:4px 7px;border-radius:12px;font-size:8.5pt}
  .kpis{display:grid;grid-template-columns:repeat(${Math.max(1,totals.length)},1fr);gap:7px;margin:10px 0 14px}
  .report-kpi{border:1px solid #ddd2c2;border-radius:7px;padding:8px}
  .report-kpi span{display:block;color:#7b6e5d;font-size:8pt;text-transform:uppercase;letter-spacing:.03em}
  .report-kpi strong{display:block;margin-top:3px;font-size:12pt}
  table{width:100%;border-collapse:collapse;table-layout:auto}
  th{background:#f5efe2;color:#4a4033;text-align:left;padding:7px 6px;font-size:8.5pt;white-space:nowrap}
  td{border-bottom:1px solid #e3ded6;padding:6px;vertical-align:top;overflow-wrap:anywhere}
  tr:nth-child(even) td{background:#faf8f5}
  .empty-report{text-align:center;padding:24px;color:#777}
  .actions{display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px}
  button{border:0;border-radius:6px;padding:9px 13px;background:#c99a36;color:#fff;font-weight:700;cursor:pointer}
  .hint{font-size:8.5pt;color:#776b5d;margin-top:10px}
  @page{size:A4 ${orientation==="landscape"?"landscape":"portrait"};margin:10mm}
  @media print{
    .actions,.hint{display:none!important}
    .page{padding:0}
    .head{break-inside:avoid}
    thead{display:table-header-group}
    tr{break-inside:avoid}
  }
</style>
</head>
<body>
<div class="page">
  <div class="actions"><button onclick="window.print()">Tipărește / Salvează PDF</button></div>
  <div class="head">
    <div class="brand">
      <img src="${logoUrl}" alt="Flowrise Dental Studio">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Flowrise Dental Studio</div>
      </div>
    </div>
    <div class="meta">Generat: ${escapeHtml(generated)}</div>
  </div>
  <div class="filters">${filterHtml}</div>
  <div class="kpis">${totalHtml}</div>
  <table>
    <thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="hint">Choose “Save as PDF” in the browser print dialog.</div>
</div>
</body>
</html>`);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(()=>reportWindow.print(),350);
}

function wirePartnerReportFilters(){
  document.querySelectorAll("[data-partner-report-filter]").forEach(el=>el.addEventListener("input",e=>{
    partnerReportFilters[e.target.dataset.partnerReportFilter]=e.target.value;
    renderPartners();
    const key=e.target.dataset.partnerReportFilter;
    const next=document.querySelector(`[data-partner-report-filter="${key}"]`);
    if(next && next.tagName==="INPUT"){
      next.focus();
      next.selectionStart=next.selectionEnd=next.value.length;
    }
  }));

  $("clearPartnerReportFilters")?.addEventListener("click",()=>{
    partnerReportFilters={status:"",partner:"",patient:"",workType:""};
    clearViewDateRange("partners");
    renderPartners();
  });

  $("partnerPdfBtn")?.addEventListener("click",()=>{
    const rows=filterByReportControls(applyViewDateRanges(displayedOrders(),"partners"),partnerReportFilters);
    openPdfReport({
      title:"Partner Report",
      filters:reportFilterSummary(partnerReportFilters),
      totals:[
        {label:"Work orders",value:String(rows.length)},
        {label:"Elements",value:String(rows.reduce((s,o)=>s+num(o.elements),0))},
        {label:"Total price",value:money(rows.reduce((s,o)=>s+num(o.finalPrice),0))}
      ],
      rows:rows.map(o=>[
        o.patient||"—",
        o.partner||"—",
        String(o.elements),
        money(o.finalPrice),
        o.status||"—"
      ])
    });
  });
}

function wireTechnicianReportFilters(){
  document.querySelectorAll("[data-technician-report-filter]").forEach(el=>el.addEventListener("input",e=>{
    technicianReportFilters[e.target.dataset.technicianReportFilter]=e.target.value;
    renderTechnicians();
    const key=e.target.dataset.technicianReportFilter;
    const next=document.querySelector(`[data-technician-report-filter="${key}"]`);
    if(next && next.tagName==="INPUT"){
      next.focus();
      next.selectionStart=next.selectionEnd=next.value.length;
    }
  }));

  $("clearTechnicianReportFilters")?.addEventListener("click",()=>{
    technicianReportFilters={
      status:"",
      technician:isTechnician()?(auth?.user?.Technician_Name||""):"",
      partner:"",
      patient:"",
      workType:""
    };
    clearViewDateRange("technicians");
    renderTechnicians();
  });

  $("technicianPdfBtn")?.addEventListener("click",()=>{
    const selected=technicianReportFilters.technician || (isTechnician()?auth?.user?.Technician_Name:"");
    if(!selected){
      alert("Select a technician first. The PDF report shows the cost for the selected technician.");
      return;
    }

    const effective={...technicianReportFilters,technician:selected};
    const rows=filterByReportControls(applyViewDateRanges(displayedOrders(),"technicians"),effective,{technician:true});

    if(isTechnician()){
      const salaryLines=rows.flatMap(o=>(o.salaryStages||[]).map(stage=>[
        `#${o.id}`,
        o.patient||"—",
        stage.stageLabel||"—",
        uiText(stage.stageStatus),
        uiText(stage.paymentStatus),
        money(stage.amount)
      ]));
      openPdfReport({
        title:`Salariu - ${selected}`,
        filters:reportFilterSummary(effective),
        totals:[
          {label:"Lucrări",value:String(rows.length)},
          {label:"Etape",value:String(salaryLines.length)},
          {label:"De încasat",value:money(rows.reduce((sum,o)=>sum+selectedTechnicianCost(o,selected),0))}
        ],
        columns:["Lucrare","Pacient","Etapa mea","Status etapă","Status plată","De încasat"],
        rows:salaryLines,
        orientation:"landscape"
      });
      return;
    }

    openPdfReport({
      title:`Technician Report - ${selected}`,
      filters:reportFilterSummary(effective),
      totals:[
        {label:"Work orders",value:String(rows.length)},
        {label:"Elements",value:String(rows.reduce((s,o)=>s+num(o.elements),0))},
        {label:"Technician cost",value:money(rows.reduce((s,o)=>s+selectedTechnicianCost(o,selected),0))}
      ],
      rows:rows.map(o=>[
        o.patient||"—",
        o.partner||"—",
        String(o.elements),
        money(selectedTechnicianCost(o,selected)),
        o.status||"—"
      ])
    });
  });
}



function renderPartners(){
  if(isTechnician()){content.innerHTML="";return;}
  pageTitle.textContent="Parteneri";
  pageSubtitle.textContent="Filter operational data and export a detailed PDF report";

  const visible=applyViewDateRanges(displayedOrders(),"partners");
  const dateBar=dateRangeFilterBar("partners",[{field:"deadline",label:"Termen"}]);
  updateOldToggle();

  const rows=filterByReportControls(visible,partnerReportFilters);
  const partnersForFilter=[...new Set(visible.map(o=>o.partner).filter(Boolean))];
  const workTypesForFilter=[...new Set(visible.map(o=>o.workType).filter(Boolean))];

  const filterBar=`<div class="report-filter-panel">
    <div class="report-filter-head">
      <div>
        <strong>Partner report filters</strong>
        <span>${rows.length} matching work orders</span>
      </div>
      <button id="partnerPdfBtn" class="primary-btn report-pdf-btn" type="button">PDF report</button>
    </div>
    <div class="report-filter-grid">
      <label>Status
        <select data-partner-report-filter="status">${reportSelect(statuses,partnerReportFilters.status,"Toate statusurile")}</select>
      </label>
      <label>Partner
        <select data-partner-report-filter="partner">${reportSelect(partnersForFilter,partnerReportFilters.partner,"Toți partenerii")}</select>
      </label>
      <label>Patient
        <input data-partner-report-filter="patient" value="${escapeHtml(partnerReportFilters.patient)}" placeholder="Caută pacient...">
      </label>
      <label>Work type
        <select data-partner-report-filter="workType">${reportSelect(workTypesForFilter,partnerReportFilters.workType,"Toate tipurile de lucrare")}</select>
      </label>
    </div>
    <div class="report-filter-foot">
      <span>PDF columns: Patient · Partner · Elements · Total price · Status</span>
      <button id="clearPartnerReportFilters" class="secondary-btn" type="button">Clear filters</button>
    </div>
  </div>`;

  const map={};
  rows.forEach(o=>{
    const key=o.partner||"—";
    map[key]||={partner:key,count:0,elements:0,list:0,final:0};
    const x=map[key];
    x.count++;
    x.elements+=num(o.elements);
    x.list+=num(o.listPrice);
    x.final+=num(o.finalPrice);
  });
  const partnerCols=[
    {key:"partner",label:"Partener",type:"text"},
    {key:"count",label:"Lucrări",type:"number"},
    {key:"elements",label:"Elements",type:"number"},
    {key:"list",label:"List Value",type:"number"},
    {key:"final",label:"Final Value",type:"number"}
  ];
  const summary=sortedByColumns(Object.values(map),partnerCols,partnerSort);

  const kpis=`<div class="kpi-grid">
    ${kpi("Parteneri",summary.length,"Filtered dataset")}
    ${kpi("Lucrări",rows.length,`${rows.reduce((s,o)=>s+o.elements,0)} elements`)}
    ${kpi("List value",money(summary.reduce((s,x)=>s+x.list,0)),"Before discount")}
    ${kpi("Final value",money(summary.reduce((s,x)=>s+x.final,0)),"After discount")}
  </div>`;

  if(isMobileLayout()){
    content.innerHTML=dateBar+filterBar+kpis+`<div class="mobile-card-list">${summary.length?summary.map(x=>`<article class="mobile-summary-card">
      <strong>${escapeHtml(x.partner)||"—"}</strong>
      <div class="mobile-card-grid">
        <div><span>Orders</span><strong>${x.count}</strong></div>
        <div><span>Elements</span><strong>${x.elements}</strong></div>
        <div><span>List value</span><strong>${money(x.list)}</strong></div>
        <div><span>Final value</span><strong>${money(x.final)}</strong></div>
      </div>
    </article>`).join(""):'<div class="empty-state mobile-empty">No matching partners.</div>'}</div>`;
    wirePartnerReportFilters();
    wireDateRangeFilters("partners",renderPartners);
    return;
  }

  content.innerHTML=dateBar+filterBar+kpis+`<div class="card panel">
    <div class="table-tools"><strong>Partner summary</strong><span class="table-count">${summary.length} partners</span></div>
    <div class="table-wrap"><table>
      <thead><tr>${partnerCols.map(c=>sortableHeader(c,"partner",partnerSort)).join("")}</tr></thead>
      <tbody>${summary.length?summary.map(x=>`<tr><td><strong>${escapeHtml(x.partner)}</strong></td><td>${x.count}</td><td>${x.elements}</td><td>${money(x.list)}</td><td>${money(x.final)}</td></tr>`).join(""):'<tr><td colspan="5">No matching rows.</td></tr>'}</tbody>
    </table></div>
  </div>`;

  wirePartnerReportFilters();
  wireDateRangeFilters("partners",renderPartners);
  wireSortHeaders();
}


function wirePatientReportFilters(){
  document.querySelectorAll("[data-patient-report-filter]").forEach(el=>el.addEventListener("input",e=>{
    patientReportFilters[e.target.dataset.patientReportFilter]=e.target.value;
    renderPatients();
    const key=e.target.dataset.patientReportFilter;
    const next=document.querySelector(`[data-patient-report-filter="${key}"]`);
    if(next&&next.tagName==="INPUT"){
      next.focus();
      next.selectionStart=next.selectionEnd=next.value.length;
    }
  }));

  $("clearPatientReportFilters")?.addEventListener("click",()=>{
    patientReportFilters={status:"",patient:"",partner:"",workType:""};
    clearViewDateRange("patients");
    renderPatients();
  });

  $("patientPdfBtn")?.addEventListener("click",()=>{
    const rows=filterByReportControls(applyViewDateRanges(displayedOrders(),"patients"),patientReportFilters);
    openPdfReport({
      title:"Patient Report",
      orientation:"landscape",
      columns:["Pacient","Partener","Work Type","Date","Elements","Total price","Status"],
      filters:reportFilterSummary(patientReportFilters),
      totals:[
        {label:"Work orders",value:String(rows.length)},
        {label:"Elements",value:String(rows.reduce((s,o)=>s+num(o.elements),0))},
        {label:"Total price",value:money(rows.reduce((s,o)=>s+num(o.finalPrice),0))}
      ],
      rows:rows.map(o=>[
        o.patient||"—",
        o.partner||"—",
        o.workType||"—",
        fmtDate(o.deadline),
        String(o.elements),
        money(o.finalPrice),
        o.status||"—"
      ])
    });
  });
}

function renderPatients(){
  if(!can("Can_View_Client_Pricing")){
    content.innerHTML="";
    return;
  }

  pageTitle.textContent="Pacienți";
  pageSubtitle.textContent="Patient work-order details, filters and PDF export";
  const visible=applyViewDateRanges(displayedOrders(),"patients");
  const dateBar=dateRangeFilterBar("patients",[{field:"deadline",label:"Termen"}]);
  updateOldToggle();

  let rows=filterByReportControls(visible,patientReportFilters);
  const patientCols=[
    {key:"case",label:"Caz",type:"none",sortable:false},
    {key:"patient",label:"Pacient",type:"text"},
    {key:"partner",label:"Partener",type:"text"},
    {key:"workType",label:"Tip lucrare",type:"text"},
    {key:"deadline",label:"Termen",type:"text",sortType:"date"},
    {key:"elements",label:"Elemente",type:"number"},
    {key:"finalPrice",label:"Valoare totală",type:"number"},
    {key:"status",label:"Status",type:"text"}
  ];
  rows=sortedByColumns(rows,patientCols,patientSort);
  const partners=[...new Set(visible.map(o=>o.partner).filter(Boolean))];
  const workTypesForFilter=[...new Set(visible.map(o=>o.workType).filter(Boolean))];

  const filterBar=`<div class="report-filter-panel">
    <div class="report-filter-head">
      <div>
        <strong>Patient report filters</strong>
        <span>${rows.length} matching work orders</span>
      </div>
      <button id="patientPdfBtn" class="primary-btn report-pdf-btn" type="button">PDF report</button>
    </div>
    <div class="report-filter-grid">
      <label>Status
        <select data-patient-report-filter="status">${reportSelect(statuses,patientReportFilters.status,"Toate statusurile")}</select>
      </label>
      <label>Patient
        <input data-patient-report-filter="patient" value="${escapeHtml(patientReportFilters.patient)}" placeholder="Type patient name...">
      </label>
      <label>Partner
        <select data-patient-report-filter="partner">${reportSelect(partners,patientReportFilters.partner,"Toți partenerii")}</select>
      </label>
      <label>Work type
        <select data-patient-report-filter="workType">${reportSelect(workTypesForFilter,patientReportFilters.workType,"Toate tipurile de lucrare")}</select>
      </label>
    </div>
    <div class="report-filter-foot">
      <span>PDF columns: Patient · Partner · Work Type · Date · Elements · Total price · Status</span>
      <button id="clearPatientReportFilters" class="secondary-btn" type="button">Clear filters</button>
    </div>
  </div>`;

  const uniquePatients=new Set(rows.map(o=>o.patient).filter(Boolean)).size;
  const kpis=`<div class="kpi-grid">
    ${kpi("Pacienți",uniquePatients,"Filtered dataset")}
    ${kpi("Lucrări",rows.length,`${rows.reduce((s,o)=>s+num(o.elements),0)} elements`)}
    ${kpi("Parteneri",new Set(rows.map(o=>o.partner).filter(Boolean)).size,"Filtered dataset")}
    ${kpi("Total value",money(rows.reduce((s,o)=>s+num(o.finalPrice),0)),"After discount")}
  </div>`;

  if(isMobileLayout()){
    content.innerHTML=dateBar+filterBar+kpis+`<div class="mobile-card-list">${rows.length?rows.map(o=>`<article class="mobile-order-card">
      <div class="mobile-card-actions patient-case-actions patient-case-actions-left">
        <button class="primary-btn mobile-touch-btn" type="button" onclick="editOrder(${o.id})">🦷 Deschide cazul</button>
      </div>
      <div class="mobile-card-head">
        <div>
          <div class="mobile-id">#${o.id}</div>
          <strong>${escapeHtml(o.patient)||"—"}</strong>
          <div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div>
        </div>
        <span class="mobile-status-badge">${escapeHtml(o.status||"—")}</span>
      </div>
      <div class="mobile-card-grid">
        <div><span>Work Type</span><strong>${escapeHtml(o.workType)||"—"}</strong></div>
        <div><span>Date</span><strong>${fmtDate(o.deadline)}</strong></div>
        <div><span>Elements</span><strong>${o.elements}</strong></div>
        <div><span>Total price</span><strong>${money(o.finalPrice)}</strong></div>
      </div>
    </article>`).join(""):'<div class="empty-state mobile-empty">No matching patient work orders.</div>'}</div>`;
    wirePatientReportFilters();
    wireDateRangeFilters("patients",renderPatients);
    return;
  }

  content.innerHTML=dateBar+filterBar+kpis+`<div class="card panel">
    <div class="table-tools">
      <strong>Patient work orders</strong>
      <span class="table-count">${rows.length} work orders</span>
    </div>
    <div class="table-wrap patient-detail-table"><table>
      <thead><tr>
        ${patientCols.map(c=>sortableHeader(c,"patient",patientSort)).join("")}
      </tr></thead>
      <tbody>${rows.length?rows.map(o=>`<tr>
        <td><button class="primary-btn case-sheet-row-btn" type="button" onclick="editOrder(${o.id})">🦷 Deschide cazul</button></td>
        <td><strong>${escapeHtml(o.patient)||"—"}</strong></td>
        <td>${escapeHtml(o.partner)||"—"}</td>
        <td>${escapeHtml(o.workType)||"—"}</td>
        <td>${fmtDate(o.deadline)}</td>
        <td>${o.elements}</td>
        <td>${money(o.finalPrice)}</td>
        <td>${escapeHtml(uiText(o.status))||"—"}</td>
      </tr>`).join(""):'<tr><td colspan="8">Nicio lucrare potrivită.</td></tr>'}</tbody>
    </table></div>
  </div>`;

  wirePatientReportFilters();
  wireDateRangeFilters("patients",renderPatients);
  wireSortHeaders();
}


const FDI_UPPER=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
const FDI_LOWER=[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

const FDI_TO_US={
  18:1,17:2,16:3,15:4,14:5,13:6,12:7,11:8,
  21:9,22:10,23:11,24:12,25:13,26:14,27:15,28:16,
  38:17,37:18,36:19,35:20,34:21,33:22,32:23,31:24,
  41:25,42:26,43:27,44:28,45:29,46:30,47:31,48:32
};

const RESTORATION_SUGGESTIONS=[
  "Coroană","Corp de punte","Fațetă","Inlay / Onlay","Coroană pe implant","Abutment",
  "Provizoriu","Full arch unit","Structură","Altul"
];

const METHOD_SUGGESTIONS=[
  "Full contour","Layered","Cutback","Monolithic","Framework only",
  "Diagnostic / Wax-up","Altul"
];


async function fetchPatientCase(workOrderId){
  const response=await fetchJson(API.patientCase,authPayload({
    action:"get",
    work_order_id:Number(workOrderId)
  }));
  if(!response?.ok)throw new Error(response?.reply||"Could not load patient case data.");
  return response.case??null;
}

function draftFromServerCase(order,serverCase){
  const snapshot=serverCase?.case_snapshot&&typeof serverCase.case_snapshot==="object"
    ? serverCase.case_snapshot
    : {};
  const canonicalItems=Array.isArray(order?.items)?order.items:[];
  const canonicalTeeth=canonicalItems.map(item=>Number(item?.tooth_number)).filter(Number.isFinite);
  const selected=canonicalTeeth.length
    ? orderedSelectedTeeth(canonicalTeeth)
    : Array.isArray(serverCase?.selected_teeth)
      ? serverCase.selected_teeth.map(Number).filter(Number.isFinite)
      : Array.isArray(snapshot.selected_teeth)
        ? snapshot.selected_teeth.map(Number).filter(Number.isFinite)
        : [];
  const perTooth=serverCase?.tooth_details&&typeof serverCase.tooth_details==="object"
    ? {...serverCase.tooth_details}
    : {};
  canonicalItems.forEach(item=>{
    const tooth=Number(item?.tooth_number);
    if(!Number.isFinite(tooth))return;
    perTooth[tooth]={...perTooth[tooth],type:String(item?.work_type??perTooth[tooth]?.type??"").trim()};
  });

  return {
    selected,
    shade:String(serverCase?.shade??snapshot.shade??""),
    method:String(serverCase?.method??snapshot.method??""),
    notes:String(serverCase?.production_notes??snapshot.production_notes??""),
    doctorNotes:String(serverCase?.clinic_note??snapshot.clinic_note??""),
    perTooth,
    createdForUser:String(auth?.user?.User_ID||""),
    orderId:order.id
  };
}

function caseDraftPayload(draft){
  return {
    selected_teeth:orderedSelectedTeeth(draft?.selected??[]),
    tooth_details:draft?.perTooth??{},
    shade:String(draft?.shade??""),
    method:String(draft?.method??""),
    clinic_note:String(draft?.doctorNotes??""),
    production_notes:String(draft?.notes??"")
  };
}

function hasMeaningfulCaseData(draft){
  if(!draft)return false;
  return Boolean(
    (draft.selected?.length) ||
    String(draft.shade??"").trim() ||
    String(draft.notes??"").trim() ||
    String(draft.doctorNotes??"").trim() ||
    Object.keys(draft.perTooth??{}).length
  );
}

async function persistPatientCase(workOrderId,draft){
  const response=await fetchJson(API.patientCase,authPayload({
    action:"upsert",
    work_order_id:Number(workOrderId),
    data:caseDraftPayload(draft)
  }));
  if(!response?.ok)throw new Error(response?.reply||"Could not save patient case data.");
  return response;
}

function defaultCaseDraft(order){
  return {
    selected:[],
    shade:"",
    method:"",
    notes:"",
    doctorNotes:"",
    perTooth:{},
    createdForUser:String(auth?.user?.User_ID||""),
    orderId:order.id
  };
}

function ensureCaseDraft(order){
  const existing=caseSheetDrafts[order.id];
  if(existing && existing.createdForUser===String(auth?.user?.User_ID||"")){
    return existing;
  }
  const draft=defaultCaseDraft(order);
  caseSheetDrafts[order.id]=draft;
  return draft;
}

function orderedSelectedTeeth(selected){
  const set=new Set((selected||[]).map(Number));
  return [...FDI_UPPER,...FDI_LOWER].filter(t=>set.has(t));
}

const TOOTH_LAYOUT={
  // Coordinates are intentionally matched to the supplied reference odontogram
  // (reference canvas ~474 x 776). Each tooth has independent position,
  // rotation and scale instead of being generated from an ellipse.

  // MAXILLARY / UPPER
  11:{x:214,y:48,r:-2,sx:1.12,sy:1.15},
  21:{x:268,y:48,r:2,sx:1.12,sy:1.15},

  12:{x:162,y:61,r:-20,sx:.90,sy:1.06},
  22:{x:319,y:62,r:20,sx:.90,sy:1.06},

  13:{x:128,y:88,r:-36,sx:.92,sy:1.07},
  23:{x:352,y:88,r:36,sx:.92,sy:1.07},

  14:{x:103,y:125,r:-49,sx:.98,sy:1.02},
  24:{x:378,y:124,r:49,sx:.98,sy:1.02},

  15:{x:87,y:166,r:-65,sx:1.03,sy:1.03},
  25:{x:395,y:165,r:65,sx:1.03,sy:1.03},

  16:{x:76,y:219,r:-82,sx:1.18,sy:1.16},
  26:{x:407,y:220,r:82,sx:1.18,sy:1.16},

  17:{x:72,y:286,r:-88,sx:1.15,sy:1.12},
  27:{x:411,y:286,r:88,sx:1.15,sy:1.12},

  18:{x:71,y:353,r:-90,sx:1.03,sy:1.03},
  28:{x:411,y:353,r:90,sx:1.03,sy:1.03},

  // MANDIBULAR / LOWER
  48:{x:72,y:438,r:-90,sx:1.04,sy:1.08},
  38:{x:411,y:438,r:90,sx:1.04,sy:1.08},

  47:{x:78,y:503,r:-84,sx:1.10,sy:1.10},
  37:{x:407,y:503,r:84,sx:1.10,sy:1.10},

  46:{x:85,y:568,r:-78,sx:1.13,sy:1.11},
  36:{x:395,y:563,r:78,sx:1.13,sy:1.11},

  45:{x:100,y:626,r:-67,sx:1.00,sy:1.04},
  35:{x:378,y:614,r:67,sx:1.00,sy:1.04},

  44:{x:123,y:679,r:-55,sx:1.00,sy:1.04},
  34:{x:360,y:663,r:55,sx:1.03,sy:1.07},

  43:{x:155,y:715,r:-39,sx:1.03,sy:1.08},
  33:{x:338,y:704,r:39,sx:1.03,sy:1.08},

  42:{x:188,y:738,r:-22,sx:.90,sy:.95},
  32:{x:307,y:733,r:22,sx:.90,sy:.95},

  41:{x:222,y:747,r:-7,sx:.84,sy:.92},
  31:{x:264,y:744,r:7,sx:.84,sy:.92}
};

function toothPosition(tooth){
  const p=TOOTH_LAYOUT[Number(tooth)];
  if(!p)throw new Error(`Missing tooth layout for ${tooth}`);
  return {
    x:p.x,
    y:p.y,
    rotation:p.r,
    scaleX:p.sx,
    scaleY:p.sy,
    dx:p.x-241,
    dy:p.y-388
  };
}

function toothKind(tooth){
  const pos=Math.abs(Number(tooth))%10;
  if(pos===1||pos===2)return "incisor";
  if(pos===3)return "canine";
  if(pos===4||pos===5)return "premolar";
  return "molar";
}

function toothVariant(tooth){
  const n=Number(tooth);
  const pos=n%10;
  const upper=n<30;

  if(pos===1)return upper?"central-incisor":"lower-central-incisor";
  if(pos===2)return upper?"lateral-incisor":"lower-lateral-incisor";
  if(pos===3)return upper?"upper-canine":"lower-canine";
  if(pos===4)return upper?"upper-first-premolar":"lower-first-premolar";
  if(pos===5)return upper?"upper-second-premolar":"lower-second-premolar";
  if(pos===6)return upper?"upper-first-molar":"lower-first-molar";
  if(pos===7)return upper?"upper-second-molar":"lower-second-molar";
  return upper?"upper-third-molar":"lower-third-molar";
}

const TOOTH_TYPE_PALETTE=[
  "#6e2a9a",
  "#b52049",
  "#4f918a",
  "#e7a315",
  "#e6690c",
  "#4f7cc0",
  "#6f9749",
  "#c9639b",
  "#9b7355"
];

function workTypeColor(type){
  const raw=String(type??"").trim();
  if(!raw)return "#777774";
  const n=normalize(raw);

  if(n.includes("coping")||n.includes("framework")||n.includes("cadru"))return "#4d8b83";
  if(n.includes("pontic")||n.includes("corp de punte"))return "#b9224c";
  if(n.includes("adjacent"))return "#eda817";
  if(n.includes("antagon"))return "#e96709";
  if(n.includes("anatomic crown")||n==="crown"||n.includes("coroana"))return "#8324a0";
  if(n.includes("veneer")||n.includes("fateta"))return "#4b7ab8";
  if(n.includes("implant")||n.includes("abutment"))return "#4d8e5d";

  let hash=0;
  for(let i=0;i<raw.length;i++)hash=((hash<<5)-hash+raw.charCodeAt(i))|0;
  return TOOTH_TYPE_PALETTE[Math.abs(hash)%TOOTH_TYPE_PALETTE.length];
}

function lightenHex(hex,amount=28){
  const h=String(hex||"#777774").replace("#","");
  if(!/^[0-9a-f]{6}$/i.test(h))return "#b9b5ae";
  const vals=[0,2,4].map(i=>Math.min(255,parseInt(h.slice(i,i+2),16)+amount));
  return `#${vals.map(v=>v.toString(16).padStart(2,"0")).join("")}`;
}

function toothGlyphMarkup(tooth,color="#d2d2d0",selected=false,interactive=false){
  const kind=toothKind(tooth);
  const variant=toothVariant(tooth);
  const n=Number(tooth);
  const pos=n%10;
  const upper=n<30;

  // Reference-oriented occlusal morphology.
  // The goal here is not a generic icon: each FDI position gets a silhouette
  // that behaves much closer to a real odontogram — incisors taper, canines
  // have a clear cusp, premolars show two-cusp anatomy, and molars carry the
  // larger irregular lobes/fissures visible in the client's reference.
  const stroke=selected?lightenHex(color,30):"#555553";
  const line=selected?lightenHex(color,58):"#6f6f6c";

  let crown="";
  let anatomy="";

  // --------------------------- INCISORS ---------------------------
  if(pos===1 && upper){
    crown=`<path class="tooth-svg-shape" d="
      M-13.7,-18.2
      C-9.2,-21.0 -4.4,-21.6 0,-20.8
      C4.5,-21.6 9.4,-20.8 13.7,-18.0
      C15.1,-10.0 15.0,-2.4 13.5,5.5
      C12.1,12.3 8.2,17.1 2.4,18.4
      C1.0,18.8 -1.1,18.8 -2.6,18.4
      C-8.4,17.0 -12.2,12.2 -13.6,5.4
      C-15.1,-2.5 -15.2,-10.1 -13.7,-18.2 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-8.4,-12.5 C-4.8,-9.4 -2.7,-5.2 -1.7,-1.0"></path>
      <path class="tooth-anatomy" d="M8.4,-12.5 C4.8,-9.4 2.7,-5.2 1.7,-1.0"></path>
      <path class="tooth-anatomy" d="M0,-12.5 C-1.8,-6.5 -1.5,0.2 0,9.7"></path>
      <path class="tooth-highlight" d="M-9.8,-16.1 C-4.2,-19.0 2.7,-19.3 8.4,-16.7"></path>`;
  }
  else if(pos===1){
    crown=`<path class="tooth-svg-shape" d="
      M-8.5,-14.7
      C-5.3,-17.2 -1.7,-17.7 0,-17.1
      C2.0,-17.8 5.5,-17.1 8.5,-14.6
      C9.7,-8.1 9.4,-1.2 8.2,6.4
      C7.3,11.5 4.2,14.7 0,15.3
      C-4.4,14.7 -7.4,11.5 -8.3,6.2
      C-9.5,-1.0 -9.7,-8.2 -8.5,-14.7 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-4.8,-9.9 C-2.6,-6.8 -1.3,-2.3 -0.5,2.8"></path>
      <path class="tooth-anatomy" d="M4.8,-9.9 C2.6,-6.8 1.3,-2.3 0.5,2.8"></path>
      <path class="tooth-anatomy" d="M0,-10.7 C-0.8,-5.3 -0.7,1.6 0,8.9"></path>`;
  }
  else if(pos===2 && upper){
    crown=`<path class="tooth-svg-shape" d="
      M-11.2,-16.4
      C-7.7,-19.1 -3.4,-19.9 0,-19.2
      C3.5,-19.9 7.8,-19.0 11.2,-16.3
      C12.7,-9.0 12.4,-2.1 11.0,5.4
      C9.9,11.7 6.4,15.9 1.4,16.9
      C0.6,17.1 -0.7,17.1 -1.5,16.9
      C-6.7,15.8 -10.1,11.5 -11.2,5.3
      C-12.6,-2.2 -12.8,-9.1 -11.2,-16.4 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-6.8,-10.7 C-3.7,-7.6 -1.9,-3.2 -1.1,1.8"></path>
      <path class="tooth-anatomy" d="M6.7,-10.7 C3.8,-7.6 1.9,-3.2 1.0,1.8"></path>
      <path class="tooth-anatomy" d="M0,-11.8 C-1.2,-5.8 -1.0,0.8 0,8.4"></path>`;
  }
  else if(pos===2){
    crown=`<path class="tooth-svg-shape" d="
      M-9.5,-14.3
      C-6.5,-16.6 -2.9,-17.3 0,-16.8
      C3.0,-17.3 6.7,-16.5 9.5,-14.2
      C10.6,-7.6 10.3,-1.0 9.2,5.8
      C8.3,11.0 5.3,14.2 0.9,15.0
      C0.4,15.1 -0.5,15.1 -1.0,15.0
      C-5.5,14.1 -8.4,10.9 -9.3,5.7
      C-10.4,-1.1 -10.6,-7.7 -9.5,-14.3 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-5.5,-9.1 C-2.9,-6.2 -1.5,-2.4 -0.8,2.1"></path>
      <path class="tooth-anatomy" d="M5.5,-9.1 C2.9,-6.2 1.5,-2.4 0.8,2.1"></path>
      <path class="tooth-anatomy" d="M0,-9.9 C-0.9,-4.6 -0.7,1.4 0,7.9"></path>`;
  }

  // ---------------------------- CANINES ---------------------------
  else if(pos===3 && upper){
    crown=`<path class="tooth-svg-shape" d="
      M0,-20.4
      C4.6,-19.5 9.5,-16.0 12.7,-10.6
      C15.8,-5.4 15.7,1.7 13.0,7.7
      C10.8,13.0 6.1,17.0 0.7,18.5
      C-4.8,17.6 -9.6,13.6 -12.1,8.1
      C-15.0,2.1 -15.2,-4.8 -12.4,-10.2
      C-9.4,-15.9 -4.6,-19.3 0,-20.4 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M0,-14.8 C-2.2,-8.0 -2.4,-1.7 0,8.9"></path>
      <path class="tooth-anatomy" d="M-8.5,-6.1 C-4.6,-3.1 -2.0,-0.3 0,3.2"></path>
      <path class="tooth-anatomy" d="M8.3,-6.0 C4.7,-3.0 2.1,-0.2 0,3.2"></path>
      <path class="tooth-highlight" d="M-5.6,-14.6 C-2.8,-17.0 -0.6,-17.8 1.0,-17.8"></path>`;
  }
  else if(pos===3){
    crown=`<path class="tooth-svg-shape" d="
      M0,-18.0
      C4.2,-17.2 8.5,-14.1 11.2,-9.0
      C13.8,-4.1 13.6,2.1 11.2,7.5
      C9.1,12.1 5.3,15.1 0.6,16.2
      C-4.2,15.3 -8.1,12.1 -10.4,7.6
      C-13.0,2.4 -13.2,-3.8 -10.8,-8.8
      C-8.3,-14.0 -4.1,-17.0 0,-18.0 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M0,-12.9 C-2.0,-6.7 -2.1,-1.0 0,8.0"></path>
      <path class="tooth-anatomy" d="M-7.2,-5.0 C-3.6,-2.2 -1.5,0.4 0,3.0"></path>
      <path class="tooth-anatomy" d="M7.2,-5.0 C3.7,-2.1 1.6,0.4 0,3.0"></path>`;
  }

  // --------------------------- PREMOLARS --------------------------
  else if(pos===4 && upper){
    crown=`<path class="tooth-svg-shape" d="
      M-13.8,-15.2
      C-9.8,-18.9 -4.9,-19.2 -0.8,-17.3
      C3.1,-19.5 8.6,-18.6 13.4,-14.7
      C17.0,-11.2 18.1,-5.6 16.5,-0.3
      C18.1,5.0 16.2,10.7 12.1,14.0
      C8.0,17.4 3.2,18.2 -1.0,16.4
      C-5.2,18.2 -10.2,16.9 -13.6,13.2
      C-17.1,9.5 -18.0,4.5 -16.2,0.0
      C-18.0,-5.1 -17.0,-11.0 -13.8,-15.2 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-10.6,-5.0 C-5.9,-6.8 -2.6,-4.3 0,-0.2 C2.5,-4.5 6.2,-6.7 10.9,-4.7"></path>
      <path class="tooth-anatomy" d="M-10.0,5.8 C-5.7,4.0 -2.6,1.6 0,-0.2 C2.8,1.7 5.9,4.2 10.1,5.7"></path>
      <path class="tooth-anatomy" d="M0,-11.1 C-1.1,-6.1 -1.1,-2.2 0,-0.2 C1.0,2.0 1.1,6.2 0,11.1"></path>
      <path class="tooth-cusp" d="M-8.4,-9.3 C-4.1,-12.5 -1.2,-9.3 0,-5.7 C1.5,-9.6 4.8,-12.4 8.7,-9.0"></path>`;
  }
  else if(pos===4){
    crown=`<path class="tooth-svg-shape" d="
      M-12.9,-13.8
      C-9.1,-17.1 -4.2,-17.6 0,-15.9
      C4.4,-17.7 9.3,-16.6 12.9,-13.1
      C16.1,-9.7 16.9,-4.3 15.2,0.1
      C16.6,4.8 14.7,9.7 11.1,12.8
      C7.4,16.2 3.0,16.8 -0.6,15.0
      C-4.3,16.6 -8.7,15.5 -11.9,12.0
      C-15.3,8.5 -16.0,4.2 -14.4,0.0
      C-16.0,-4.2 -15.4,-9.6 -12.9,-13.8 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-9.1,-4.3 C-5.0,-5.9 -2.4,-3.9 0,-0.2 C2.5,-4.0 5.1,-5.8 9.1,-4.1"></path>
      <path class="tooth-anatomy" d="M-8.6,4.9 C-5.0,3.5 -2.2,1.6 0,-0.2 C2.3,1.8 5.1,3.7 8.8,5.0"></path>
      <path class="tooth-anatomy" d="M0,-9.6 C-1.0,-5.0 -1.0,-1.9 0,-0.2 C0.9,1.8 1.0,5.1 0,9.2"></path>`;
  }
  else if(pos===5 && upper){
    crown=`<path class="tooth-svg-shape" d="
      M-14.6,-14.5
      C-10.1,-18.2 -4.3,-18.2 0,-16.1
      C4.3,-18.3 10.4,-17.8 14.6,-13.9
      C18.0,-10.5 18.7,-5.1 16.8,0.1
      C18.1,5.4 15.8,10.8 11.7,14.0
      C7.5,17.4 2.8,18.0 -0.7,16.3
      C-4.3,18.2 -9.5,17.0 -13.1,13.4
      C-16.7,9.8 -17.6,5.1 -15.8,0.0
      C-17.7,-4.7 -17.0,-10.4 -14.6,-14.5 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-10.5,-4.6 C-6.4,-6.2 -2.5,-3.8 0,-0.1 C2.8,-4.0 6.6,-6.0 10.6,-4.3"></path>
      <path class="tooth-anatomy" d="M-10.0,5.4 C-6.0,3.7 -2.6,1.6 0,-0.1 C2.7,1.7 6.0,3.9 10.0,5.3"></path>
      <path class="tooth-anatomy" d="M0,-10.7 C-1.0,-5.4 -1.0,-1.9 0,-0.1 C1.0,1.9 1.0,5.6 0,10.5"></path>
      <path class="tooth-cusp" d="M-8.8,-8.6 C-4.6,-11.6 -1.7,-8.9 0,-5.3 C1.8,-9.0 4.8,-11.4 8.9,-8.4"></path>`;
  }
  else if(pos===5){
    crown=`<path class="tooth-svg-shape" d="
      M-14.0,-13.6
      C-9.6,-17.3 -4.0,-17.2 0,-15.2
      C4.2,-17.3 9.8,-16.9 14.0,-13.0
      C17.0,-9.8 17.8,-4.7 16.0,0.0
      C17.2,5.0 15.1,10.1 11.3,13.3
      C7.4,16.5 2.9,17.1 -0.6,15.4
      C-4.2,17.1 -9.2,16.0 -12.6,12.6
      C-16.0,9.1 -16.8,4.7 -15.1,0.0
      C-16.8,-4.4 -16.2,-9.6 -14.0,-13.6 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-9.8,-4.2 C-5.8,-5.7 -2.4,-3.6 0,-0.1 C2.5,-3.8 5.9,-5.6 9.9,-4.0"></path>
      <path class="tooth-anatomy" d="M-9.4,5.0 C-5.6,3.6 -2.4,1.5 0,-0.1 C2.5,1.6 5.6,3.6 9.4,4.9"></path>
      <path class="tooth-anatomy" d="M0,-9.7 C-1.0,-5.1 -1.0,-1.7 0,-0.1 C1.0,1.8 1.0,5.1 0,9.4"></path>`;
  }

  // ----------------------------- MOLARS ---------------------------
  else if(pos===6 && upper){
    crown=`<path class="tooth-svg-shape" d="
      M-16.6,-18.0
      C-11.0,-22.3 -4.7,-22.5 0.2,-19.9
      C5.8,-22.5 12.5,-21.3 17.4,-16.9
      C21.7,-13.2 22.6,-7.0 20.0,-1.1
      C22.9,4.5 21.1,11.0 16.8,15.7
      C12.3,20.2 5.9,21.3 0.5,18.8
      C-5.5,21.5 -12.1,19.9 -16.6,15.2
      C-21.0,10.8 -22.1,4.6 -19.5,-0.8
      C-22.4,-6.3 -20.9,-13.1 -16.6,-18.0 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-13.4,-10.1 C-9.3,-8.0 -6.1,-4.9 -2.5,-1.2 C-6.0,2.3 -9.7,5.6 -13.2,9.5"></path>
      <path class="tooth-anatomy" d="M13.9,-9.4 C9.9,-7.3 6.1,-4.5 2.4,-1.1 C5.9,2.5 9.6,5.3 13.5,9.0"></path>
      <path class="tooth-anatomy" d="M-2.5,-1.2 C-0.7,-4.3 -0.6,-8.6 0.3,-13.6"></path>
      <path class="tooth-anatomy" d="M2.4,-1.1 C0.7,2.3 0.7,7.2 0.3,13.8"></path>
      <path class="tooth-cusp" d="M-12.1,-5.6 C-9.6,-11.6 -4.0,-13.4 -1.0,-8.1"></path>
      <path class="tooth-cusp" d="M11.8,-5.2 C9.4,-11.0 4.5,-12.9 1.3,-7.8"></path>
      <path class="tooth-cusp" d="M-11.7,6.2 C-8.7,11.7 -4.0,12.8 -1.1,8.1"></path>
      <path class="tooth-cusp" d="M11.4,5.9 C8.6,11.3 4.2,12.6 1.4,8.0"></path>`;
  }
  else if(pos===6){
    crown=`<path class="tooth-svg-shape" d="
      M-17.7,-17.3
      C-12.2,-21.8 -5.7,-22.2 -0.6,-19.4
      C4.8,-22.0 11.6,-21.2 16.9,-17.0
      C21.1,-13.5 22.3,-7.6 20.4,-1.8
      C23.3,3.8 21.6,10.7 17.2,15.2
      C12.6,19.6 6.7,20.5 1.3,18.4
      C-4.0,21.2 -10.8,20.0 -15.7,15.5
      C-20.2,11.4 -21.8,5.2 -19.5,-0.3
      C-22.1,-5.6 -21.1,-12.5 -17.7,-17.3 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-13.7,-9.4 C-9.6,-7.6 -5.5,-4.8 -1.8,-1.1 C-5.1,2.3 -9.4,5.2 -13.4,8.9"></path>
      <path class="tooth-anatomy" d="M13.9,-8.9 C10.3,-7.0 6.5,-4.4 2.5,-1.0 C5.7,2.5 9.8,5.3 13.7,8.7"></path>
      <path class="tooth-anatomy" d="M-1.8,-1.1 C-0.1,-4.4 0.1,-8.4 0.5,-13.2"></path>
      <path class="tooth-anatomy" d="M2.5,-1.0 C0.8,2.4 0.8,6.9 0.3,13.2"></path>
      <path class="tooth-anatomy" d="M-13.4,8.9 C-8.8,9.9 -5.6,12.1 -3.4,15.4"></path>
      <path class="tooth-cusp" d="M-11.9,-5.0 C-9.2,-10.7 -4.3,-12.6 -1.3,-7.6"></path>
      <path class="tooth-cusp" d="M11.8,-4.9 C9.3,-10.3 4.4,-12.1 1.5,-7.4"></path>
      <path class="tooth-cusp" d="M-11.5,5.8 C-8.8,10.8 -4.0,12.2 -1.2,7.9"></path>
      <path class="tooth-cusp" d="M11.3,5.5 C8.8,10.4 4.4,11.8 1.7,7.8"></path>`;
  }
  else if(pos===7 && upper){
    crown=`<path class="tooth-svg-shape" d="
      M-16.1,-16.9
      C-10.9,-20.9 -5.0,-21.0 -0.4,-18.8
      C4.6,-21.0 10.9,-20.2 15.7,-16.4
      C19.9,-12.8 21.0,-7.1 19.1,-1.4
      C21.2,4.1 19.5,10.1 15.4,14.4
      C11.2,18.5 5.6,19.4 0.6,17.4
      C-4.6,19.8 -10.8,18.5 -15.0,14.2
      C-19.0,10.1 -20.4,4.7 -18.4,-0.6
      C-20.7,-5.6 -19.7,-12.1 -16.1,-16.9 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-12.5,-8.4 C-8.8,-6.6 -5.1,-4.2 -1.7,-0.9 C-4.8,2.0 -8.3,4.7 -12.0,8.0"></path>
      <path class="tooth-anatomy" d="M12.7,-8.2 C9.2,-6.2 5.6,-4.0 2.0,-0.8 C5.2,2.3 8.8,4.7 12.2,7.9"></path>
      <path class="tooth-anatomy" d="M-1.7,-0.9 C-0.2,-4.0 0.0,-7.7 0.2,-12.0"></path>
      <path class="tooth-anatomy" d="M2.0,-0.8 C0.6,2.3 0.6,6.1 0.2,11.9"></path>
      <path class="tooth-cusp" d="M-10.7,-4.8 C-8.4,-9.6 -4.2,-11.0 -1.4,-6.8"></path>
      <path class="tooth-cusp" d="M10.7,-4.6 C8.4,-9.3 4.2,-10.7 1.4,-6.5"></path>`;
  }
  else if(pos===7){
    crown=`<path class="tooth-svg-shape" d="
      M-16.3,-16.2
      C-11.0,-20.2 -5.1,-20.5 -0.5,-18.0
      C4.5,-20.4 10.7,-19.7 15.5,-15.9
      C19.6,-12.4 20.8,-6.9 18.9,-1.4
      C21.0,4.0 19.4,9.7 15.3,13.9
      C11.1,18.0 5.7,18.9 0.8,17.0
      C-4.2,19.3 -10.4,18.2 -14.8,13.9
      C-18.9,9.9 -20.3,4.4 -18.2,-0.8
      C-20.5,-5.7 -19.7,-11.8 -16.3,-16.2 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-12.5,-8.1 C-8.8,-6.4 -5.1,-4.1 -1.6,-0.8 C-4.8,2.1 -8.5,4.7 -12.1,7.9"></path>
      <path class="tooth-anatomy" d="M12.6,-7.8 C9.1,-6.0 5.5,-3.8 2.0,-0.7 C5.1,2.2 8.6,4.6 12.0,7.6"></path>
      <path class="tooth-anatomy" d="M-1.6,-0.8 C-0.1,-3.9 0.1,-7.5 0.3,-11.8"></path>
      <path class="tooth-anatomy" d="M2.0,-0.7 C0.6,2.2 0.5,5.9 0.2,11.6"></path>
      <path class="tooth-cusp" d="M-10.4,-4.5 C-8.1,-9.1 -4.0,-10.6 -1.4,-6.5"></path>
      <path class="tooth-cusp" d="M10.4,-4.4 C8.2,-8.8 4.0,-10.4 1.4,-6.3"></path>`;
  }
  else if(upper){
    crown=`<path class="tooth-svg-shape" d="
      M-14.6,-15.1
      C-10.0,-18.8 -4.9,-19.0 -0.6,-16.9
      C3.7,-19.0 9.2,-18.3 13.5,-15.2
      C17.4,-12.3 19.0,-7.0 17.2,-1.7
      C19.0,3.2 17.4,8.9 13.8,12.7
      C10.1,16.8 5.2,17.9 0.8,15.9
      C-3.9,18.0 -9.2,16.9 -13.0,12.8
      C-16.7,8.9 -18.1,4.0 -16.3,-0.7
      C-18.4,-5.2 -17.8,-10.7 -14.6,-15.1 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-10.5,-7.3 C-7.1,-5.7 -4.2,-3.4 -1.2,-0.4 C-3.9,2.2 -7.0,4.5 -10.1,7.2"></path>
      <path class="tooth-anatomy" d="M10.2,-7.1 C7.1,-5.3 4.3,-3.2 1.2,-0.3 C4.0,2.4 7.0,4.5 10.0,7.0"></path>
      <path class="tooth-anatomy" d="M-1.2,-0.4 C0,-3.1 0,-6.4 0.2,-10.0"></path>
      <path class="tooth-anatomy" d="M1.2,-0.3 C0.2,2.4 0.4,5.6 0,9.7"></path>`;
  }
  else{
    crown=`<path class="tooth-svg-shape" d="
      M-15.0,-15.2
      C-10.4,-18.9 -5.1,-19.2 -0.8,-17.0
      C3.8,-19.1 9.5,-18.5 13.8,-15.0
      C17.7,-11.8 18.8,-6.8 17.2,-1.6
      C19.0,3.5 17.2,9.1 13.5,12.8
      C9.8,16.5 5.1,17.5 0.9,15.8
      C-3.6,17.8 -8.8,16.8 -12.6,13.1
      C-16.4,9.4 -17.9,4.1 -16.0,-0.7
      C-18.0,-5.4 -17.4,-10.8 -15.0,-15.2 Z"></path>`;
    anatomy=`
      <path class="tooth-anatomy" d="M-10.6,-7.2 C-7.2,-5.5 -4.1,-3.3 -1.3,-0.4 C-4.0,2.2 -7.1,4.4 -10.0,7.1"></path>
      <path class="tooth-anatomy" d="M10.4,-7.0 C7.2,-5.3 4.2,-3.1 1.2,-0.3 C4.0,2.3 7.0,4.5 9.9,6.9"></path>
      <path class="tooth-anatomy" d="M-1.3,-0.4 C-0.1,-3.0 0.0,-6.3 0.2,-9.9"></path>
      <path class="tooth-anatomy" d="M1.2,-0.3 C0.2,2.3 0.3,5.5 0,9.6"></path>`;
  }

  return `
    <g class="tooth-glyph ${kind} ${variant}" style="--tooth-color:${color};--tooth-stroke:${stroke};--tooth-line:${line}">
      <g class="tooth-render">
        ${crown}${anatomy}
      </g>
    </g>`;
}

function dentalChartSvg(selected=[],interactive=false,options={}){
  const selectedSet=new Set((selected||[]).map(Number));
  const details=options.details??{};
  const colorByType=Boolean(options.colorByType);
  const defaultSelectedColor=options.defaultSelectedColor||"#c8a468";
  const viewMode=options.viewMode||"upperlower";
  const groups=[];
  const labels=[];

  const build=(teeth)=>{
    teeth.forEach((tooth)=>{
      const p=toothPosition(tooth);
      const isSelected=selectedSet.has(tooth);
      const type=String(details?.[tooth]?.type??"").trim();
      const color=isSelected
        ? (colorByType?workTypeColor(type):defaultSelectedColor)
        : "#d2d2d0";
      const cls=`tooth-svg-group${isSelected?" selected":""}${interactive?" interactive":""}`;

      groups.push(`
        <g class="${cls}" data-tooth="${tooth}" data-tooth-type="${escapeHtml(type)}"
          transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.rotation.toFixed(1)}) scale(${p.scaleX.toFixed(3)} ${p.scaleY.toFixed(3)})"
          ${interactive?'tabindex="0" role="button"':''} aria-label="Tooth ${tooth}${type?`, ${escapeHtml(type)}`:""}">
          ${isSelected?'<circle class="active-tooth-halo" cx="0" cy="0" r="25"></circle>':""}
          ${toothGlyphMarkup(tooth,color,isSelected,interactive)}
        </g>`);

      // Keep FDI number upright and centered, exactly like the supplied reference.
      labels.push(`<text class="tooth-number-label reference-inside-label" data-tooth-label="${tooth}" x="${p.x.toFixed(1)}" y="${(p.y+4).toFixed(1)}" text-anchor="middle">${tooth}</text>`);
    });
  };

  build(FDI_UPPER);
  build(FDI_LOWER);

  const dividers=viewMode==="quadrants"
    ? `<line x1="241" y1="18" x2="241" y2="758" class="chart-divider"></line>
       <line x1="45" y1="388" x2="437" y2="388" class="chart-divider"></line>`
    : viewMode==="upperlower"
      ? `<line x1="55" y1="388" x2="427" y2="388" class="chart-divider horizontal"></line>
         <text x="241" y="350" text-anchor="middle" class="arch-center-letter">U</text>
         <text x="241" y="428" text-anchor="middle" class="arch-center-letter">L</text>`
      : ``;

  return `<svg class="dental-chart-svg anatomical-chart reference-odontogram" viewBox="0 0 474 776" aria-label="FDI anatomical tooth chart">
    <defs>
      <filter id="toothBevel" x="-35%" y="-35%" width="170%" height="170%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="blur"></feGaussianBlur>
        <feSpecularLighting in="blur" surfaceScale="3.5" specularConstant=".52" specularExponent="14" lighting-color="#ffffff" result="spec">
          <fePointLight x="-15" y="-20" z="36"></fePointLight>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="spec2"></feComposite>
        <feBlend in="SourceGraphic" in2="spec2" mode="screen"></feBlend>
      </filter>
    </defs>
    ${dividers}
    ${groups.join("")}
    ${labels.join("")}
  </svg>`;
}

function selectedToothRowHtml(tooth,draft,order){
  const td=draft.perTooth[tooth]||{};
  const typeValue=td.type ?? order.workType ?? "";
  const shadeValue=td.shade ?? draft.shade ?? "";

  return `<tr data-tooth-row="${tooth}">
    <td><strong>${tooth}</strong></td>
    <td>${FDI_TO_US[tooth]??"—"}</td>
    <td><input class="case-tooth-input" data-tooth-field="type" data-tooth="${tooth}" list="caseRestorationList" value="${escapeHtml(typeValue)}" placeholder="Crown / Pontic..."></td>
    <td><input class="case-tooth-input" data-tooth-field="shade" data-tooth="${tooth}" value="${escapeHtml(shadeValue)}" placeholder="A1 / A2..."></td>
  </tr>`;
}

function syncCaseSheetDraftFromInputs(){
  if(activeCaseSheetOrderId===null)return;
  const draft=caseSheetDrafts[activeCaseSheetOrderId];
  if(!draft)return;

  const shade=$("caseShade");
  const method=$("caseMethod");
  const notes=$("caseNotes");
  const doctorNotes=$("caseDoctorNotes");

  if(shade)draft.shade=shade.value;
  if(method)draft.method=method.value;
  if(notes)draft.notes=notes.value;
  if(doctorNotes)draft.doctorNotes=doctorNotes.value;

  document.querySelectorAll("[data-tooth-field]").forEach(el=>{
    const tooth=Number(el.dataset.tooth);
    const field=el.dataset.toothField;
    draft.perTooth[tooth]??={};
    draft.perTooth[tooth][field]=el.value;
  });
}

function bindCaseSheetEditor(order,draft){
  const chart=$("caseToothChart");
  chart?.querySelectorAll("[data-tooth]").forEach(el=>{
    const toggle=()=>{
      syncCaseSheetDraftFromInputs();
      const tooth=Number(el.dataset.tooth);
      const set=new Set(draft.selected.map(Number));
      if(set.has(tooth)){
        set.delete(tooth);
        delete draft.perTooth[tooth];
      }else{
        set.add(tooth);
        draft.perTooth[tooth]??={
          type:"",
          shade:draft.shade||""
        };
      }
      draft.selected=orderedSelectedTeeth([...set]);
      renderCaseSheetEditor(order,draft);
    };

    el.addEventListener("click",toggle);
    el.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){
        e.preventDefault();
        toggle();
      }
    });
  });

  ["caseShade","caseMethod","caseNotes","caseDoctorNotes"].forEach(id=>{
    $(id)?.addEventListener("input",syncCaseSheetDraftFromInputs);
  });

  document.querySelectorAll("[data-tooth-field]").forEach(el=>{
    el.addEventListener("input",syncCaseSheetDraftFromInputs);
  });

  $("clearCaseTeethBtn")?.addEventListener("click",()=>{
    syncCaseSheetDraftFromInputs();
    draft.selected=[];
    draft.perTooth={};
    renderCaseSheetEditor(order,draft);
  });

  $("selectAnteriorBtn")?.addEventListener("click",()=>{
    syncCaseSheetDraftFromInputs();
    const anterior=[13,12,11,21,22,23,43,42,41,31,32,33];
    draft.selected=orderedSelectedTeeth(anterior);
    for(const t of draft.selected){
      draft.perTooth[t]??={
        type:"",
        shade:draft.shade||""
      };
    }
    renderCaseSheetEditor(order,draft);
  });
}

function renderCaseSheetEditor(order,draft){
  const selected=orderedSelectedTeeth(draft.selected);
  caseSheetTitle.textContent=`Case sheet · #${order.id}`;
  caseSheetSubtitle.textContent=`${order.patient||"Pacient"} · ${order.partner||"Partener"}`;

  caseSheetContent.innerHTML=`
    <div class="case-summary-grid">
      <div><span>Patient</span><strong>${escapeHtml(order.patient)||"—"}</strong></div>
      <div><span>Partner</span><strong>${escapeHtml(order.partner)||"—"}</strong></div>
      <div><span>Work type</span><strong>${escapeHtml(order.workType)||"—"}</strong></div>
      <div><span>Date</span><strong>${fmtDate(order.deadline)}</strong></div>
      <div><span>Work order</span><strong>#${order.id}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(uiText(order.status))||"—"}</strong></div>
    </div>

    <div class="case-editor-layout">
      <section class="case-card case-tooth-card">
        <div class="case-card-head">
          <div>
            <h3>Select teeth</h3>
            <p>Click the FDI teeth that belong to this work order.</p>
          </div>
          <div class="case-tooth-tools">
            <button id="selectAnteriorBtn" class="secondary-btn compact-btn" type="button">Anterior</button>
            <button id="clearCaseTeethBtn" class="secondary-btn compact-btn" type="button">Clear</button>
          </div>
        </div>

        <div id="caseToothChart" class="case-tooth-chart">
          ${dentalChartSvg(selected,true)}
        </div>

        <div class="case-selected-line">
          <strong>${selected.length}</strong> selected
          <span>·</span>
          <span>Elemente derivate: ${order.elements||0}</span>
        </div>
      </section>

      <section class="case-card case-prescription-card">
        <div class="case-card-head">
          <div>
            <h3>Prescription details</h3>
            <p>Optional details printed on the physical case sheet.</p>
          </div>
        </div>

        <div class="case-prescription-grid">
          <label>Shade
            <input id="caseShade" value="${escapeHtml(draft.shade)}" placeholder="A1, A2, BL2...">
          </label>
          <label>Method
            <select id="caseMethod">
              ${METHOD_SUGGESTIONS.map(v=>`<option value="${escapeHtml(v)}" ${v===draft.method?"selected":""}>${escapeHtml(v)}</option>`).join("")}
            </select>
          </label>
          <label>Clinic / doctor note
            <input id="caseDoctorNotes" value="${escapeHtml(draft.doctorNotes)}" placeholder="Try-in, occlusion, contact...">
          </label>
          <label class="case-wide">Production notes
            <textarea id="caseNotes" rows="4" placeholder="Important instructions for the box / production team...">${escapeHtml(draft.notes)}</textarea>
          </label>
        </div>

        <datalist id="caseRestorationList">${RESTORATION_SUGGESTIONS.map(x=>`<option value="${escapeHtml(x)}"></option>`).join("")}</datalist>
      </section>
    </div>

    <section class="case-card selected-teeth-card">
      <div class="case-card-head">
        <div>
          <h3>Selected tooth details</h3>
            <p>Each tooth has its own restoration type and shade.</p>
        </div>
      </div>

      <div class="table-wrap case-selected-table">
        <table>
          <thead>
            <tr><th>FDI</th><th>US</th><th>Type</th><th>Shade</th></tr>
          </thead>
          <tbody>
            ${selected.length
              ? selected.map(t=>selectedToothRowHtml(t,draft,order)).join("")
              : '<tr><td colspan="4" class="empty-case-row">Select at least one tooth from the chart above.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;

  caseSheetFooterHint.textContent="Datele cazului sunt păstrate în baza de date. Modificările se salvează înainte de Print/PDF.";

  bindCaseSheetEditor(order,draft);
}

async function openCaseSheet(orderIdValue){
  if(!auth||!can("Can_View_Client_Pricing")){
    alert("Your role cannot access case sheets.");
    return;
  }

  const id=Number(orderIdValue);
  const order=orders.find(o=>Number(o.id)===id);
  if(!order){
    alert(`Work order #${id} was not found in the currently loaded dataset.`);
    return;
  }

  showLoading("Deschid fișa","Caut configurația dentară...");
  try{
    activeCaseSheetOrderId=id;
    const saved=await fetchPatientCase(id);
    const draft=draftFromServerCase(order,saved);
    caseSheetDrafts[id]=draft;
    renderCaseSheetEditor(order,draft);
    caseSheetBackdrop.classList.remove("hidden");
    document.body.classList.add("case-sheet-open");
  }catch(err){
    activeCaseSheetOrderId=null;
    alert(`Could not load case sheet: ${err.message}`);
  }finally{
    hideLoading();
  }
}
window.openCaseSheet=openCaseSheet;

function closeCaseSheet(){
  syncCaseSheetDraftFromInputs();
  caseSheetBackdrop?.classList.add("hidden");
  document.body.classList.remove("case-sheet-open");
  activeCaseSheetOrderId=null;
}

async function saveActiveCaseSheet(showFeedback=true){
  if(activeCaseSheetOrderId===null)return null;
  syncCaseSheetDraftFromInputs();
  const draft=caseSheetDrafts[activeCaseSheetOrderId];
  if(!draft)return null;

  if(showFeedback)showLoading("Salvez fișa","Pun la păstrare datele dentare...");
  try{
    const result=await persistPatientCase(activeCaseSheetOrderId,draft);
    caseSheetFooterHint.textContent=`Salvat · ${new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
    return result;
  }finally{
    if(showFeedback)hideLoading();
  }
}

function buildCaseReportFromOrderForm(){
  syncOrderCaseDraftFromInputs();
  const scope=currentOrderScope();

  return {
    id:Number(orderId.value)>0?Number(orderId.value):"DRAFT",
    patient:String(patient.value||"").trim(),
    partner:String(partner.value||"").trim(),
    workType:scope.work_type_summary,
    deadline:String(dueDate.value||"").trim(),
    receptionDate:String(receptionDate.value||"").trim(),
    status:String(status.value||"Not Started"),
    elements:scope.element_count,
    modelTech:String(modelTech.value||""),
    modelingTech:String(modelingTech.value||""),
    ceramicTech:String(ceramicTech.value||"")
  };
}


function caseSheetSimpleToothShape(tooth){
  const pos=Number(tooth)%10;
  const upper=Number(tooth)<30;

  if(pos===1){
    return upper
      ? `<path d="M-12,-16 Q-8,-19 0,-19 Q8,-19 12,-16 L10,11 Q7,16 0,17 Q-7,16 -10,11 Z"></path>`
      : `<path d="M-9,-13 Q-6,-16 0,-16 Q6,-16 9,-13 L8,9 Q6,13 0,14 Q-6,13 -8,9 Z"></path>`;
  }
  if(pos===2){
    return upper
      ? `<path d="M-10,-14 Q-7,-17 0,-17 Q7,-17 10,-14 L9,10 Q6,14 0,15 Q-6,14 -9,10 Z"></path>`
      : `<path d="M-8,-12 Q-5,-15 0,-15 Q5,-15 8,-12 L7,9 Q5,12 0,13 Q-5,12 -7,9 Z"></path>`;
  }
  if(pos===3){
    return `<path d="M0,-18 Q9,-15 11,-7 L9,10 Q4,16 0,18 Q-5,15 -9,10 L-11,-7 Q-8,-15 0,-18 Z"></path>`;
  }
  if(pos===4||pos===5){
    return `<path d="M-14,-13 Q-8,-18 0,-16 Q8,-18 14,-13 Q17,-6 14,1 Q17,9 10,14 Q2,17 -5,15 Q-13,17 -15,9 Q-18,1 -15,-6 Q-17,-10 -14,-13 Z"></path>`;
  }
  if(pos===6){
    return `<path d="M-17,-14 Q-11,-19 -3,-17 Q5,-20 14,-16 Q19,-11 17,-3 Q20,5 15,12 Q9,18 1,16 Q-7,19 -14,15 Q-20,10 -17,2 Q-20,-6 -17,-14 Z"></path>`;
  }
  if(pos===7){
    return `<path d="M-16,-14 Q-10,-18 -3,-17 Q5,-19 13,-15 Q18,-10 16,-3 Q19,5 14,11 Q9,17 1,16 Q-7,18 -13,14 Q-19,9 -16,2 Q-19,-6 -16,-14 Z"></path>`;
  }
  return `<path d="M-15,-13 Q-9,-18 -2,-16 Q5,-18 12,-14 Q17,-9 15,-2 Q18,5 13,11 Q8,16 1,15 Q-6,17 -12,13 Q-17,8 -15,1 Q-18,-6 -15,-13 Z"></path>`;
}

function caseSheetNumberChartSvg(selected=[]){
  const selectedSet=new Set((selected||[]).map(Number));
  const all=[...FDI_UPPER,...FDI_LOWER];

  const teeth=all.map(tooth=>{
    const p=toothPosition(tooth);
    const isSelected=selectedSet.has(tooth);

    return `
      <g class="pdf-simple-tooth ${isSelected?"selected":""}"
         transform="translate(${p.x} ${p.y}) rotate(${p.rotation}) scale(${p.scaleX*.86} ${p.scaleY*.86})">
        ${caseSheetSimpleToothShape(tooth)}
      </g>
      <text class="pdf-simple-number ${isSelected?"selected":""}"
            x="${p.x}" y="${p.y+5}" text-anchor="middle">${tooth}</text>`;
  }).join("");

  return `<svg class="case-sheet-number-chart" viewBox="0 0 474 776" aria-label="Schema dentară">
    ${teeth}
  </svg>`;
}

function renderPhysicalCaseSheet(order,draft){
  const selected=orderedSelectedTeeth(draft.selected);
  if(!selected.length){
    alert("Select at least one tooth before printing the case sheet.");
    return false;
  }

  if(!String(order.patient||"").trim()){
    alert("Patient name is required before printing the case sheet.");
    return false;
  }

  const reportWindow=window.open("","_blank","width=1050,height=850");
  if(!reportWindow){
    alert("The print window was blocked by the browser. Please allow pop-ups for this site.");
    return false;
  }

  const generated=new Date().toLocaleString("ro-RO");
  const logoUrl=new URL("assets/flowrise-brand.jpg",window.location.href).href;

  const rows=selected.map(tooth=>{
    const td=draft.perTooth[tooth]||{};
    const type=td.type||"—";
    const shade=td.shade||draft.shade||"—";
    const toothNote=String(td.note||"").trim()||"—";

    return `<tr>
      <td><strong>${tooth}</strong></td>
      <td>${FDI_TO_US[tooth]??"—"}</td>
      <td>${escapeHtml(uiText(type))}</td>
      <td>${escapeHtml(shade)}</td>
      <td>${escapeHtml(toothNote)}</td>
    </tr>`;
  }).join("");

  const orderLabel=String(order.id)==="DRAFT"?"DRAFT":`#${order.id}`;

  reportWindow.document.open();
  reportWindow.document.write(`<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<title>Fișă lucrare ${escapeHtml(orderLabel)} - ${escapeHtml(order.patient)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#181715;background:#fff;font-size:10pt}
  .page{padding:8mm}
  .actions{display:flex;justify-content:flex-end;margin-bottom:8px}
  .actions button{border:0;border-radius:6px;padding:9px 13px;background:#c99a36;color:#fff;font-weight:700;cursor:pointer}
  .header{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;align-items:start;margin-bottom:10px}
  .brand-line{display:flex;gap:12px;align-items:center;border-bottom:2px solid #b18b54;padding-bottom:9px}
  .brand-line img{width:86px;height:54px;object-fit:cover;border-radius:5px}
  h1{font-size:20pt;margin:0 0 3px}
  .subtitle{color:#74695b;font-size:9pt}
  .case-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px;margin-top:11px}
  .meta-item span{display:block;color:#777066;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
  .meta-item strong{font-size:10pt}
  .chart-wrap{border:1px solid #ddd6cd;border-radius:8px;padding:4px;background:#f6f5f3}
  .case-sheet-number-chart{width:100%;height:270px}
  .pdf-simple-tooth path{fill:#f3f0eb;stroke:#aaa39b;stroke-width:1.2;vector-effect:non-scaling-stroke}
  .pdf-simple-tooth.selected path{fill:#d8ab5c;stroke:#6b4c22;stroke-width:1.6}
  .pdf-simple-number{fill:#6f675d;font-size:15px;font-weight:900;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
  .pdf-simple-number.selected{fill:#17130e;font-size:17px;stroke:#f3d9a9;stroke-width:2.5px}
  .dental-chart-svg{width:100%;height:225px}
  .tooth-svg-shape{fill:#fff;stroke:#777;stroke-width:1.1}
  .tooth-svg-group.selected .tooth-svg-shape{fill:#b18b54;stroke:#5c4322;stroke-width:1.5}
  .tooth-svg-label{font-size:8.5px;font-weight:700;fill:#35322d}
  .tooth-svg-group.selected .tooth-svg-label{fill:#111}
  .arch-caption{font-size:9px;fill:#8a8176;font-weight:700;letter-spacing:.08em}
  .midline{stroke:#ddd5ca;stroke-width:1;stroke-dasharray:3 4}
  .section-title{font-size:11pt;font-weight:800;margin:13px 0 6px;border-bottom:1px solid #222;padding-bottom:5px}
  .summary-strip{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin:9px 0}
  .summary-strip div{border:1px solid #ddd6cd;border-radius:6px;padding:7px}
  .summary-strip span{display:block;font-size:7.5pt;color:#777066;text-transform:uppercase;margin-bottom:3px}
  .summary-strip strong{font-size:9.5pt}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{font-size:8pt;text-align:left;background:#f0ece6;padding:6px;border-bottom:1px solid #999}
  td{padding:6px;border-bottom:1px solid #e3ded7;font-size:9pt;vertical-align:top;overflow-wrap:anywhere}
  th:nth-child(1){width:7%}
  th:nth-child(2){width:7%}
  th:nth-child(3){width:22%}
  th:nth-child(4){width:16%}
  th:nth-child(5){width:12%}
  th:nth-child(6){width:36%}
  .note-box{border:1px solid #aaa;border-radius:6px;min-height:52px;padding:8px;white-space:pre-wrap}
  .warning{margin-top:7px;padding:7px;border:1px solid #d59b2b;background:#fff6df;border-radius:5px;font-size:8.5pt}
  .footer{margin-top:13px;display:flex;justify-content:space-between;color:#8a8176;font-size:7.5pt}
  @page{size:A4 portrait;margin:8mm}
  @media print{
    .actions{display:none}
    .page{padding:0}
    thead{display:table-header-group}
    tr{break-inside:avoid}
  }
</style>
</head>
<body>
<div class="page">
  <div class="actions"><button onclick="window.print()">Tipărește / Salvează PDF</button></div>

  <div class="header">
    <div>
      <div class="brand-line">
        <img src="${logoUrl}" alt="Flowrise Dental Studio">
        <div>
          <h1>Fișă lucrare</h1>
          <div class="subtitle">Flowrise Dental Studio · Lucrare ${escapeHtml(orderLabel)}</div>
        </div>
      </div>

      <div class="case-meta">
        <div class="meta-item"><span>Pacient</span><strong>${escapeHtml(order.patient)||"—"}</strong></div>
        <div class="meta-item"><span>Partener</span><strong>${escapeHtml(order.partner)||"—"}</strong></div>
        <div class="meta-item"><span>Dată</span><strong>${fmtDate(order.deadline)}</strong></div>
      </div>
    </div>

    <div class="chart-wrap">
      ${caseSheetNumberChartSvg(selected)}
    </div>
  </div>

  <div class="summary-strip">
    <div><span>Dinți selectați</span><strong>${selected.join(", ")}</strong></div>
    <div><span>Nr. elemente</span><strong>${order.elements||0}</strong></div>
  </div>

  <div class="section-title">Detalii elemente</div>
  <table>
    <thead><tr><th>FDI</th><th>US</th><th>Tip lucrare</th><th>Culoare</th><th>Observații</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="section-title">Instrucțiuni de producție</div>
  <div class="note-box">${escapeHtml(draft.notes||"—")}</div>

  ${draft.doctorNotes?`
    <div class="section-title">Notă clinică</div>
    <div class="note-box">${escapeHtml(draft.doctorNotes)}</div>
  `:""}

  <div class="footer">
    <span>Generat: ${escapeHtml(generated)}</span>
    <span>Flowrise Dental Studio · Fișă lucrare ${escapeHtml(orderLabel)}</span>
  </div>
</div>
</body>
</html>`);

  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(()=>reportWindow.print(),350);
  return true;
}

async function printCaseSheet(){
  if(activeCaseSheetOrderId===null)return;

  syncCaseSheetDraftFromInputs();

  const order=orders.find(o=>Number(o.id)===Number(activeCaseSheetOrderId));
  const draft=caseSheetDrafts[activeCaseSheetOrderId];
  if(!order||!draft)return;

  const selected=orderedSelectedTeeth(draft.selected);
  if(!selected.length){
    alert("Select at least one tooth before printing the case sheet.");
    return;
  }

  await saveActiveCaseSheet(false);
  renderPhysicalCaseSheet(order,draft);
}

async function printOrderCaseSheet(){
  syncOrderCaseDraftFromInputs();

  const order=buildCaseReportFromOrderForm();
  if(!orderCaseDraft)return;

  const selected=orderedSelectedTeeth(orderCaseDraft.selected);
  if(!selected.length){
    alert("Select at least one tooth before printing the case sheet.");
    return;
  }

  const existingId=Number(orderId.value);

  // Normal editable flow:
  // persist the latest Case Information / teeth before generating the PDF.
  //
  // Doctor read-only flow (Locked or Status != Not Started):
  // DO NOT UPSERT the patient case. The case was already loaded with GET when
  // Edit/View opened, so export must remain a pure read/print action.
  //
  // This mirrors the working "Export fișă" button from the Work Orders list.
  const readOnlyDoctorExport=isDoctor() && existingId>0 && doctorModalReadOnly();

  if(existingId>0 && !readOnlyDoctorExport){
    await persistPatientCase(existingId,orderCaseDraft);
  }

  renderPhysicalCaseSheet(order,orderCaseDraft);
}

function renderTechnicians(){
  pageTitle.textContent=isTechnician()?"Salariu":"Tehnicieni";
  updateOldToggle();

  const technicianSalaryStatuses=["Not Started","Started","Finished","Shipped"];
  if(isTechnician()&&technicianReportFilters.status&&!technicianSalaryStatuses.includes(technicianReportFilters.status)){
    technicianReportFilters.status="";
  }

  if(isTechnician() && !technicianReportFilters.technician){
    technicianReportFilters.technician=auth?.user?.Technician_Name||"";
  }

  const visible=applyViewDateRanges(displayedOrders(),"technicians");
  const dateBar=dateRangeFilterBar("technicians",[{field:"deadline",label:"Termen"}]);
  const selectedTech=technicianReportFilters.technician || (isTechnician()?auth?.user?.Technician_Name:"");
  const effectiveFilters={...technicianReportFilters,technician:selectedTech};

  const reportRows=filterByReportControls(
    visible,
    effectiveFilters,
    {technician:Boolean(selectedTech)}
  );

  const partnerOptions=[...new Set(visible.map(o=>o.partner).filter(Boolean))];
  const workTypeOptions=[...new Set(visible.map(o=>o.workType).filter(Boolean))];
  const technicianOptions=isTechnician()
    ? [auth?.user?.Technician_Name].filter(Boolean)
    : technicians;

  const filterBar=`<div class="report-filter-panel">
    <div class="report-filter-head">
      <div>
        <strong>${isTechnician()?"Filtre salariu":"Technician report filters"}</strong>
        <span>${isTechnician()?`${reportRows.length} lucrări asignate`:selectedTech?`${reportRows.length} matching work orders for ${escapeHtml(selectedTech)}`:"Select a technician for cost reporting"}</span>
      </div>
      <button id="technicianPdfBtn" class="primary-btn report-pdf-btn" type="button" ${selectedTech?"":"disabled"}>${isTechnician()?"Exportă PDF":"PDF report"}</button>
    </div>
    <div class="report-filter-grid technician-report-grid">
      <label>Technician
        <select data-technician-report-filter="technician" ${isTechnician()?"disabled":""}>
          ${reportSelect(technicianOptions,selectedTech,isTechnician()?"My technician":"Selectează tehnician")}
        </select>
      </label>
      <label>Status
        <select data-technician-report-filter="status">${reportSelect(isTechnician()?technicianSalaryStatuses:statuses,technicianReportFilters.status,"Toate statusurile")}</select>
      </label>
      <label>Partner
        <select data-technician-report-filter="partner">${reportSelect(partnerOptions,technicianReportFilters.partner,"Toți partenerii")}</select>
      </label>
      <label>Patient
        <input data-technician-report-filter="patient" value="${escapeHtml(technicianReportFilters.patient)}" placeholder="Caută pacient...">
      </label>
      <label>Work type
        <select data-technician-report-filter="workType">${reportSelect(workTypeOptions,technicianReportFilters.workType,"Toate tipurile de lucrare")}</select>
      </label>
    </div>
    <div class="report-filter-foot">
      <span>${isTechnician()?"PDF: Lucrare · Etapa mea · Plătit/Neplătit · De încasat":"PDF columns: Patient · Partner · Elements · Selected technician cost · Status"}</span>
      <button id="clearTechnicianReportFilters" class="secondary-btn" type="button">Clear filters</button>
    </div>
  </div>`;

  // For the visual technician screen, selected technician/status/etc are primary filters.
  // Existing detailed column filters are additionally applied on desktop.
  let baseRows=reportRows;

  if(isTechnician()){
    pageSubtitle.textContent="Etapele tale · status plată · sume de încasat";

    if(isMobileLayout()){
      content.innerHTML=dateBar+filterBar+`<div class="kpi-grid">
        ${kpi("De încasat",money(baseRows.reduce((s,o)=>s+selectedTechnicianCost(o,selectedTech),0)),"Lucrări filtrate")}
        ${kpi("Lucrări asignate",baseRows.length,"Lucrări filtrate")}
        ${kpi("Elemente",baseRows.reduce((s,o)=>s+o.elements,0),"Lucrări filtrate")}
        ${kpi("Status",uiText(technicianReportFilters.status||"Toate"),"Filtru curent")}
      </div>
      <div class="mobile-card-list">${baseRows.length?baseRows.map(o=>`<article class="mobile-order-card">
        <div class="mobile-card-head">
          <div><div class="mobile-id">#${o.id}</div><strong>${escapeHtml(o.patient)||"—"}</strong><div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div></div>
          <span class="mobile-status-badge">${escapeHtml(o.status||"—")}</span>
        </div>
        <div class="mobile-card-grid">
          <div><span>Elemente</span><strong>${o.elements}</strong></div>
          <div><span>De încasat</span><strong>${money(selectedTechnicianCost(o,selectedTech))}</strong></div>
          <div><span>Tip lucrare</span><strong>${escapeHtml(o.workType)||"—"}</strong></div>
          <div><span>Termen</span><strong>${fmtDate(o.deadline)}</strong></div>
        </div>
        <div class="mobile-stage-block">${technicianSalaryStageHtml(o)}</div>
      </article>`).join(""):'<div class="empty-state mobile-empty">No matching technician work.</div>'}</div>`;
      wireTechnicianReportFilters();
      wireDateRangeFilters("technicians",renderTechnicians);
      return;
    }

    const cols=[
      {key:"id",label:"ID",type:"number",r:o=>`#${o.id}`},
      {key:"deadline",label:"Termen",type:"text",sortType:"date",r:o=>fmtDate(o.deadline)},
      {key:"patient",label:"Pacient",type:"text",r:o=>escapeHtml(o.patient)},
      {key:"partner",label:"Partener",type:"text",r:o=>escapeHtml(o.partner)},
      {key:"workType",label:"Tip lucrare",type:"text",r:o=>escapeHtml(o.workType)},
      {key:"elements",label:"Elemente",type:"number",r:o=>o.elements},
      {key:"ownCost",label:"De încasat",type:"number",sortValue:o=>selectedTechnicianCost(o,selectedTech),r:o=>`<strong>${money(selectedTechnicianCost(o,selectedTech))}</strong>`},
      {key:"status",label:"Status lucrare",type:"text",r:o=>escapeHtml(uiText(o.status))},
      {key:"stages",label:"Etapa mea / Plată",type:"text",sortValue:o=>technicianSalarySearchText(o),r:o=>technicianSalaryStageHtml(o)}
    ];

    let rows=baseRows.filter(o=>cols.every(c=>{
      const value=c.key==="stages"
        ? technicianSalarySearchText(o)
        : c.key==="ownCost"
          ? selectedTechnicianCost(o,selectedTech)
          : o[c.key];
      return filterMatch(value,techFilters[c.key],c.type);
    }));
    rows=sortedByColumns(rows,cols,techSort);

    content.innerHTML=dateBar+filterBar+`<div class="kpi-grid">
      ${kpi("De încasat",money(rows.reduce((s,o)=>s+selectedTechnicianCost(o,selectedTech),0)),"Lucrări filtrate")}
      ${kpi("Lucrări asignate",rows.length,"Lucrări filtrate")}
      ${kpi("Elemente",rows.reduce((s,o)=>s+o.elements,0),"Lucrări filtrate")}
      ${kpi("Status",uiText(technicianReportFilters.status||"Toate"),"Filtru curent")}
    </div>
    <div class="card panel">
      <div class="table-tools"><strong>Salariul meu</strong><button id="clearTechFilters" class="secondary-btn">Șterge filtrele coloanelor</button></div>
      <div class="table-wrap"><table>
        <thead><tr>${cols.map(c=>sortableHeader(c,"tech",techSort)).join("")}</tr>
        <tr class="filter-row">${cols.map(c=>`<th><input class="filter-input" data-tech-filter="${c.key}" value="${escapeHtml(techFilters[c.key]??"")}" placeholder="filter..."></th>`).join("")}</tr></thead>
        <tbody>${rows.length?rows.map(o=>`<tr>${cols.map(c=>`<td>${c.r(o)}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${cols.length}">No matching rows.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  }else{
    pageSubtitle.textContent="Filter by technician/status and export the selected technician cost";

    const cols=[
      {key:"id",label:"ID",type:"number",r:o=>`#${o.id}`},
      {key:"deadline",label:"Termen",type:"text",sortType:"date",r:o=>fmtDate(o.deadline)},
      {key:"patient",label:"Pacient",type:"text",r:o=>escapeHtml(o.patient)},
      {key:"partner",label:"Partener",type:"text",r:o=>escapeHtml(o.partner)},
      {key:"workType",label:"Work Type",type:"text",r:o=>escapeHtml(o.workType)},
      {key:"elements",label:"Elements",type:"number",r:o=>o.elements},
      {key:"status",label:"Status",type:"text",r:o=>escapeHtml(uiText(o.status))},
      {key:"selectedCost",label:selectedTech?`${escapeHtml(selectedTech)} Cost`:"Selected Tech Cost",type:"number",sortValue:o=>selectedTech?selectedTechnicianCost(o,selectedTech):0,r:o=>selectedTech?money(selectedTechnicianCost(o,selectedTech)):"—"},
      {key:"modelTech",label:"Model Tech",type:"text",r:o=>escapeHtml(o.modelTech)||"—"},
      {key:"modelingTech",label:"Modelare Tech",type:"text",r:o=>escapeHtml(o.modelingTech)||"—"},
      {key:"ceramicTech",label:"Cer Fin Tech",type:"text",r:o=>escapeHtml(o.ceramicTech)||"—"}
    ];

    let rows=baseRows.filter(o=>cols.every(c=>{
      const value=c.key==="selectedCost"?selectedTechnicianCost(o,selectedTech):o[c.key];
      return filterMatch(value,techFilters[c.key],c.type);
    }));
    rows=sortedByColumns(rows,cols,techSort);

    const selectedTotal=selectedTech?rows.reduce((s,o)=>s+selectedTechnicianCost(o,selectedTech),0):0;

    if(isMobileLayout()){
      content.innerHTML=dateBar+filterBar+`<div class="kpi-grid">
        ${kpi("Tehnician",selectedTech||"—","Selected filter")}
        ${kpi("Lucrări",rows.length,"Filtered rows")}
        ${kpi("Elements",rows.reduce((s,o)=>s+o.elements,0),"Filtered rows")}
        ${kpi("Technician cost",selectedTech?money(selectedTotal):"—","Selected technician")}
      </div>
      <div class="mobile-card-list">${rows.length?rows.map(o=>`<article class="mobile-order-card">
        <div class="mobile-card-head">
          <div><div class="mobile-id">#${o.id}</div><strong>${escapeHtml(o.patient)||"—"}</strong><div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div></div>
          <span class="mobile-status-badge">${escapeHtml(o.status||"—")}</span>
        </div>
        <div class="mobile-card-grid">
          <div><span>Elements</span><strong>${o.elements}</strong></div>
          <div><span>${escapeHtml(selectedTech||"Tehnician")} cost</span><strong>${selectedTech?money(selectedTechnicianCost(o,selectedTech)):"Selectează tehnician"}</strong></div>
          <div><span>Work type</span><strong>${escapeHtml(o.workType)||"—"}</strong></div>
          <div><span>Deadline</span><strong>${fmtDate(o.deadline)}</strong></div>
        </div>
      </article>`).join(""):'<div class="empty-state mobile-empty">No matching technician work.</div>'}</div>`;
      wireTechnicianReportFilters();
      wireDateRangeFilters("technicians",renderTechnicians);
      return;
    }

    content.innerHTML=dateBar+filterBar+`<div class="kpi-grid">
      ${kpi("Tehnician",selectedTech||"—","Selected filter")}
      ${kpi("Lucrări",rows.length,"Filtered rows")}
      ${kpi("Elements",rows.reduce((s,o)=>s+o.elements,0),"Filtered rows")}
      ${kpi("Technician cost",selectedTech?money(selectedTotal):"—","Selected technician")}
    </div>
    <div class="card panel">
      <div class="table-tools"><strong>Technician Costs</strong><button id="clearTechFilters" class="secondary-btn">Clear column filters</button></div>
      <div class="table-wrap"><table>
        <thead><tr>${cols.map(c=>sortableHeader(c,"tech",techSort)).join("")}</tr>
        <tr class="filter-row">${cols.map(c=>`<th><input class="filter-input" data-tech-filter="${c.key}" value="${escapeHtml(techFilters[c.key]??"")}" placeholder="filter..."></th>`).join("")}</tr></thead>
        <tbody>${rows.length?rows.map(o=>`<tr>${cols.map(c=>`<td>${c.r(o)}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${cols.length}">No matching rows.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  }

  document.querySelectorAll("[data-tech-filter]").forEach(el=>el.addEventListener("input",e=>{
    const key=e.target.dataset.techFilter;
    techFilters[key]=e.target.value;
    renderTechnicians();
    const next=document.querySelector(`[data-tech-filter="${key}"]`);
    if(next){
      next.focus();
      next.selectionStart=next.selectionEnd=next.value.length;
    }
  }));
  $("clearTechFilters")?.addEventListener("click",()=>{techFilters={};renderTechnicians();});
  wireTechnicianReportFilters();
  wireDateRangeFilters("technicians",renderTechnicians);
  wireSortHeaders();
}



const CALENDAR_EVENT_TYPES=["Întâlnire","Plată","Comandă materiale","Livrare","Reminder","Altul"];
const CALENDAR_STATUSES=["Planificat","Finalizat","Anulat"];
const MATERIAL_UM=["buc","disc","g","kg","ml","l","set","cutie","rolă","alt"];

function normalizeCalendarEvent(r){
  return {
    id:num(r.ID),title:String(r.Title??""),type:String(r.Event_Type??"Altul"),
    startDate:toDateInputValue(r.Start_Date),endDate:toDateInputValue(r.End_Date),
    startTime:String(r.Start_Time??""),description:String(r.Description??""),status:String(r.Status??"Planificat"),
    createdBy:String(r.Created_By_User_ID??""),createdAt:String(r.Created_At??""),updatedBy:String(r.Updated_By_User_ID??""),updatedAt:String(r.Updated_At??"")
  };
}

function normalizeMaterialRow(r){
  return {
    id:num(r.ID),supplier:String(r.Furnizor??""),material:String(r.Material??""),um:String(r.UM??""),
    quantity:num(r.Cantitate),minStock:num(r.Prag_Minim),lastUpdate:toDateInputValue(r.Ultima_Actualizare),
    notes:String(r.Observatii??""),createdBy:String(r.Created_By_User_ID??""),createdAt:String(r.Created_At??""),
    updatedBy:String(r.Updated_By_User_ID??""),updatedAt:String(r.Updated_At??"")
  };
}

async function loadCalendarData(show=false){
  if(!isManagement())return;
  if(calendarLoading)return;
  calendarLoading=true;
  if(show)showLoading("Calendar","Caut evenimentele...");
  try{
    const result=await fetchJson(API.calendar,authPayload({action:"list"}));
    if(!result?.ok)throw new Error(result?.reply||"Nu s-a putut încărca calendarul.");
    calendarEvents=(Array.isArray(result.events)?result.events:[]).map(normalizeCalendarEvent);
    calendarLoaded=true;
  }catch(err){
    calendarLoaded=true;
    setConnection(false,"Calendar indisponibil");
    throw err;
  }finally{
    calendarLoading=false;
    if(show)hideLoading();
  }
}

async function loadMaterialsData(show=false){
  if(materialsLoading)return;
  materialsLoading=true;
  if(show)showLoading("Materiale","Număr ce avem pe raft...");
  try{
    const result=await fetchJson(API.materials,authPayload({action:"list"}));
    if(!result?.ok)throw new Error(result?.reply||"Nu s-au putut încărca materialele.");
    materialsInventory=(Array.isArray(result.materials)?result.materials:[]).map(normalizeMaterialRow);
    materialsLoaded=true;
  }catch(err){
    materialsLoaded=true;
    setConnection(false,"Materiale indisponibile");
    throw err;
  }finally{
    materialsLoading=false;
    if(show)hideLoading();
  }
}

function calendarTypeClass(type){
  const n=normalize(type);
  if(n.includes("plata"))return "calendar-type-payment";
  if(n.includes("comand"))return "calendar-type-order";
  if(n.includes("intaln"))return "calendar-type-meeting";
  if(n.includes("livrare"))return "calendar-type-delivery";
  if(n.includes("reminder"))return "calendar-type-reminder";
  return "calendar-type-other";
}

function calendarEventsForDay(dateStr){
  return calendarEvents.filter(e=>{
    const start=e.startDate||"";
    const end=e.endDate||start;
    return start&&dateStr>=start&&dateStr<=end;
  }).sort((a,b)=>String(a.startTime||"").localeCompare(String(b.startTime||""))||a.title.localeCompare(b.title));
}

function calendarIsoDate(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function openCalendarEditor(id=null,date=null){
  if(!isManagement())return;
  if(id){
    const e=calendarEvents.find(x=>x.id===Number(id));
    if(!e)return;
    calendarEditor={...e};
  }else{
    const day=date||calendarIsoDate(new Date());
    calendarEditor={id:0,title:"",type:"Întâlnire",startDate:day,endDate:day,startTime:"",description:"",status:"Planificat"};
  }
  renderCalendar();
}
window.openCalendarEditor=openCalendarEditor;

function closeCalendarEditor(){calendarEditor=null;renderCalendar();}
window.closeCalendarEditor=closeCalendarEditor;

async function calendarRequest(action,data={}){
  showLoading("Calendar","Salvez evenimentul...");
  try{
    const result=await fetchJson(API.calendar,authPayload({action,data}));
    if(!result?.ok)throw new Error(result?.reply||"Operația calendarului a eșuat.");
    calendarLoaded=false;
    calendarEditor=null;
    await loadCalendarData(false);
    if(currentView==="calendar")renderCalendar();
    return result;
  }finally{hideLoading();}
}

async function saveCalendarEditor(){
  const data={
    ID:num($("calendarEventId")?.value),Title:String($("calendarTitle")?.value||"").trim(),
    Event_Type:$("calendarType")?.value||"Altul",Start_Date:$("calendarStartDate")?.value||"",
    End_Date:$("calendarEndDate")?.value||$("calendarStartDate")?.value||"",Start_Time:$("calendarStartTime")?.value||"",
    Description:String($("calendarDescription")?.value||"").trim(),Status:$("calendarStatus")?.value||"Planificat"
  };
  if(!data.Title||!data.Start_Date){alert("Titlul și data de început sunt obligatorii.");return;}
  await calendarRequest(data.ID?"update":"create",data);
}
window.saveCalendarEditor=saveCalendarEditor;

async function deleteCalendarEvent(id){
  if(!confirm(`Ștergi evenimentul #${id}?`))return;
  await calendarRequest("delete",{ID:Number(id)});
}
window.deleteCalendarEvent=deleteCalendarEvent;

function renderCalendar(){
  if(!isManagement()){content.innerHTML="";return;}
  pageTitle.textContent="Calendar";
  pageSubtitle.textContent="Evenimente, întâlniri, plăți și comenzi pentru laborator";

  if(!calendarLoaded){
    content.innerHTML='<div class="card panel calendar-loading-state">Caut evenimentele...</div>';
    loadCalendarData(false).then(()=>{if(currentView==="calendar")renderCalendar();}).catch(err=>{if(currentView==="calendar")content.innerHTML=`<div class="card panel error-text">${escapeHtml(err.message)}</div>`;});
    return;
  }

  const monthStart=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1);
  const weekday=(monthStart.getDay()+6)%7; // Monday = 0
  const gridStart=new Date(monthStart);gridStart.setDate(monthStart.getDate()-weekday);
  const monthLabel=monthStart.toLocaleDateString("ro-RO",{month:"long",year:"numeric"});
  const today=calendarIsoDate(new Date());
  const weekdays=["Lun","Mar","Mie","Joi","Vin","Sâm","Dum"];
  const cells=[];
  for(let i=0;i<42;i++){
    const d=new Date(gridStart);d.setDate(gridStart.getDate()+i);
    const ds=calendarIsoDate(d),events=calendarEventsForDay(ds);
    const current=d.getMonth()===monthStart.getMonth();
    cells.push(`<div class="calendar-day ${current?"":"calendar-day-outside"} ${ds===today?"calendar-day-today":""}" ondblclick="openCalendarEditor(null,'${ds}')">
      <div class="calendar-day-head"><button type="button" onclick="openCalendarEditor(null,'${ds}')">${d.getDate()}</button>${events.length?`<span>${events.length}</span>`:""}</div>
      <div class="calendar-events">${events.slice(0,4).map(e=>`<button class="calendar-event ${calendarTypeClass(e.type)} ${e.status==="Finalizat"?"calendar-event-done":""}" type="button" onclick="openCalendarEditor(${e.id})"><span>${e.startTime?escapeHtml(e.startTime)+" · ":""}</span>${escapeHtml(e.title)}</button>`).join("")}${events.length>4?`<div class="calendar-more">+${events.length-4} evenimente</div>`:""}</div>
    </div>`);
  }

  const editor=calendarEditor?`<div class="calendar-editor-backdrop" onclick="if(event.target===this)closeCalendarEditor()"><div class="calendar-editor-card">
    <div class="calendar-editor-head"><div><span>${calendarEditor.id?`Eveniment #${calendarEditor.id}`:"Eveniment nou"}</span><h3>${calendarEditor.id?"Editează eveniment":"Adaugă în calendar"}</h3></div><button class="icon-btn" type="button" onclick="closeCalendarEditor()">×</button></div>
    <input id="calendarEventId" type="hidden" value="${calendarEditor.id||0}">
    <div class="calendar-editor-grid">
      <label class="wide">Titlu<input id="calendarTitle" value="${escapeHtml(calendarEditor.title||"")}" placeholder="Ex. Plată furnizor / Întâlnire Dr. Popescu"></label>
      <label>Tip<select id="calendarType">${optionHtml(CALENDAR_EVENT_TYPES,calendarEditor.type||"Întâlnire",false)}</select></label>
      <label>Status<select id="calendarStatus">${optionHtml(CALENDAR_STATUSES,calendarEditor.status||"Planificat",false)}</select></label>
      <label>Data start<div class="date-input-with-picker"><input id="calendarStartDate" type="date" value="${escapeHtml(calendarEditor.startDate||"")}"><button class="date-picker-btn" type="button" data-date-picker="calendarStartDate">📅</button></div></label>
      <label>Data stop<div class="date-input-with-picker"><input id="calendarEndDate" type="date" value="${escapeHtml(calendarEditor.endDate||calendarEditor.startDate||"")}"><button class="date-picker-btn" type="button" data-date-picker="calendarEndDate">📅</button></div></label>
      <label>Ora<input id="calendarStartTime" type="time" value="${escapeHtml(calendarEditor.startTime||"")}"></label>
      <label class="wide">Detalii<textarea id="calendarDescription" rows="4" placeholder="Detalii, persoană de contact, sumă, observații...">${escapeHtml(calendarEditor.description||"")}</textarea></label>
    </div>
    <div class="calendar-editor-actions">${calendarEditor.id?`<button class="danger-btn" type="button" onclick="deleteCalendarEvent(${calendarEditor.id})">Șterge</button>`:""}<span></span><button class="secondary-btn" type="button" onclick="closeCalendarEditor()">Anulează</button><button class="primary-btn" type="button" onclick="saveCalendarEditor()">Salvează</button></div>
  </div></div>`:"";

  content.innerHTML=`<div class="calendar-toolbar card"><div><button id="calendarPrev" class="secondary-btn" type="button">‹</button><button id="calendarToday" class="secondary-btn" type="button">Azi</button><button id="calendarNext" class="secondary-btn" type="button">›</button></div><h2>${escapeHtml(monthLabel)}</h2><button id="calendarAdd" class="primary-btn" type="button">+ Eveniment</button></div>
  <div class="calendar-board card"><div class="calendar-weekdays">${weekdays.map(x=>`<div>${x}</div>`).join("")}</div><div class="calendar-grid">${cells.join("")}</div></div>${editor}`;

  $("calendarPrev")?.addEventListener("click",()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderCalendar();});
  $("calendarNext")?.addEventListener("click",()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderCalendar();});
  $("calendarToday")?.addEventListener("click",()=>{const n=new Date();calendarMonth=new Date(n.getFullYear(),n.getMonth(),1);renderCalendar();});
  $("calendarAdd")?.addEventListener("click",()=>openCalendarEditor(null,calendarIsoDate(new Date())));
  document.querySelectorAll('[data-date-picker="calendarStartDate"],[data-date-picker="calendarEndDate"]').forEach(btn=>btn.addEventListener("click",()=>openNativeDatePicker($(btn.dataset.datePicker))));
}

function openMaterialEditor(id=null){
  if(!isManagement())return;
  if(id){const m=materialsInventory.find(x=>x.id===Number(id));if(!m)return;materialEditor={...m};}
  else materialEditor={id:0,supplier:"",material:"",um:"buc",quantity:0,minStock:0,lastUpdate:calendarIsoDate(new Date()),notes:""};
  renderMaterials();
}
window.openMaterialEditor=openMaterialEditor;
function closeMaterialEditor(){if(materialSaving)return;materialEditor=null;renderMaterials();}
window.closeMaterialEditor=closeMaterialEditor;

async function materialsRequest(action,data={}){
  showLoading("Materiale","Actualizez stocul...");
  try{
    const result=await fetchJson(API.materials,authPayload({action,data}));
    if(!result?.ok)throw new Error(result?.reply||"Operația pe materiale a eșuat.");
    materialsLoaded=false;materialEditor=null;
    await loadMaterialsData(false);
    if(currentView==="materials")renderMaterials();
    return result;
  }finally{hideLoading();}
}

async function saveMaterialEditor(){
  if(materialSaving)return;

  const data={ID:num($("materialId")?.value),Furnizor:String($("materialSupplier")?.value||"").trim(),Material:String($("materialName")?.value||"").trim(),UM:String($("materialUm")?.value||"").trim(),Cantitate:num($("materialQty")?.value),Prag_Minim:num($("materialMin")?.value),Ultima_Actualizare:$("materialUpdated")?.value||calendarIsoDate(new Date()),Observatii:String($("materialNotes")?.value||"").trim()};
  if(!data.Material||!data.UM){alert("Materialul și unitatea de măsură sunt obligatorii.");return;}

  // Give immediate visual feedback inside the material dialog before
  // waiting for the n8n round-trip.
  materialSaving=true;
  renderMaterials();
  await new Promise(resolve=>requestAnimationFrame(()=>resolve()));

  try{
    await materialsRequest(data.ID?"update":"create",data);
  }catch(err){
    alert(`Materialul nu a putut fi salvat: ${err.message}`);
  }finally{
    materialSaving=false;
    // On success materialsRequest closes the editor. On failure keep it open
    // and restore the controls so the user can retry.
    if(currentView==="materials"&&materialEditor)renderMaterials();
  }
}
window.saveMaterialEditor=saveMaterialEditor;

async function deleteMaterial(id){
  if(!confirm(`Ștergi materialul #${id}?`))return;
  await materialsRequest("delete",{ID:Number(id)});
}
window.deleteMaterial=deleteMaterial;

async function adjustMaterialQuantity(id,delta){
  if(!isManagement())return;
  const m=materialsInventory.find(x=>x.id===Number(id));if(!m)return;
  await materialsRequest("update",{ID:m.id,Furnizor:m.supplier,Material:m.material,UM:m.um,Cantitate:Math.max(0,num(m.quantity)+Number(delta||0)),Prag_Minim:m.minStock,Ultima_Actualizare:calendarIsoDate(new Date()),Observatii:m.notes});
}
window.adjustMaterialQuantity=adjustMaterialQuantity;


function partnershipSetupCard(){
  const configured=supabaseConfigured();
  return `<div class="network-setup-card ${configured?"ready":"pending"}">
    <div>
      <strong>${configured?"Conectare configurată":"Conectare încă neconfigurată"}</strong>
      <span>${configured
        ?"Configurația de browser este prezentă. Auth este conectat; relațiile operaționale se activează după memberships + RLS Storage."
        :"Interfața este pregătită, dar relațiile vor deveni active după configurarea completă a rețelei."}</span>
    </div>
    <span class="network-setup-status">${configured?"CONFIG":"SETUP"}</span>
  </div>`;
}

function networkTabs(items){
  return `<div class="network-tabs">${items.map(item=>`
    <button type="button" class="network-tab ${partnershipTab===item.id?"active":""}" data-network-tab="${item.id}">
      ${escapeHtml(item.label)}
    </button>`).join("")}</div>`;
}

function wireNetworkTabs(){
  document.querySelectorAll("[data-network-tab]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      partnershipTab=btn.dataset.networkTab||"active";
      renderPartnerships();
    });
  });
}

function renderDoctorPartnerships(){
  const tabs=[
    {id:"active",label:"Laboratoarele mele"},
    {id:"discover",label:"Descoperă"},
    {id:"requests",label:"Cereri"}
  ];

  let body="";
  if(partnershipTab==="discover"){
    body=`<div class="network-card">
      <div class="network-card-head">
        <div><strong>Descoperă laboratoare</strong><span>Vor apărea doar laboratoarele cu ofertă Publică sau cele la care ai fost invitat.</span></div>
      </div>
      <div class="network-search-row">
        <input class="filter-input" type="search" placeholder="Caută laborator, oraș, tip lucrare..." disabled>
        <button class="primary-btn" type="button" disabled>Caută</button>
      </div>
      <div class="network-empty">
        <span class="network-empty-icon">⌕</span>
        <strong>Descoperirea laboratoarelor va fi disponibilă după activarea rețelei</strong>
        <p>Oferta publică va fi separată de prețurile contractuale. O ofertă publică nu oferă acces la datele clinicii.</p>
      </div>
    </div>`;
  }else if(partnershipTab==="requests"){
    body=`<div class="network-card">
      <div class="network-card-head"><div><strong>Cereri de colaborare</strong><span>Accept mutual Clinică ↔ Laborator.</span></div></div>
      <div class="network-empty">
        <span class="network-empty-icon">⇄</span>
        <strong>Nicio cerere încă</strong>
        <p>Aici vei putea accepta / respinge invitații și iniția cereri către laboratoare publice.</p>
      </div>
    </div>`;
  }else{
    body=`<div class="network-card">
      <div class="network-card-head"><div><strong>Laboratoarele mele</strong><span>Relațiile Active ale clinicii.</span></div></div>
      <div class="network-empty">
        <span class="network-empty-icon">◇</span>
        <strong>Niciun laborator conectat încă</strong>
        <p>După acceptarea mutuală, aici vor apărea contractul, oferta privată și posibilitatea de a trimite cazuri.</p>
      </div>
    </div>`;
  }

  content.innerHTML=partnershipSetupCard()+networkTabs(tabs)+body;
  wireNetworkTabs();
}

function renderLabPartnerships(){
  const tabs=[
    {id:"active",label:"Clinici active"},
    {id:"requests",label:"Cereri"},
    {id:"offer",label:"Oferta laboratorului"}
  ];

  let body="";
  if(partnershipTab==="requests"){
    body=`<div class="network-card">
      <div class="network-card-head"><div><strong>Cereri de colaborare</strong><span>Clinici care solicită acces sau invitații trimise de laborator.</span></div></div>
      <div class="network-empty">
        <span class="network-empty-icon">⇄</span>
        <strong>Nicio cerere încă</strong>
        <p>Relația devine operațională doar după acceptul ambelor organizații.</p>
      </div>
    </div>`;
  }else if(partnershipTab==="offer"){
    const disabled=supabaseConfigured()?"":"disabled";
    body=`<div class="network-grid">
      <div class="network-card">
        <div class="network-card-head"><div><strong>Vizibilitatea laboratorului</strong><span>Controlează cine poate descoperi oferta.</span></div></div>
        <label class="network-field">Vizibilitate
          <select ${disabled}>
            <option>Publică</option>
            <option>Doar la invitație</option>
            <option>Privată</option>
          </select>
        </label>
        <div class="network-visibility-help">
          <div><strong>Publică</strong><span>Clinicile te pot descoperi și pot vedea oferta publică.</span></div>
          <div><strong>Doar la invitație</strong><span>Doar clinicile invitate pot vedea profilul.</span></div>
          <div><strong>Privată</strong><span>Laboratorul nu apare în discovery.</span></div>
        </div>
      </div>

      <div class="network-card">
        <div class="network-card-head"><div><strong>Profil public</strong><span>Nu include prețurile contractuale negociate.</span></div></div>
        <div class="network-form-grid">
          <label class="network-field">Nume public<input ${disabled} placeholder="Flowrise Dental Lab"></label>
          <label class="network-field">Oraș<input ${disabled} placeholder="București"></label>
          <label class="network-field network-wide">Descriere<textarea ${disabled} rows="4" placeholder="Servicii, tehnologii, timp mediu de execuție..."></textarea></label>
          <label class="network-field network-wide">Notă preț public<textarea ${disabled} rows="3" placeholder="Ex: Coroană zirconiu de la ..."></textarea></label>
        </div>
        <button class="primary-btn" type="button" ${disabled}>Salvează oferta</button>
      </div>
    </div>`;
  }else{
    body=`<div class="network-card">
      <div class="network-card-head"><div><strong>Clinici active</strong><span>Clinicile cu o relație acceptată și activă.</span></div></div>
      <div class="network-empty">
        <span class="network-empty-icon">▦</span>
        <strong>Nicio clinică conectată încă</strong>
        <p>Fiecare clinică poate avea contract, prețuri, status și reguli de colaborare distincte.</p>
      </div>
    </div>`;
  }

  content.innerHTML=partnershipSetupCard()+networkTabs(tabs)+body;
  wireNetworkTabs();
}

function renderPartnerships(){
  if(isTechnician()){
    currentView="workorders";
    render();
    return;
  }

  pageTitle.textContent=isDoctor()?"Laboratoare":"Clinici & colaborări";
  pageSubtitle.textContent=isDoctor()
    ?"Descoperă laboratoare și gestionează colaborările clinicii"
    :"Relații Clinică ↔ Laborator, vizibilitate și ofertă";

  if(isDoctor())renderDoctorPartnerships();
  else renderLabPartnerships();
}

function renderMaterials(){
  pageTitle.textContent="Materiale";
  pageSubtitle.textContent=isManagement()?"Evidență stoc, furnizori și praguri minime":(isTechnician()?"Evidență materiale · poți actualiza cantitatea":"Evidență materiale · vizualizare");
  if(!materialsLoaded){
    content.innerHTML='<div class="card panel calendar-loading-state">Se încarcă materialele...</div>';
    loadMaterialsData(false).then(()=>{if(currentView==="materials")renderMaterials();}).catch(err=>{if(currentView==="materials")content.innerHTML=`<div class="card panel error-text">${escapeHtml(err.message)}</div>`;});
    return;
  }

  const q=normalize(materialsSearch);
  let rows=materialsInventory.filter(m=>!q||normalize([m.supplier,m.material,m.um,m.notes].join(" ")).includes(q));
  rows=applyViewDateRanges(rows,"materials").sort((a,b)=>a.material.localeCompare(b.material,undefined,{sensitivity:"base"}));
  const low=rows.filter(m=>m.minStock>0&&m.quantity<=m.minStock).length;
  const dateBar=dateRangeFilterBar("materials",[{field:"lastUpdate",label:"Ultima actualizare"}]);

  const editor=materialEditor?`<div class="calendar-editor-backdrop" onclick="if(event.target===this&&!materialSaving)closeMaterialEditor()"><div class="calendar-editor-card material-editor-card ${materialSaving?"material-editor-is-saving":""}">
    ${materialSaving?`<div class="material-save-overlay"><span class="spinner"></span><strong>${materialEditor.id?"Se salvează modificările...":"Se adaugă materialul..."}</strong><small>Mai durează doar puțin...</small></div>`:""}
    <div class="calendar-editor-head"><div><span>${materialEditor.id?`Material #${materialEditor.id}`:"Material nou"}</span><h3>${materialEditor.id?"Editează material":"Adaugă material"}</h3></div><button class="icon-btn" type="button" onclick="closeMaterialEditor()" ${materialSaving?"disabled":""}>×</button></div><input id="materialId" type="hidden" value="${materialEditor.id||0}"><div class="calendar-editor-grid"><label>Furnizor<input id="materialSupplier" value="${escapeHtml(materialEditor.supplier||"")}" ${materialSaving?"disabled":""}></label><label>Material<input id="materialName" value="${escapeHtml(materialEditor.material||"")}" ${materialSaving?"disabled":""}></label><label>UM<input id="materialUm" list="materialUmList" value="${escapeHtml(materialEditor.um||"")}" ${materialSaving?"disabled":""}><datalist id="materialUmList">${MATERIAL_UM.map(x=>`<option value="${escapeHtml(x)}"></option>`).join("")}</datalist></label><label>Cantitate<input id="materialQty" type="number" min="0" step="0.01" value="${materialEditor.quantity}" ${materialSaving?"disabled":""}></label><label>Prag minim<input id="materialMin" type="number" min="0" step="0.01" value="${materialEditor.minStock}" ${materialSaving?"disabled":""}></label><label>Ultima actualizare<div class="date-input-with-picker"><input id="materialUpdated" type="date" value="${escapeHtml(materialEditor.lastUpdate||"")}" ${materialSaving?"disabled":""}><button class="date-picker-btn" type="button" data-date-picker="materialUpdated" ${materialSaving?"disabled":""}>📅</button></div></label><label class="wide">Observații<textarea id="materialNotes" rows="4" ${materialSaving?"disabled":""}>${escapeHtml(materialEditor.notes||"")}</textarea></label></div><div class="calendar-editor-actions">${materialEditor.id?`<button class="danger-btn" type="button" onclick="deleteMaterial(${materialEditor.id})" ${materialSaving?"disabled":""}>Șterge</button>`:""}<span></span><button class="secondary-btn" type="button" onclick="closeMaterialEditor()" ${materialSaving?"disabled":""}>Anulează</button><button class="primary-btn material-save-btn" type="button" onclick="saveMaterialEditor()" ${materialSaving?"disabled":""}>${materialSaving?'<span class="inline-spinner"></span> Se salvează...':"Salvează"}</button></div></div></div>`:"";

  content.innerHTML=`${dateBar}<div class="materials-toolbar card"><div><strong>Stoc materiale</strong><span>${rows.length} poziții · ${low} stoc scăzut</span></div><div class="materials-toolbar-actions"><input id="materialsSearch" class="filter-input" value="${escapeHtml(materialsSearch)}" placeholder="Caută furnizor, material, UM..."><button id="materialsClearSearch" class="secondary-btn" type="button">Resetează</button>${isManagement()?'<button id="materialAdd" class="primary-btn" type="button">+ Material</button>':""}</div></div><div class="card panel"><div class="table-wrap"><table class="materials-table"><thead><tr><th>Furnizor</th><th>Material</th><th>UM</th><th>Cantitate</th><th>Prag minim</th><th>Ultima actualizare</th><th>Observații</th>${isManagement()?"<th>Acțiuni</th>":""}</tr></thead><tbody>${rows.length?rows.map(m=>{const lowStock=m.minStock>0&&m.quantity<=m.minStock;return `<tr class="${lowStock?"material-low-stock":""}"><td>${escapeHtml(m.supplier)||"—"}</td><td><strong>${escapeHtml(m.material)||"—"}</strong>${lowStock?'<span class="low-stock-badge">STOC SCĂZUT</span>':""}</td><td>${escapeHtml(m.um)||"—"}</td><td><div class="material-qty-control">${(isManagement()||isTechnician())?`<button type="button" onclick="adjustMaterialQuantity(${m.id},-1)" ${m.quantity<1?"disabled":""}>−</button>`:""}<strong>${m.quantity}</strong>${(isManagement()||isTechnician())?`<button type="button" onclick="adjustMaterialQuantity(${m.id},1)">+</button>`:""}</div></td><td>${m.minStock||"—"}</td><td>${fmtDate(m.lastUpdate)}</td><td class="material-notes">${escapeHtml(m.notes)||"—"}</td>${isManagement()?`<td><div class="row-actions"><button class="edit-btn" type="button" onclick="openMaterialEditor(${m.id})">Editează</button><button class="danger-btn" type="button" onclick="deleteMaterial(${m.id})">Șterge</button></div></td>`:""}</tr>`;}).join(""):`<tr><td colspan="${isManagement()?8:7}">Nu există materiale.</td></tr>`}</tbody></table></div></div>${editor}`;

  $("materialsSearch")?.addEventListener("input",e=>{materialsSearch=e.target.value;renderMaterials();const n=$("materialsSearch");if(n){n.focus();n.selectionStart=n.selectionEnd=n.value.length;}});
  $("materialsClearSearch")?.addEventListener("click",()=>{materialsSearch="";clearViewDateRange("materials");renderMaterials();});
  $("materialAdd")?.addEventListener("click",()=>openMaterialEditor());
  wireDateRangeFilters("materials",renderMaterials);
  document.querySelectorAll('[data-date-picker="materialUpdated"]').forEach(btn=>btn.addEventListener("click",()=>openNativeDatePicker($(btn.dataset.datePicker))));
}

async function adminConfigRequest(entity,action,data={}){
  if(!isAdmin())throw new Error("Admin access required");
  showLoading("Salvez configurarea","Pun modificările la locul lor...");
  try{
    const result=await fetchJson(API.adminConfig,authPayload({entity,action,data}));
    if(!result?.ok)throw new Error(result?.reply||"Admin configuration update failed");
    await loadAll(false);
    currentView="adminconfig";
    renderAdminConfig();
    return result;
  }finally{
    hideLoading();
  }
}

function adminInput(id,value,type="text",extra=""){
  return `<input id="${id}" type="${type}" value="${escapeHtml(value??"")}" ${extra}>`;
}

function renderAdminConfig(){
  if(!isAdmin()){content.innerHTML="";return;}
  pageTitle.textContent="Configurare admin";
  pageSubtitle.textContent="Configurare pentru prețuri, tipuri de lucrări, costuri și utilizatori";

  const active=v=>!["false","0","no","inactive","disabled"].includes(String(v??"").toLowerCase());
  const q=normalize(adminConfigSearch);
  const allPrices=[...adminConfigData.prices].sort((a,b)=>String(a.Contract??"").localeCompare(String(b.Contract??""))||String(a.Tip_Lucrare??"").localeCompare(String(b.Tip_Lucrare??"")));
  const allCosts=[...adminConfigData.technicianCosts].sort((a,b)=>String(a.Tehnician??"").localeCompare(String(b.Tehnician??""))||String(a.Tip_Lucrare??"").localeCompare(String(b.Tip_Lucrare??""))||String(a.Etapa??"").localeCompare(String(b.Etapa??"")));
  const allTypes=[...adminConfigData.workTypes].sort((a,b)=>String(a.Tip_Lucrare??"").localeCompare(String(b.Tip_Lucrare??"")));
  const allUsers=[...adminConfigData.users].sort((a,b)=>String(a.Name??a.User_ID??"").localeCompare(String(b.Name??b.User_ID??""),undefined,{sensitivity:"base"}));
  const roleNames=(Array.isArray(adminConfigData.roles)&&adminConfigData.roles.length
    ? adminConfigData.roles
    : ["Admin","Manager","Technician","Doctor"]);
  const workTypeNames=[...new Set(allTypes.map(x=>String(x.Tip_Lucrare??"").trim()).filter(Boolean))];
  const contracts=[...new Set(allPrices.map(x=>String(x.Contract??"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const visibleContracts=contracts.filter(c=>!q||normalize(c).includes(q)||allPrices.some(r=>String(r.Contract??"")===c&&normalize(r.Tip_Lucrare).includes(q)));
  if(!selectedAdminContract||!contracts.includes(selectedAdminContract))selectedAdminContract=visibleContracts[0]||contracts[0]||"";

  const costTechnicians=[...new Set(["Robert","Gabi","Denis",...allCosts.map(r=>String(r.Tehnician??"").trim()).filter(Boolean)])].sort((a,b)=>a.localeCompare(b));
  const visibleCostTechnicians=costTechnicians.filter(t=>!q||normalize(t).includes(q)||allCosts.some(r=>String(r.Tehnician??"")===t&&normalize([r.Tip_Lucrare,r.Etapa,r.Cost].join(" ")).includes(q)));
  if(!selectedAdminTechnician||!costTechnicians.includes(selectedAdminTechnician))selectedAdminTechnician=visibleCostTechnicians[0]||costTechnicians[0]||"";

  const visibleUsers=allUsers.filter(u=>!q||normalize([
    u.User_ID,u.Username,u.Name,u.Email,u.Role,u.Technician_Name,u.Partner_Name,u.Active
  ].join(" ")).includes(q));
  if(!selectedAdminUser||!allUsers.some(u=>String(u.User_ID)===String(selectedAdminUser))){
    selectedAdminUser=visibleUsers[0]?.User_ID||allUsers[0]?.User_ID||"";
  }

  const tabs=`<div class="admin-config-tabs"><button class="${adminConfigTab==="prices"?"active":""}" data-admin-tab="prices">Contracte & Prețuri</button><button class="${adminConfigTab==="types"?"active":""}" data-admin-tab="types">Tipuri lucrări</button><button class="${adminConfigTab==="costs"?"active":""}" data-admin-tab="costs">Costuri tehnicieni</button><button class="${adminConfigTab==="users"?"active":""}" data-admin-tab="users">Utilizatori</button></div>`;
  const search=`<div class="admin-config-search"><input id="adminConfigSearch" class="filter-input" value="${escapeHtml(adminConfigSearch)}" placeholder="Caută în secțiunea curentă..."><button id="adminConfigClearSearch" class="secondary-btn" type="button">×</button></div>`;
  const datalist=`<datalist id="adminWorkTypeList">${workTypeNames.map(x=>`<option value="${escapeHtml(x)}"></option>`).join("")}</datalist>`;

  let body="";
  if(adminConfigTab==="prices"){
    const rows=allPrices.filter(r=>String(r.Contract??"")===selectedAdminContract&&(!q||normalize([r.Contract,r.Tip_Lucrare,r.Pret].join(" ")).includes(q)));
    body=`<div class="admin-contract-workspace"><aside class="admin-contract-list"><div class="admin-pane-title"><strong>Contracte</strong><span>${contracts.length}</span></div><div class="admin-contract-items">${visibleContracts.length?visibleContracts.map(c=>`<button type="button" class="${c===selectedAdminContract?"active":""}" data-admin-contract="${escapeHtml(c)}"><span>${escapeHtml(c)}</span><small>${allPrices.filter(r=>String(r.Contract??"")===c).length} prețuri</small></button>`).join(""):'<div class="admin-empty-small">Niciun contract</div>'}</div></aside><section class="admin-contract-detail"><div class="admin-section-head"><div><h3>${escapeHtml(selectedAdminContract||"Contract nou")}</h3><p>Selectează un contract în stânga; modifică doar rândul de care ai nevoie.</p></div>${selectedAdminContract?`<div class="admin-group-actions"><button class="secondary-btn admin-duplicate-group-btn" type="button" onclick="adminDuplicateSelectedContract()">Duplică contractul</button><button class="danger-btn" type="button" onclick="adminDeleteSelectedContract()">Șterge contract</button></div>`:""}</div><div class="admin-create-card compact"><div class="admin-create-title">+ Adaugă preț</div><div class="admin-add-grid"><label>Contract ${adminInput("newPriceContract",selectedAdminContract)}</label><label>Tip lucrare<input id="newPriceWorkType" list="adminWorkTypeList" placeholder="Tip lucrare"></label><label>Preț / element ${adminInput("newPriceValue","0","number",'min="0" step="0.01"')}</label><button class="primary-btn" type="button" onclick="adminCreatePrice()">Adaugă</button></div></div><div class="table-wrap admin-config-table"><table><thead><tr><th>Tip lucrare</th><th>Preț</th><th>Acțiuni</th></tr></thead><tbody>${rows.length?rows.map(r=>{const id=Number(r.ID);return `<tr><td><input id="priceWorkType${id}" list="adminWorkTypeList" value="${escapeHtml(r.Tip_Lucrare??"")}"><input id="priceContract${id}" type="hidden" value="${escapeHtml(r.Contract??"")}"></td><td>${adminInput(`priceValue${id}`,r.Pret,"number",'min="0" step="0.01"')}</td><td class="admin-row-actions"><button class="edit-btn" type="button" onclick="adminSavePrice(${id})">Salvează</button><button class="danger-btn" type="button" onclick="adminDeletePrice(${id})">Șterge</button></td></tr>`;}).join(""):'<tr><td colspan="3">Nu există prețuri pentru contractul selectat.</td></tr>'}</tbody></table></div></section></div>`;
  }else if(adminConfigTab==="types"){
    const rows=allTypes.filter(r=>!q||normalize([r.Tip_Lucrare,r.Active].join(" ")).includes(q));
    body=`<section class="card panel admin-config-section"><div class="admin-section-head"><div><h3>Tipuri lucrări</h3><p>Lista folosită în formularul de lucrare.</p></div><span class="table-count">${rows.length} rânduri</span></div><div class="admin-create-card compact"><div class="admin-add-grid admin-worktype-add"><label>Tip lucrare ${adminInput("newWorkTypeName","")}</label><label class="admin-checkbox-label"><input id="newWorkTypeActive" type="checkbox" checked> Activ</label><button class="primary-btn" type="button" onclick="adminCreateWorkType()">+ Adaugă</button></div></div><div class="table-wrap admin-config-table"><table><thead><tr><th>Tip lucrare</th><th>Activ</th><th>Acțiuni</th></tr></thead><tbody>${rows.length?rows.map(r=>{const id=Number(r.ID);return `<tr><td>${adminInput(`workTypeName${id}`,r.Tip_Lucrare)}</td><td><input id="workTypeActive${id}" type="checkbox" ${active(r.Active)?"checked":""}></td><td class="admin-row-actions"><button class="edit-btn" type="button" onclick="adminSaveWorkType(${id})">Salvează</button><button class="danger-btn" type="button" onclick="adminDeleteWorkType(${id})">Șterge</button></td></tr>`;}).join(""):'<tr><td colspan="3">Niciun tip de lucrare.</td></tr>'}</tbody></table></div></section>`;
  }else if(adminConfigTab==="costs"){
    const rows=allCosts.filter(r=>String(r.Tehnician??"")===selectedAdminTechnician&&(!q||normalize([r.Tehnician,r.Tip_Lucrare,r.Etapa,r.Cost].join(" ")).includes(q)));
    body=`<div class="admin-contract-workspace admin-technician-workspace">
      <aside class="admin-contract-list admin-technician-list">
        <div class="admin-pane-title"><strong>Tehnicieni</strong><span>${costTechnicians.length}</span></div>
        <div class="admin-contract-items">
          ${visibleCostTechnicians.length?visibleCostTechnicians.map(t=>`<button type="button" class="${t===selectedAdminTechnician?"active":""}" data-admin-technician="${escapeHtml(t)}"><span>${escapeHtml(t)}</span><small>${allCosts.filter(r=>String(r.Tehnician??"")===t).length} costuri</small></button>`).join(""):'<div class="admin-empty-small">Niciun tehnician</div>'}
        </div>
      </aside>
      <section class="admin-contract-detail">
        <div class="admin-section-head">
          <div><h3>${escapeHtml(selectedAdminTechnician||"Tehnician")}</h3><p>Cost / element după tip lucrare + etapă. Selectează tehnicianul din stânga.</p></div>
          <div class="admin-group-actions">
            <span class="table-count">${rows.length} rânduri</span>
            ${selectedAdminTechnician?`<button class="secondary-btn admin-duplicate-group-btn" type="button" onclick="adminDuplicateSelectedTechnician()">Duplică tehnicianul</button>`:""}
          </div>
        </div>
        <div class="admin-create-card compact">
          <div class="admin-create-title">+ Adaugă cost</div>
          <div class="admin-add-grid admin-cost-add">
            <label>Tehnician<select id="newCostTech">${optionHtml(costTechnicians,selectedAdminTechnician,false)}</select></label>
            <label>Tip lucrare<input id="newCostWorkType" list="adminWorkTypeList" placeholder="Tip lucrare"></label>
            <label>Etapă<select id="newCostStage">${optionHtml(["Model","Modelare","Cer_Fin"],"",true)}</select></label>
            <label>Cost / element ${adminInput("newCostValue","0","number",'min="0" step="0.01"')}</label>
            <button class="primary-btn" type="button" onclick="adminCreateCost()">+ Adaugă</button>
          </div>
        </div>
        <div class="table-wrap admin-config-table">
          <table>
            <thead><tr><th>Tip lucrare</th><th>Etapă</th><th>Cost</th><th>Acțiuni</th></tr></thead>
            <tbody>${rows.length?rows.map(r=>{const id=Number(r.ID);return `<tr>
              <td><input id="costWorkType${id}" list="adminWorkTypeList" value="${escapeHtml(r.Tip_Lucrare??"")}"><input id="costTech${id}" type="hidden" value="${escapeHtml(r.Tehnician??"")}"></td>
              <td><select id="costStage${id}">${optionHtml(["Model","Modelare","Cer_Fin"],String(r.Etapa??""),false)}</select></td>
              <td>${adminInput(`costValue${id}`,r.Cost,"number",'min="0" step="0.01"')}</td>
              <td class="admin-row-actions"><button class="edit-btn" type="button" onclick="adminSaveCost(${id})">Salvează</button><button class="danger-btn" type="button" onclick="adminDeleteCost(${id})">Șterge</button></td>
            </tr>`;}).join(""):'<tr><td colspan="4">Nu există costuri pentru tehnicianul selectat.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    </div>`;
  }else if(adminConfigTab==="users"){
    const selected=allUsers.find(u=>String(u.User_ID)===String(selectedAdminUser))||null;

    const userList=visibleUsers.length
      ? visibleUsers.map(u=>`<button type="button" class="${String(u.User_ID)===String(selectedAdminUser)?"active":""}" data-admin-user="${escapeHtml(u.User_ID)}">
          <span>${escapeHtml(u.Name||u.User_ID)}</span>
          <small>@${escapeHtml(u.Username||u.User_ID)} · ${escapeHtml(u.Role||"—")}${u.Active===false||String(u.Active).toLowerCase()==="false"?" · inactiv":""}</small>
        </button>`).join("")
      : '<div class="admin-empty-small">Niciun utilizator</div>';

    const selectedDetail=selected?`
      <div class="admin-section-head">
        <div>
          <h3>${escapeHtml(selected.Name||selected.User_ID)}</h3>
          <p>Username: <strong>@${escapeHtml(selected.Username||selected.User_ID)}</strong> · ID intern: <strong>${escapeHtml(selected.User_ID)}</strong></p>
        </div>
        <div class="admin-group-actions">
          <span class="admin-user-role-badge">${escapeHtml(selected.Role||"—")}</span>
          <button class="danger-btn" type="button" onclick="adminDeleteUser('${escapeHtml(selected.User_ID)}')">Șterge utilizator</button>
        </div>
      </div>

      <div class="admin-user-editor-grid">
        <label>ID intern
          <input id="editUserId" value="${escapeHtml(selected.User_ID)}" readonly>
          <small>Identificator intern păstrat pentru compatibilitate.</small>
        </label>
        <label>Username (login)
          <input id="editUsername" value="${escapeHtml(selected.Username||selected.User_ID)}" autocomplete="username" placeholder="ex. doctor_leustean">
          <small>3–40 caractere: litere mici, cifre și _</small>
        </label>
        <label>Nume
          <input id="editUserName" value="${escapeHtml(selected.Name||"")}">
        </label>
        <label>Email
          <input id="editUserEmail" type="email" value="${escapeHtml(selected.Email||"")}">
        </label>
        <label>Rol
          <select id="editUserRole">${optionHtml(roleNames,selected.Role||"",false)}</select>
        </label>
        <label>Technician Name
          <input id="editUserTechnician" list="adminUserTechnicianList" value="${escapeHtml(selected.Technician_Name||"")}" placeholder="Ex. Robert">
        </label>
        <label>Partner Name
          <input id="editUserPartner" value="${escapeHtml(selected.Partner_Name||"")}" placeholder="Clinică / partener pentru Doctor">
        </label>
        <label class="admin-user-password-field">Parolă nouă
          <input id="editUserPassword" type="password" autocomplete="new-password" placeholder="${selected.Has_Password?"Lasă gol pentru a păstra parola":"Setează o parolă"}">
          <small>${selected.Has_Password?"Parola este deja setată.":"Utilizatorul nu are parolă setată."}</small>
        </label>
        <label class="admin-checkbox-label admin-user-active">
          <input id="editUserActive" type="checkbox" ${active(selected.Active)?"checked":""}> Activ
        </label>
      </div>

      <div class="admin-user-editor-actions">
        <button class="primary-btn" type="button" onclick="adminSaveUser('${escapeHtml(selected.User_ID)}')">Salvează utilizator</button>
      </div>
    `:'<div class="admin-empty-small admin-user-empty-detail">Selectează sau adaugă un utilizator.</div>';

    body=`<div class="admin-contract-workspace admin-users-workspace">
      <aside class="admin-contract-list admin-users-list">
        <div class="admin-pane-title"><strong>Utilizatori</strong><span>${allUsers.length}</span></div>
        <div class="admin-contract-items">${userList}</div>
      </aside>

      <section class="admin-contract-detail admin-users-detail">
        <section class="admin-data-cleanup-card">
          <div class="admin-section-head">
            <div>
              <h3>Curățare conversații</h3>
              <p>Acțiuni permanente pentru toate conversațiile laboratorului mai vechi de 30 de zile.</p>
            </div>
            <span class="admin-cleanup-warning">Nu se pot recupera</span>
          </div>
          <div class="admin-cleanup-actions">
            <button class="danger-btn" type="button" onclick="adminClearAiHistoryOlderThan30()">Șterge istoricul AI &gt;30 zile</button>
            <button class="danger-btn" type="button" onclick="adminClearHumanChatOlderThan30()">Șterge chatul &gt;30 zile</button>
          </div>
          <small>Prima acțiune curăță istoricul conversațiilor cu AI. A doua curăță mesajele din chatul intern și atașamentele asociate.</small>
        </section>
        <div class="admin-create-card compact admin-user-create-card">
          <div class="admin-create-title">+ Adaugă utilizator</div>
          <div class="admin-user-create-grid">
            <label>ID intern<input id="newUserId" placeholder="ex. dr_leustean"></label>
            <label>Username (login)<input id="newUsername" autocomplete="username" placeholder="ex. doctor_leustean"></label>
            <label>Nume<input id="newUserName" placeholder="Nume utilizator"></label>
            <label>Email<input id="newUserEmail" type="email" placeholder="email@exemplu.ro"></label>
            <label>Rol<select id="newUserRole">${optionHtml(roleNames,"",true)}</select></label>
            <label>Technician Name<input id="newUserTechnician" list="adminUserTechnicianList" placeholder="opțional"></label>
            <label>Partner Name<input id="newUserPartner" placeholder="opțional / clinică Doctor"></label>
            <label>Parolă<input id="newUserPassword" type="password" autocomplete="new-password" placeholder="Parolă inițială"></label>
            <label class="admin-checkbox-label"><input id="newUserActive" type="checkbox" checked> Activ</label>
            <button class="primary-btn" type="button" onclick="adminCreateUser()">+ Adaugă</button>
          </div>
        </div>

        <datalist id="adminUserTechnicianList">${[...new Set(["Robert","Gabi","Denis",...costTechnicians])].map(x=>`<option value="${escapeHtml(x)}"></option>`).join("")}</datalist>
        ${selectedDetail}
      </section>
    </div>`;
  }

  content.innerHTML=`<div class="admin-config-shell">${tabs}<div class="admin-config-toolbar">${search}</div>${datalist}${body}</div>`;
  document.querySelectorAll("[data-admin-tab]").forEach(btn=>btn.addEventListener("click",()=>{adminConfigTab=btn.dataset.adminTab;adminConfigSearch="";renderAdminConfig();}));
  $("adminConfigSearch")?.addEventListener("input",e=>{adminConfigSearch=e.target.value;renderAdminConfig();const n=$("adminConfigSearch");if(n){n.focus();n.selectionStart=n.selectionEnd=n.value.length;}});
  $("adminConfigClearSearch")?.addEventListener("click",()=>{adminConfigSearch="";renderAdminConfig();});
  document.querySelectorAll("[data-admin-contract]").forEach(btn=>btn.addEventListener("click",()=>{selectedAdminContract=btn.dataset.adminContract;renderAdminConfig();}));
  document.querySelectorAll("[data-admin-technician]").forEach(btn=>btn.addEventListener("click",()=>{selectedAdminTechnician=btn.dataset.adminTechnician;renderAdminConfig();}));
  document.querySelectorAll("[data-admin-user]").forEach(btn=>btn.addEventListener("click",()=>{selectedAdminUser=btn.dataset.adminUser;renderAdminConfig();}));
}


function adminDeleteSelectedContract(){
  if(!selectedAdminContract)return;
  const select=document.createElement("select");
  select.id="deleteContractSelect";
  select.innerHTML=`<option value="${escapeHtml(selectedAdminContract)}">${escapeHtml(selectedAdminContract)}</option>`;
  document.body.appendChild(select);
  adminDeleteContract().finally(()=>select.remove());
}
window.adminDeleteSelectedContract=adminDeleteSelectedContract;

async function adminClearAiHistoryOlderThan30(){
  if(!isAdmin())return;
  if(!confirm("Ștergi definitiv toate conversațiile cu AI mai vechi de 30 de zile pentru toți utilizatorii?"))return;
  showLoading("Curățare istoric AI","Șterg conversațiile vechi...");
  try{
    const labId=await resolveLabOrganizationId();
    const result=await sbRpc("admin_clear_ai_history_older_than_30_days",{
      p_lab_organization_id:labId,
      p_days:30
    });
    const count=Number(result?.deleted_messages??result?.deleted_rows??result?.count??0);
    setConnection(true,`Istoric AI curățat · ${count} mesaje`);
    alert(`Curățarea istoricului AI s-a încheiat. Au fost eliminate ${count} mesaje mai vechi de 30 de zile.`);
  }catch(err){
    alert(`Istoricul AI nu a putut fi curățat: ${err.message}`);
  }finally{hideLoading();}
}
window.adminClearAiHistoryOlderThan30=adminClearAiHistoryOlderThan30;

async function adminClearHumanChatOlderThan30(){
  if(!isAdmin())return;
  if(!confirm("Ștergi definitiv mesajele și atașamentele din chat mai vechi de 30 de zile pentru toți utilizatorii?"))return;
  showLoading("Curățare chat","Șterg mesajele și atașamentele vechi...");
  try{
    const labId=await resolveLabOrganizationId();
    const result=await sbRpc("admin_clear_chat_messages_older_than_30_days",{
      p_lab_organization_id:labId,
      p_days:30
    });
    const count=Number(result?.deleted_messages??result?.deleted_rows??result?.count??0);
    const files=Number(result?.deleted_files??result?.deleted_attachments??0);
    setConnection(true,`Chat curățat · ${count} mesaje`);
    alert(`Curățarea chatului s-a încheiat. Au fost eliminate ${count} mesaje${files?` și ${files} atașamente`:""} mai vechi de 30 de zile.`);
  }catch(err){
    alert(`Chatul nu a putut fi curățat: ${err.message}`);
  }finally{hideLoading();}
}
window.adminClearHumanChatOlderThan30=adminClearHumanChatOlderThan30;


async function adminCreateManyRows(rows,title,entityLabel){
  if(!isAdmin())throw new Error("Admin access required");
  if(!Array.isArray(rows)||!rows.length)return;

  showLoading(title,`Pregătesc ${rows.length} ${entityLabel}...`);
  let created=0;

  try{
    for(const item of rows){
      const text=$("flowLoadingText");
      if(text)text.textContent=`${created+1}/${rows.length} · ${entityLabel}`;

      const result=await fetchJson(
        API.adminConfig,
        authPayload({
          entity:item.entity,
          action:"create",
          data:item.data
        })
      );

      if(!result?.ok){
        throw new Error(result?.reply||`Nu s-a putut crea rândul ${created+1}.`);
      }
      created++;
    }

    await loadAll(false);
    currentView="adminconfig";
    renderAdminConfig();
    return created;
  }catch(err){
    // Some rows may already have been created before a later request failed.
    // Refresh so the UI always reflects the actual Data Table state.
    try{
      await loadAll(false);
      currentView="adminconfig";
      renderAdminConfig();
    }catch(_refreshErr){}

    throw new Error(
      created>0
        ? `${created} din ${rows.length} rânduri au fost duplicate înainte de eroare. ${err.message}`
        : err.message
    );
  }finally{
    hideLoading();
  }
}

async function adminDuplicateSelectedContract(){
  const source=String(selectedAdminContract||"").trim();
  if(!source)return;

  const sourceRows=adminConfigData.prices.filter(
    r=>String(r.Contract??"").trim()===source
  );

  if(!sourceRows.length){
    alert("Contractul selectat nu are prețuri de duplicat.");
    return;
  }

  const suggested=`${source} Copie`;
  const targetRaw=window.prompt(
    `Numele noului contract.\n\nVor fi copiate toate cele ${sourceRows.length} prețuri din "${source}".`,
    suggested
  );
  if(targetRaw===null)return;

  const target=String(targetRaw||"").trim();
  if(!target){
    alert("Numele noului contract este obligatoriu.");
    return;
  }

  if(normalize(target)===normalize(source)){
    alert("Noul contract trebuie să aibă un nume diferit.");
    return;
  }

  const existingCount=adminConfigData.prices.filter(
    r=>normalize(r.Contract)===normalize(target)
  ).length;

  const warning=existingCount
    ? `\n\nExistă deja ${existingCount} prețuri pentru "${target}". Noile rânduri vor fi adăugate peste cele existente.`
    : "";

  if(!confirm(
    `Duplici contractul "${source}" ca "${target}"?\n\nSe vor crea ${sourceRows.length} rânduri noi.${warning}`
  ))return;

  try{
    const rows=sourceRows.map(r=>({
      entity:"price",
      data:{
        Contract:target,
        Tip_Lucrare:String(r.Tip_Lucrare??"").trim(),
        Pret:Number(r.Pret)||0
      }
    }));

    await adminCreateManyRows(rows,"Duplicare contract",`prețuri pentru ${target}`);
    selectedAdminContract=target;
    renderAdminConfig();
    setConnection(true,`Contract duplicat · ${source} → ${target}`);
  }catch(err){
    alert(`Duplicarea contractului a eșuat: ${err.message}`);
  }
}
window.adminDuplicateSelectedContract=adminDuplicateSelectedContract;

async function adminDuplicateSelectedTechnician(){
  const source=String(selectedAdminTechnician||"").trim();
  if(!source)return;

  const sourceRows=adminConfigData.technicianCosts.filter(
    r=>String(r.Tehnician??"").trim()===source
  );

  if(!sourceRows.length){
    alert("Tehnicianul selectat nu are costuri de duplicat.");
    return;
  }

  const suggested=`${source} Copie`;
  const targetRaw=window.prompt(
    `Numele tehnicianului destinație.\n\nVor fi copiate toate cele ${sourceRows.length} costuri din profilul lui "${source}".`,
    suggested
  );
  if(targetRaw===null)return;

  const target=String(targetRaw||"").trim();
  if(!target){
    alert("Numele tehnicianului este obligatoriu.");
    return;
  }

  if(normalize(target)===normalize(source)){
    alert("Tehnicianul destinație trebuie să aibă un nume diferit.");
    return;
  }

  const existingCount=adminConfigData.technicianCosts.filter(
    r=>normalize(r.Tehnician)===normalize(target)
  ).length;

  const warning=existingCount
    ? `\n\nExistă deja ${existingCount} costuri pentru "${target}". Noile rânduri vor fi adăugate peste cele existente.`
    : "";

  if(!confirm(
    `Duplici profilul de costuri "${source}" ca "${target}"?\n\nSe vor crea ${sourceRows.length} rânduri noi.${warning}`
  ))return;

  try{
    const rows=sourceRows.map(r=>({
      entity:"cost",
      data:{
        Tehnician:target,
        Tip_Lucrare:String(r.Tip_Lucrare??"").trim(),
        Etapa:String(r.Etapa??"").trim(),
        Cost:Number(r.Cost)||0
      }
    }));

    await adminCreateManyRows(rows,"Duplicare tehnician",`costuri pentru ${target}`);
    selectedAdminTechnician=target;
    renderAdminConfig();
    setConnection(true,`Costuri duplicate · ${source} → ${target}`);
  }catch(err){
    alert(`Duplicarea tehnicianului a eșuat: ${err.message}`);
  }
}
window.adminDuplicateSelectedTechnician=adminDuplicateSelectedTechnician;


async function adminCreateUser(){
  const data={
    User_ID:String($("newUserId")?.value||"").trim(),
    Username:String($("newUsername")?.value||"").trim().toLowerCase(),
    Name:String($("newUserName")?.value||"").trim(),
    Email:String($("newUserEmail")?.value||"").trim(),
    Role:String($("newUserRole")?.value||"").trim(),
    Technician_Name:String($("newUserTechnician")?.value||"").trim(),
    Partner_Name:String($("newUserPartner")?.value||"").trim(),
    Password:String($("newUserPassword")?.value||""),
    Active:Boolean($("newUserActive")?.checked)
  };

  if(!data.User_ID||!data.Username||!data.Name||!data.Role||!data.Password){
    alert("ID intern, Username, Nume, Rol și Parolă sunt obligatorii.");
    return;
  }
  if(!/^[a-z0-9_]{3,40}$/.test(data.Username)){
    alert("Username-ul trebuie să aibă 3–40 caractere și să conțină doar litere mici, cifre sau _.");
    return;
  }

  try{
    await adminConfigRequest("user","create",data);
    selectedAdminUser=data.User_ID;
    renderAdminConfig();
  }catch(err){
    alert(`Nu am putut adăuga utilizatorul: ${err.message}`);
  }
}
window.adminCreateUser=adminCreateUser;

async function adminSaveUser(userId){
  const existing=adminConfigData.users.find(x=>String(x.User_ID)===String(userId));
  const data={
    User_ID:String(userId||"").trim(),
    Supabase_User_ID:String(existing?.Supabase_User_ID||"").trim(),
    Username:String($("editUsername")?.value||"").trim().toLowerCase(),
    Name:String($("editUserName")?.value||"").trim(),
    Email:String($("editUserEmail")?.value||"").trim(),
    Role:String($("editUserRole")?.value||"").trim(),
    Technician_Name:String($("editUserTechnician")?.value||"").trim(),
    Partner_Name:String($("editUserPartner")?.value||"").trim(),
    Password:String($("editUserPassword")?.value||""),
    Active:Boolean($("editUserActive")?.checked)
  };

  if(!data.User_ID||!data.Username||!data.Name||!data.Role){
    alert("ID intern, Username, Nume și Rol sunt obligatorii.");
    return;
  }
  if(!/^[a-z0-9_]{3,40}$/.test(data.Username)){
    alert("Username-ul trebuie să aibă 3–40 caractere și să conțină doar litere mici, cifre sau _.");
    return;
  }

  try{
    await adminConfigRequest("user","update",data);
    selectedAdminUser=data.User_ID;
    renderAdminConfig();
  }catch(err){
    alert(`Nu am putut salva utilizatorul: ${err.message}`);
  }
}
window.adminSaveUser=adminSaveUser;

async function adminDeleteUser(userId){
  const id=String(userId||"").trim();
  if(!id)return;
  const u=adminConfigData.users.find(x=>String(x.User_ID)===id);
  if(!confirm(`Ștergi utilizatorul "${u?.Name||id}" (${id})?\n\nAceastă acțiune este permanentă.`))return;

  try{
    await adminConfigRequest("user","delete",{
      User_ID:id,
      Supabase_User_ID:String(u?.Supabase_User_ID||"").trim()
    });
    selectedAdminUser="";
    renderAdminConfig();
  }catch(err){
    alert(`Nu am putut șterge utilizatorul: ${err.message}`);
  }
}
window.adminDeleteUser=adminDeleteUser;

async function adminCreatePrice(){
  const Contract=$("newPriceContract").value.trim();
  const Tip_Lucrare=$("newPriceWorkType").value.trim();
  const Pret=Number($("newPriceValue").value);
  if(!Contract||!Tip_Lucrare||!Number.isFinite(Pret)){alert("Contract, Work type and valid Price are required.");return;}
  await adminConfigRequest("price","create",{Contract,Tip_Lucrare,Pret});
}

async function adminSavePrice(ID){
  await adminConfigRequest("price","update",{
    ID,
    Contract:$(`priceContract${ID}`).value.trim(),
    Tip_Lucrare:$(`priceWorkType${ID}`).value.trim(),
    Pret:Number($(`priceValue${ID}`).value)
  });
}

async function adminDeletePrice(ID){
  if(!confirm(`Delete price row #${ID}?`))return;
  await adminConfigRequest("price","delete",{ID});
}

async function adminDeleteContract(){
  const Contract=$("deleteContractSelect").value;
  if(!Contract){alert("Select a contract first.");return;}
  if(!confirm(`Delete ALL pricing rows for contract "${Contract}"?`))return;
  await adminConfigRequest("contract","delete",{Contract});
}

async function adminCreateWorkType(){
  const Tip_Lucrare=$("newWorkTypeName").value.trim();
  if(!Tip_Lucrare){alert("Work type is required.");return;}
  await adminConfigRequest("work_type","create",{Tip_Lucrare,Active:$("newWorkTypeActive").checked});
}

async function adminSaveWorkType(ID){
  await adminConfigRequest("work_type","update",{
    ID,
    Tip_Lucrare:$(`workTypeName${ID}`).value.trim(),
    Active:$(`workTypeActive${ID}`).checked
  });
}

async function adminDeleteWorkType(ID){
  if(!confirm(`Delete work type #${ID}? Pricing rows are not deleted automatically.`))return;
  await adminConfigRequest("work_type","delete",{ID});
}

async function adminCreateCost(){
  const Tehnician=$("newCostTech").value;
  const Tip_Lucrare=$("newCostWorkType").value.trim();
  const Etapa=$("newCostStage").value;
  const Cost=Number($("newCostValue").value);
  if(!Tehnician||!Tip_Lucrare||!Etapa||!Number.isFinite(Cost)){alert("All technician cost fields are required.");return;}
  await adminConfigRequest("cost","create",{Tehnician,Tip_Lucrare,Etapa,Cost});
}

async function adminSaveCost(ID){
  await adminConfigRequest("cost","update",{
    ID,
    Tehnician:$(`costTech${ID}`).value,
    Tip_Lucrare:$(`costWorkType${ID}`).value.trim(),
    Etapa:$(`costStage${ID}`).value,
    Cost:Number($(`costValue${ID}`).value)
  });
}

async function adminDeleteCost(ID){
  if(!confirm(`Delete technician cost row #${ID}?`))return;
  await adminConfigRequest("cost","delete",{ID});
}


async function setOrderLock(id,locked){
  if(!isManagement()||!can("Can_Edit_All_Work_Orders")){
    alert("Doar Admin / Manager poate modifica blocarea lucrării.");
    return;
  }
  showLoading(locked?"Blocare lucrare":"Deblocare lucrare",`Actualizez lucrarea #${id}...`);
  try{
    const result=await fetchJson(API.updateOrder,authPayload({id:Number(id),fields:{Locked:Boolean(locked)}}));
    if(!result?.ok)throw new Error(result?.reply||"Backend-ul nu a confirmat modificarea.");
    await loadAll(false);
    setConnection(true,locked?`Lucrarea #${id} blocată`:`Lucrarea #${id} deblocată`);
  }catch(err){
    alert(`Nu am putut modifica blocarea: ${err.message}`);
  }finally{
    hideLoading();
  }
}
window.setOrderLock=setOrderLock;

async function quickUpdate(id,field,value){
  showLoading("Updating work order","Applying backend permissions...");
  try{
    await fetchJson(API.updateOrder,authPayload({id,fields:{[field]:value}}));
    await loadAll(false);
  }catch(err){alert(`Update failed: ${err.message}`);}
  finally{hideLoading();}
}
window.quickUpdate=quickUpdate;

async function deleteOrder(id){
  const current=orders.find(x=>x.id===Number(id));
  const doctorDeleteAllowed=isDoctor()&&can("Can_Edit_Partner_Work_Orders")&&doctorCanModifyOrder(current);
  const managementDeleteAllowed=isManagement()&&can("Can_Edit_All_Work_Orders");
  if(isTechnician()||(!doctorDeleteAllowed&&!managementDeleteAllowed)){
    alert("Nu ai dreptul să ștergi această lucrare.");
    return;
  }
  const o=current||orders.find(x=>x.id===Number(id));
  if(!o){alert("Work order not found.");return;}

  const ok=window.confirm(isDoctor()
    ? `Ștergi lucrarea #${o.id}?\n\nPacient: ${o.patient||"-"}\nTip lucrare: ${o.workType||"-"}\n\nȘtergerea este permanentă.`
    : `Ștergi lucrarea #${o.id}?\n\nPacient: ${o.patient||"-"}\nPartener: ${o.partner||"-"}\nTip lucrare: ${o.workType||"-"}\n\nȘtergerea este permanentă.`);
  if(!ok)return;

  showLoading("Ștergere lucrare",`Șterg lucrarea #${o.id}...`);
  try{
    const response=await fetchJson(API.deleteOrder,authPayload({id:o.id}));
    if(!response?.ok)throw new Error(response?.reply||"Ștergerea nu a putut fi confirmată.");
    await loadAll(false);
    setConnection(true,`Work order #${o.id} deleted`);
  }catch(err){
    console.error("Delete failed",err);
    alert(`Delete failed: ${err.message}`);
  }finally{
    hideLoading();
  }
}
window.deleteOrder=deleteOrder;

function openModal(){
  if(!modalBackdrop) throw new Error("Modal container is missing from HTML.");
  modalBackdrop.classList.remove("hidden");
  modalBackdrop.style.display="grid";
  modalBackdrop.setAttribute("aria-hidden","false");
}
function closeModal(){
  closeOrderToothPopover();
  if(!modalBackdrop) return;
  modalBackdrop.classList.add("hidden");
  modalBackdrop.style.removeProperty("display");
  modalBackdrop.setAttribute("aria-hidden","true");
}

function newOrderCaseDraft(){
  return {
    selected:[],
    shade:"",
    method:"",
    notes:"",
    doctorNotes:"",
    perTooth:{},
    createdForUser:String(auth?.user?.User_ID||""),
    orderId:null
  };
}

function syncOrderCaseDraftFromInputs(){
  if(!orderCaseDraft)return;

  orderCaseDraft.shade=orderShade?.value??"";
  if(orderMethod)orderCaseDraft.method=orderMethod.value||"";
  orderCaseDraft.doctorNotes=orderClinicNote?.value??"";
  orderCaseDraft.notes=orderProductionNotes?.value??"";

  document.querySelectorAll("[data-order-tooth-field]").forEach(el=>{
    const tooth=Number(el.dataset.tooth);
    const field=el.dataset.orderToothField;
    orderCaseDraft.perTooth[tooth]??={};
    orderCaseDraft.perTooth[tooth][field]=el.value;
  });
}

function deriveWorkOrderScope(selectedTeeth=[],{validate=true}={}){
  const seen=new Set();
  const items=(Array.isArray(selectedTeeth)?selectedTeeth:[]).map(entry=>({
    tooth_number:Number(entry?.tooth_number??entry?.tooth),
    work_type:String(entry?.work_type??entry?.workType??entry?.type??"").trim()
  })).filter(item=>{
    if(!Number.isInteger(item.tooth_number)||item.tooth_number<=0)return false;
    if(seen.has(item.tooth_number))return false;
    seen.add(item.tooth_number);
    return true;
  }).sort((a,b)=>a.tooth_number-b.tooth_number);
  const missing=items.filter(item=>!item.work_type).map(item=>item.tooth_number);
  if(validate&&!items.length)throw new Error("Selectează și configurează cel puțin un dinte.");
  if(validate&&missing.length)throw new Error(`Selectează un tip de lucrare pentru dinții: ${missing.join(", ")}.`);
  const work_types=[];
  items.forEach(item=>{if(item.work_type&&!work_types.includes(item.work_type))work_types.push(item.work_type);});
  return {items,work_types,work_type_summary:work_types.join(", "),element_count:items.length};
}

function workOrderToothItems(draft=orderCaseDraft){
  const selected=orderedSelectedTeeth(draft?.selected??[]).map(tooth=>({
    tooth_number:Number(tooth),
    work_type:String(draft?.perTooth?.[tooth]?.type??"").trim()
  }));
  return deriveWorkOrderScope(selected,{validate:false}).items;
}

function currentOrderScope({validate=false}={}){
  return deriveWorkOrderScope(workOrderToothItems(),{validate});
}

function renderOrderToothDetails(){
  if(!orderToothDetailsBody||!orderCaseDraft)return;
  const selected=orderedSelectedTeeth(orderCaseDraft.selected);

  orderToothDetailsBody.innerHTML=selected.length
    ? selected.map(tooth=>{
        const td=orderCaseDraft.perTooth[tooth]||{};
        const typeValue=String(td.type??"").trim();
        const shadeValue=String(td.shade??orderCaseDraft.shade??"").trim();
        const color=workTypeColor(typeValue);

        return `<tr class="configured-tooth-row" data-edit-order-tooth="${tooth}" tabindex="0">
          <td><strong>${tooth}</strong></td>
          <td>${FDI_TO_US[tooth]??"—"}</td>
          <td><span class="work-type-swatch" style="--swatch:${color}"></span>${escapeHtml(typeValue)||"—"}</td>
        <td>${escapeHtml(shadeValue)||"—"}</td>
          <td><button class="mini-btn tooth-row-edit-btn" type="button" data-edit-order-tooth="${tooth}">Edit</button></td>
        </tr>`;
      }).join("")
    : '<tr><td colspan="5" class="empty-case-row">Click pe un dinte gri pentru a-l configura.</td></tr>';

  document.querySelectorAll("[data-edit-order-tooth]").forEach(el=>{
    el.addEventListener("click",e=>{
      e.stopPropagation();
      if(doctorModalReadOnly())return;
      const tooth=Number(el.dataset.editOrderTooth);
      const anchor=orderToothChart?.querySelector(`[data-tooth="${tooth}"]`)??null;
      openOrderToothPopover(tooth,anchor);
    });
    el.addEventListener("keydown",e=>{
      if((e.key==="Enter"||e.key===" ")&&el.tagName!=="BUTTON"){
        e.preventDefault();
        const tooth=Number(el.dataset.editOrderTooth);
        const anchor=orderToothChart?.querySelector(`[data-tooth="${tooth}"]`)??null;
        openOrderToothPopover(tooth,anchor);
      }
    });
  });
}

function updateOrderToothDerivedScope(){
  if(!orderCaseDraft)return;
  const count=orderedSelectedTeeth(orderCaseDraft.selected).length;
  orderTeethSelected.textContent=String(count);
  recalcFormPrice();
}

function renderOrderWorkTypeLegend(){
  if(!orderWorkTypeLegend||!orderCaseDraft)return;

  const configured=orderedSelectedTeeth(orderCaseDraft.selected)
    .map(tooth=>String(orderCaseDraft.perTooth?.[tooth]?.type??"").trim())
    .filter(Boolean);

  const types=[...new Set(configured)];

  orderWorkTypeLegend.innerHTML=`
    <div class="legend-vertical-list">
      <div class="legend-vertical-item">
        <span class="work-type-swatch" style="--swatch:#777774"></span>
        <span>Unconfigured</span>
      </div>
      ${types.map(type=>`
        <div class="legend-vertical-item">
          <span class="work-type-swatch" style="--swatch:${workTypeColor(type)}"></span>
          <span>${escapeHtml(type)}</span>
        </div>`).join("")}
    </div>`;
}

function closeOrderToothPopover(){
  activeOrderTooth=null;
  activeOrderToothAnchor=null;
  activeOrderTeeth=[];
  activeOrderMixedFields=new Set();
  if(orderApplySameShade)orderApplySameShade.checked=false;
  orderSameShadeWrap?.classList.add("hidden");
  orderToothPopover?.classList.add("hidden");
  orderToothPopover?.style.removeProperty("left");
  orderToothPopover?.style.removeProperty("right");
  orderToothPopover?.style.removeProperty("top");
  orderToothPopover?.style.removeProperty("bottom");
  syncBatchToothHighlight();
}

function positionOrderToothPopover(anchor=null){
  if(!orderToothPopover||!orderToothChart)return;

  // Keep the existing mobile bottom-sheet behavior.
  if(window.matchMedia("(max-width: 860px)").matches){
    orderToothPopover.style.removeProperty("position");
    orderToothPopover.style.removeProperty("width");
    orderToothPopover.style.removeProperty("maxWidth");
    orderToothPopover.style.removeProperty("left");
    orderToothPopover.style.removeProperty("right");
    orderToothPopover.style.removeProperty("top");
    orderToothPopover.style.removeProperty("bottom");
    return;
  }

  requestAnimationFrame(()=>{
    const chart=orderToothChart.getBoundingClientRect();
    const margin=12;
    const gap=16;

    // The popup must never cover the odontogram while Ctrl/Cmd multi-select is active.
    // It is positioned relative to the complete chart, not relative to the clicked tooth.
    const rightSpace=Math.max(0,window.innerWidth-chart.right-gap-margin);
    const leftSpace=Math.max(0,chart.left-gap-margin);

    // Prefer the right side of the diagram exactly as requested.
    // Use the left only when there is materially more usable room there.
    const useRight=rightSpace>=260 || rightSpace>=leftSpace;
    const sideSpace=useRight?rightSpace:leftSpace;

    // Keep the editor practical even on medium desktop widths.
    const targetWidth=Math.min(320,Math.max(250,sideSpace));
    orderToothPopover.style.position="fixed";
    orderToothPopover.style.width=`${targetWidth}px`;
    orderToothPopover.style.maxWidth=`calc(100vw - ${margin*2}px)`;

    // Force layout with the final width before reading height.
    const pop=orderToothPopover.getBoundingClientRect();

    let left;
    if(useRight){
      left=chart.right+gap;
      if(left+pop.width>window.innerWidth-margin){
        left=window.innerWidth-margin-pop.width;
      }
      // Last safety guard: if that would touch the chart, use the left side.
      if(left<chart.right+8 && leftSpace>=250){
        left=Math.max(margin,chart.left-gap-pop.width);
      }
    }else{
      left=Math.max(margin,chart.left-gap-pop.width);
    }

    // Pin near the top of the odontogram instead of following each clicked tooth.
    // This prevents the popup jumping around during Ctrl/Cmd selection.
    let top=chart.top+18;
    top=Math.max(margin,Math.min(window.innerHeight-pop.height-margin,top));

    orderToothPopover.style.left=`${Math.round(left)}px`;
    orderToothPopover.style.right="auto";
    orderToothPopover.style.top=`${Math.round(top)}px`;
    orderToothPopover.style.bottom="auto";
  });
}

function toothPreviewSvg(tooth,color){
  return `<svg viewBox="-34 -34 68 68" aria-hidden="true">
    <defs>
      <filter id="previewBevel" x="-35%" y="-35%" width="170%" height="170%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="blur"></feGaussianBlur>
        <feSpecularLighting in="blur" surfaceScale="4" specularConstant=".7" specularExponent="17" lighting-color="#ffffff" result="spec">
          <fePointLight x="-15" y="-20" z="35"></fePointLight>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="spec2"></feComposite>
        <feBlend in="SourceGraphic" in2="spec2" mode="screen"></feBlend>
      </filter>
    </defs>
    <g transform="scale(1.32)" filter="url(#previewBevel)">
      ${toothGlyphMarkup(tooth,color,true,false)}
    </g>
  </svg>`;
}

function toothLabel(tooth){
  const n=Number(tooth);
  const quadrant=Math.floor(n/10);
  const pos=n%10;
  const kind=toothKind(n);
  const kindLabel={
    incisor:"Incisiv",
    canine:"Canin",
    premolar:"Premolar",
    molar:"Molar"
  }[kind]||"Dinte";

  const arch=(quadrant===1||quadrant===2)?"Superior":"Inferior";
  const side=(quadrant===1||quadrant===4)?"dreapta":"stânga";
  return `${kindLabel} (${arch}, ${side})`;
}

function toothTypeOptions(){
  return [...new Set([
    ...workTypes,
    "Coping",
    "Coroană anatomică",
    "Corp de punte redus",
    "Dinte adiacent",
    "Antagonist",
    "Coroană",
    "Corp de punte",
    "Fațetă",
    "Inlay / Onlay",
    "Coroană pe implant",
    "Abutment",
    "Provizoriu",
    "Full arch unit",
    "Structură",
    "Altul"
  ].map(v=>String(v??"").trim()).filter(Boolean))];
}

function partialMatches(options,query,limit=8){
  const q=normalize(query);
  const unique=[...new Set((options||[]).map(v=>String(v??"").trim()).filter(Boolean))];

  if(!q)return unique.slice(0,limit);

  return unique
    .filter(v=>normalize(v).includes(q))
    .sort((a,b)=>{
      const na=normalize(a),nb=normalize(b);
      const aStarts=na.startsWith(q)?0:1;
      const bStarts=nb.startsWith(q)?0:1;
      return aStarts-bStarts || a.localeCompare(b);
    })
    .slice(0,limit);
}

function showPartialSuggestions(input,box,options){
  if(!input||!box)return;

  const matches=partialMatches(options,input.value);
  if(!matches.length){
    box.innerHTML='<div class="partial-suggestion-empty">Nicio opțiune potrivită</div>';
    box.classList.remove("hidden");
    return;
  }

  box.innerHTML=matches.map(value=>`
    <button type="button" class="partial-suggestion-item" data-autocomplete-value="${escapeHtml(value)}">
      ${escapeHtml(value)}
    </button>`).join("");

  box.classList.remove("hidden");

  box.querySelectorAll("[data-autocomplete-value]").forEach(btn=>{
    btn.addEventListener("mousedown",e=>{
      e.preventDefault();
      input.value=btn.dataset.autocompleteValue||"";
      box.classList.add("hidden");

      // Selection is complete: emit change, not input.
      // The input event would immediately reopen the partial-match dropdown.
      input.dispatchEvent(new Event("change",{bubbles:true}));
    });
  });
}

function attachPartialAutocomplete(input,box,getOptions){
  if(!input||!box)return;

  const refresh=()=>showPartialSuggestions(input,box,getOptions());
  input.addEventListener("focus",refresh);
  input.addEventListener("input",refresh);
  input.addEventListener("keydown",e=>{
    if(e.key==="Escape"){
      box.classList.add("hidden");
      return;
    }

    if(e.key==="Enter" && !box.classList.contains("hidden")){
      const first=box.querySelector("[data-autocomplete-value]");
      if(first){
        e.preventDefault();
        input.value=first.dataset.autocompleteValue||"";
        box.classList.add("hidden");
        input.dispatchEvent(new Event("change",{bubbles:true}));
      }
    }
  });
  input.addEventListener("blur",()=>{
    setTimeout(()=>box.classList.add("hidden"),120);
  });
}

function updateToothDetailBadge(type){
  if(!orderToothTypeBadge)return;
  const value=String(type??"").trim();
  const color=value?workTypeColor(value):"#777774";
  orderToothTypeBadge.innerHTML=`
    <span class="tooth-badge-dot" style="--badge:${color}"></span>
    <span>${escapeHtml(value||"Neconfigurat")}</span>`;
}

function orderedActiveTeeth(values){
  const set=new Set((values||[]).map(Number).filter(Number.isFinite));
  return [...FDI_UPPER,...FDI_LOWER].filter(t=>set.has(t));
}

function syncBatchToothHighlight(){
  if(!orderToothChart)return;
  const active=new Set(activeOrderTeeth.map(Number));
  orderToothChart.querySelectorAll("[data-tooth]").forEach(el=>{
    el.classList.toggle("batch-selected",active.has(Number(el.dataset.tooth)));
  });
  orderToothChart.querySelectorAll("[data-tooth-label]").forEach(el=>{
    el.classList.toggle("batch-selected-label",active.has(Number(el.dataset.toothLabel)));
  });
}

function commonBatchField(teeth,field,fallback=""){
  const values=teeth.map(tooth=>{
    const td=orderCaseDraft?.perTooth?.[tooth]??{};
    if(Object.prototype.hasOwnProperty.call(td,field))return String(td[field]??"");
    return String(typeof fallback==="function"?fallback(tooth):fallback??"");
  });

  const first=values[0]??"";
  const mixed=values.some(v=>v!==first);
  if(mixed)activeOrderMixedFields.add(field);
  return mixed?"":first;
}

function batchPreviewHtml(teeth){
  if(teeth.length===1){
    const tooth=teeth[0];
    const td=orderCaseDraft?.perTooth?.[tooth]??{};
    const type=String(td.type??"").trim();
    const color=orderCaseDraft?.selected?.map(Number).includes(tooth)?workTypeColor(type):"#777774";
    return toothPreviewSvg(tooth,color);
  }

  return `<div class="multi-tooth-preview">
    <strong>${teeth.length}</strong>
    <span>dinți</span>
    <small>${teeth.join(", ")}</small>
  </div>`;
}

function openOrderToothPopover(tooth,anchor=null,options={}){
  if(doctorModalReadOnly())return;
  if(!orderCaseDraft||!orderToothPopover)return;

  syncOrderCaseDraftFromInputs();
  const current=Number(tooth);
  const append=Boolean(options.append);

  if(Array.isArray(options.batch)&&options.batch.length){
    activeOrderTeeth=orderedActiveTeeth(options.batch);
  }else if(append){
    const set=new Set(activeOrderTeeth.map(Number));
    if(set.has(current))set.delete(current);
    else set.add(current);
    activeOrderTeeth=orderedActiveTeeth([...set]);
  }else{
    activeOrderTeeth=[current];
  }

  if(!activeOrderTeeth.length){
    closeOrderToothPopover();
    return;
  }

  activeOrderTooth=current;
  activeOrderToothAnchor=anchor;
  activeOrderMixedFields=new Set();

  const teeth=[...activeOrderTeeth];
  const defaultType=commonBatchField(teeth,"type","");
  const defaultShade=commonBatchField(teeth,"shade",()=>String(orderCaseDraft.shade??"").trim());
  const defaultNote=commonBatchField(teeth,"note","");

  const selectedSet=new Set(orderCaseDraft.selected.map(Number));
  const configuredCount=teeth.filter(t=>selectedSet.has(t)).length;

  orderToothPopoverTitle.textContent=teeth.length===1
    ? `Dinte #${teeth[0]}`
    : `${teeth.length} dinți selectați`;

  orderToothPopoverMeta.textContent=teeth.length===1
    ? toothLabel(teeth[0])
    : `FDI: ${teeth.join(", ")} · bifează opțiunea pentru o culoare comună`;

  orderToothPreview.innerHTML=batchPreviewHtml(teeth);

  orderToothType.value=defaultType;
  orderToothType.placeholder=activeOrderMixedFields.has("type")
    ? "Valori diferite — scrie pentru a suprascrie"
    : "Scrie pentru a căuta tipul lucrării...";

  orderToothShade.value=defaultShade;
  orderToothShade.placeholder=activeOrderMixedFields.has("shade")
    ? "Valori diferite — scrie pentru a suprascrie"
    : "A1, A2, BL2...";
  const isBatch=teeth.length>1;
  if(orderApplySameShade)orderApplySameShade.checked=false;
  orderSameShadeWrap?.classList.toggle("hidden",!isBatch);
  if(orderToothShade){
    orderToothShade.disabled=isBatch;
    if(isBatch)orderToothShade.placeholder="Bifează pentru a aplica o culoare comună";
  }

  orderToothNote.value=defaultNote;
  orderToothNote.placeholder=activeOrderMixedFields.has("note")
    ? "Observații diferite — scrie pentru a suprascrie"
    : "Observații suplimentare...";

  orderToothTypeSuggestions?.classList.add("hidden");

  orderToothRemoveBtn.classList.toggle("hidden",configuredCount===0);
  orderToothRemoveBtn.textContent=teeth.length>1?"Elimină dinții selectați":"Elimină dintele";
  orderToothSaveBtn.textContent=teeth.length>1?`Aplică la ${teeth.length} dinți`:"Salvează dintele";

  updateToothDetailBadge(orderToothType.value);
  orderToothPopover.classList.remove("hidden");
  syncBatchToothHighlight();
  positionOrderToothPopover(anchor);

  // Avoid opening the on-screen keyboard or moving the scroll position on
  // touch devices. This also lets the user tap more teeth before editing.
  if(!append && teeth.length===1 && !window.matchMedia("(max-width: 860px), (pointer: coarse)").matches){
    setTimeout(()=>orderToothType.focus(),0);
  }
}

function saveOrderToothPopover(){
  if(doctorModalReadOnly())return;
  if(!orderCaseDraft||!activeOrderTeeth.length)return;

  const teeth=[...activeOrderTeeth];
  const typeInput=String(orderToothType.value||"").trim();
  const shadeInput=String(orderToothShade.value||"").trim();
  const noteInput=String(orderToothNote.value||"").trim();
  const applyShadeToBatch=teeth.length===1||Boolean(orderApplySameShade?.checked);

  const selectedSet=new Set(orderCaseDraft.selected.map(Number));

  if(!typeInput&&!activeOrderMixedFields.has("type")){
    alert("Selectează tipul lucrării înainte de salvarea dintelui.");
    orderToothType.focus();
    return;
  }
  if(!typeInput&&activeOrderMixedFields.has("type")&&teeth.some(tooth=>!String(orderCaseDraft.perTooth?.[tooth]?.type||"").trim())){
    alert("Selecția conține dinți fără tip de lucrare. Alege un tip pentru întreaga selecție.");
    orderToothType.focus();
    return;
  }

  for(const tooth of teeth){
    selectedSet.add(tooth);
    const next={...(orderCaseDraft.perTooth[tooth]||{})};

    const applyField=(field,value,singleFallback="")=>{
      if(teeth.length===1){
        next[field]=field==="type"?(value||singleFallback):value;
        return;
      }

      // For a mixed batch, an untouched blank means "keep each tooth's current value".
      // Once the user types a value, it is intentionally applied to the whole selection.
      if(activeOrderMixedFields.has(field)&&value==="")return;
      next[field]=value;
    };

    applyField("type",typeInput);
    if(applyShadeToBatch)applyField("shade",shadeInput);
    applyField("note",noteInput);

    orderCaseDraft.perTooth[tooth]=next;
  }

  orderCaseDraft.selected=orderedSelectedTeeth([...selectedSet]);

  closeOrderToothPopover();
  renderOrderToothPicker();
  renderOrderToothDetails();
  updateOrderToothDerivedScope();
}

function removeActiveOrderTooth(){
  if(doctorModalReadOnly())return;
  if(!orderCaseDraft||!activeOrderTeeth.length)return;

  const set=new Set(orderCaseDraft.selected.map(Number));
  for(const tooth of activeOrderTeeth){
    set.delete(Number(tooth));
    delete orderCaseDraft.perTooth[Number(tooth)];
  }
  orderCaseDraft.selected=orderedSelectedTeeth([...set]);

  closeOrderToothPopover();
  renderOrderToothPicker();
  renderOrderToothDetails();
  updateOrderToothDerivedScope();
}

function renderOrderToothPicker(){
  if(!orderToothChart||!orderCaseDraft)return;
  const selected=orderedSelectedTeeth(orderCaseDraft.selected);

  orderToothChart.innerHTML=dentalChartSvg(selected,true,{
    details:orderCaseDraft.perTooth,
    colorByType:true,
    viewMode:orderToothViewMode
  });

  orderToothChart.querySelectorAll("[data-tooth]").forEach(el=>{
    const tooth=Number(el.dataset.tooth);

    el.addEventListener("click",e=>{
      e.stopPropagation();
      if(doctorModalReadOnly())return;
      const touchMultiSelect=window.matchMedia("(max-width: 860px), (pointer: coarse)").matches
        && activeOrderTeeth.length>0;
      openOrderToothPopover(tooth,el,{append:Boolean(e.ctrlKey||e.metaKey||touchMultiSelect)});
    });

    el.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){
        e.preventDefault();
        openOrderToothPopover(tooth,el,{append:Boolean(e.ctrlKey||e.metaKey)});
      }
    });
  });

  if(orderShade)orderShade.value=orderCaseDraft.shade??"";
  if(orderMethod)orderMethod.value=orderCaseDraft.method||"";
  orderClinicNote.value=orderCaseDraft.doctorNotes??"";
  orderProductionNotes.value=orderCaseDraft.notes??"";

  renderOrderWorkTypeLegend();
  updateOrderToothDerivedScope();
  syncBatchToothHighlight();

  document.querySelectorAll("[data-tooth-view]").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.toothView===orderToothViewMode);
  });
}

function initializeOrderCaseDraft(draft=null){
  orderCaseDraft=draft?{
    ...draft,
    selected:orderedSelectedTeeth(draft.selected??[]),
    perTooth:draft.perTooth??{}
  }:newOrderCaseDraft();

  renderOrderToothPicker();
  renderOrderToothDetails();
  recalcFormPrice();
}

async function loadOrderCaseForEdit(order){
  orderCaseLoaded=false;

  const saved=await fetchPatientCase(order.id);
  const draft=draftFromServerCase(order,saved);
  draft.orderId=order.id;

  initializeOrderCaseDraft(draft);
  orderCaseLoaded=true;

  return Boolean(saved);
}


const CASE_FILE_EXTENSIONS=new Set(["zip","stl","ply","obj","pdf","jpg","jpeg","png"]);

function caseFileExtension(name){
  const parts=String(name||"").toLowerCase().split(".");
  return parts.length>1?parts.pop():"";
}

function caseFilesCanUpload(){
  // V18.6: adding an attachment does not mutate the Work Order itself.
  // Row-level authorization is still enforced server-side: Doctors only for
  // their Clinic cases and Technicians only for assigned Work Orders.
  return isManagement()||isDoctor()||isTechnician();
}

function renderCaseFileQueue(){
  if(!caseFileQueue)return;
  if(!caseFileSelection.length){
    caseFileQueue.innerHTML="";
    return;
  }

  caseFileQueue.innerHTML=caseFileSelection.map((file,index)=>{
    const state=file._uploadState||"queued";
    const stateText={
      queued:"pregătit pentru upload",
      authorizing:"verific permisiunea...",
      uploading:"se încarcă...",
      done:"încărcat",
      error:file._uploadError||"eroare"
    }[state]||state;

    return `<div class="case-file-row ${escapeHtml(state)}">
      <div class="case-file-icon">${caseFileExtension(file.name)==="zip"?"ZIP":"FILE"}</div>
      <div class="case-file-main">
        <strong>${escapeHtml(file.name)}</strong>
        <span>${humanFileSize(file.size)} · ${escapeHtml(stateText)}</span>
      </div>
      ${state==="queued"||state==="error"
        ?`<button type="button" class="mini-btn" data-remove-case-file="${index}">Elimină</button>`
        :`<span class="case-file-state-dot ${escapeHtml(state)}"></span>`}
    </div>`;
  }).join("");

  caseFileQueue.querySelectorAll("[data-remove-case-file]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      caseFileSelection.splice(Number(btn.dataset.removeCaseFile),1);
      renderCaseFileQueue();
    });
  });
}


function caseFileCanDelete(){
  if(isManagement())return true;
  if(isDoctor())return !doctorModalReadOnly();
  return false;
}

function renderSavedCaseFiles(){
  if(!caseFileList)return;

  if(caseFilesLoading){
    caseFileList.innerHTML=`<div class="case-file-empty">Încarc fișierele...</div>`;
    return;
  }

  if(!caseFilesSaved.length){
    caseFileList.innerHTML=`<div class="case-file-empty">Nu există fișiere salvate pentru această lucrare.</div>`;
    return;
  }

  caseFileList.innerHTML=caseFilesSaved.map(file=>`
    <div class="case-file-row saved">
      <div class="case-file-icon">${caseFileExtension(file.original_file_name)==="zip"?"ZIP":"FILE"}</div>
      <div class="case-file-main">
        <strong>${escapeHtml(file.original_file_name||"Fișier")}</strong>
        <span>${humanFileSize(file.file_size_bytes)} · ${fmtDate(file.created_at)}</span>
      </div>
      <div class="case-file-actions">
        <button type="button" class="mini-btn" data-download-case-file="${escapeHtml(file.id)}">Descarcă</button>
        ${caseFileCanDelete()?`<button type="button" class="mini-btn danger-mini" data-delete-case-file="${escapeHtml(file.id)}">Șterge</button>`:""}
      </div>
    </div>`).join("");

  caseFileList.querySelectorAll("[data-download-case-file]").forEach(btn=>{
    btn.addEventListener("click",()=>downloadCaseFile(btn.dataset.downloadCaseFile));
  });

  caseFileList.querySelectorAll("[data-delete-case-file]").forEach(btn=>{
    btn.addEventListener("click",()=>deleteCaseFile(btn.dataset.deleteCaseFile));
  });
}

async function loadCaseFiles(){
  const id=Number(orderId?.value||0);
  if(!id||!supabaseConfigured()||!supabaseClient){
    caseFilesSaved=[];
    renderSavedCaseFiles();
    return;
  }

  caseFilesLoading=true;
  renderSavedCaseFiles();

  try{
    const result=await callFileAuthorization("list",id);
    caseFilesSaved=Array.isArray(result.files)?result.files:[];
  }catch(err){
    caseFilesSaved=[];
    if(caseFileList){
      caseFileList.innerHTML=`<div class="case-file-empty error">${escapeHtml(err.message)}</div>`;
    }
    caseFilesLoading=false;
    return;
  }

  caseFilesLoading=false;
  renderSavedCaseFiles();
}

async function downloadCaseFile(fileId){
  const id=Number(orderId?.value||0);
  if(!id)return;

  try{
    showLoading("Pregătesc fișierul","Generez linkul securizat de download...");
    const result=await callFileAuthorization("download",id,{file_id:fileId});
    if(!result?.signed_url)throw new Error("Nu am primit linkul de download.");
    window.open(result.signed_url,"_blank","noopener,noreferrer");
  }catch(err){
    alert(`Download eșuat: ${err.message}`);
  }finally{
    hideLoading();
  }
}

async function deleteCaseFile(fileId){
  const id=Number(orderId?.value||0);
  if(!id)return;
  if(!confirm("Ștergi acest fișier din lucrare?"))return;

  try{
    showLoading("Ștergere fișier","Verific permisiunile și șterg fișierul...");
    await callFileAuthorization("delete",id,{file_id:fileId});
    await loadCaseFiles();
  }catch(err){
    alert(`Nu am putut șterge fișierul: ${err.message}`);
  }finally{
    hideLoading();
  }
}

async function uploadSelectedCaseFiles({showFailureAlert=true}={}){
  const id=Number(orderId?.value||0);
  if(!id)throw new Error("Salvează lucrarea înainte de upload.");
  if(!caseFileSelection.length)throw new Error("Selectează cel puțin un fișier.");

  caseFilesUploading=true;
  if(caseFileUploadBtn){
    caseFileUploadBtn.disabled=true;
    caseFileUploadBtn.textContent="Se încarcă...";
  }

  const failures=[];
  let succeeded=0;

  try{
    for(const file of caseFileSelection){
      try{
        file._uploadState="authorizing";
        file._uploadError="";
        renderCaseFileQueue();

        const authz=await callFileAuthorization("upload",id,{
          file_name:file.name,
          file_size:file.size,
          mime_type:file.type||"application/octet-stream",
          file_kind:caseFileExtension(file.name)
        });

        const upload=authz?.upload;
        if(!upload?.bucket||!upload?.path||!upload?.token){
          throw new Error("Răspuns upload incomplet.");
        }

        file._uploadState="uploading";
        renderCaseFileQueue();

        const {error:uploadError}=await supabaseClient.storage
          .from(upload.bucket)
          .uploadToSignedUrl(upload.path,upload.token,file,{
            contentType:file.type||"application/octet-stream"
          });

        if(uploadError)throw uploadError;

        file._uploadState="done";
        renderCaseFileQueue();
      }catch(err){
        file._uploadState="error";
        file._uploadError=err.message||"Upload eșuat";
        failures.push(`${file.name}: ${file._uploadError}`);
        renderCaseFileQueue();
      }
    }

    await loadCaseFiles();

    succeeded=caseFileSelection.filter(f=>f._uploadState==="done").length;
    if(succeeded){
      setConnection(true,`${succeeded} fișier${succeeded===1?"":"e"} încărcat${succeeded===1?"":"e"}`);
    }

    caseFileSelection=caseFileSelection.filter(f=>f._uploadState==="error");
    renderCaseFileQueue();

    if(failures.length&&showFailureAlert)alert(failures.join("\n"));
  }finally{
    caseFilesUploading=false;
    renderCaseFilesUI();
  }

  return {succeeded,failures:[...failures]};
}

function renderCaseFilesUI(){
  if(!caseFilesSetupNotice||!caseFileUploadBtn||!caseFileInput)return;

  const configured=supabaseConfigured();
  const existingId=Number(orderId?.value||0);
  const canUpload=caseFilesCanUpload();
  const maxMB=currentUploadLimitMB();

  if(caseFilesPlanBadge){
    caseFilesPlanBadge.textContent=`Free · max ${maxMB} MB în aplicație`;
  }

  if(!configured){
    caseFilesSetupNotice.innerHTML=`<strong>spațiul securizat de fișiere nu este conectat.</strong>
      <span>Verifică configurația proiectului.</span>`;
  }else if(!existingId){
    caseFilesSetupNotice.innerHTML=`<strong>Poți selecta fișierele înainte de salvare.</strong>
      <span>Vor fi încărcate automat imediat după crearea Work Order ID.</span>`;
  }else if(isTechnician()){
    caseFilesSetupNotice.innerHTML=`<strong>Poți adăuga fișiere acestei lucrări.</strong>
      <span>Upload-ul și download-ul sunt disponibile pentru lucrările la care ești asignat. Ștergerea rămâne restricționată.</span>`;
  }else if(isDoctor()){
    caseFilesSetupNotice.innerHTML=`<strong>Poți adăuga fișiere cazului clinic.</strong>
      <span>Upload-ul și download-ul rămân disponibile inclusiv după intrarea lucrării în producție. ${caseFileCanDelete()?"Poți șterge fișiere cât lucrarea este Neînceput și neblocată.":"Fișierele existente nu pot fi șterse în starea curentă."}</span>`;
  }else if(!canUpload){
    caseFilesSetupNotice.innerHTML=`<strong>Fișierele sunt disponibile doar pentru vizualizare.</strong>
      <span>Rolul curent nu poate adăuga fișiere acestei lucrări.</span>`;
  }else{
    caseFilesSetupNotice.innerHTML=`<strong>Storage securizat activ.</strong>
      <span>Fișierul merge direct browser → spațiul securizat de fișiere după verificarea permisiunii.</span>`;
  }

  const inputDisabled=!configured||!canUpload||caseFilesUploading;
  const uploadDisabled=inputDisabled||!existingId||!caseFileSelection.length;
  caseFileInput.disabled=inputDisabled;
  caseFileUploadBtn.disabled=uploadDisabled;
  caseFileUploadBtn.textContent=caseFilesUploading
    ?"Se încarcă..."
    :(!existingId&&caseFileSelection.length?"Se încarcă după salvare":"Încarcă fișiere");

  renderCaseFileQueue();
  renderSavedCaseFiles();
}
function validateCaseFileSelection(files){
  const maxBytes=currentUploadLimitMB()*1024*1024;
  const valid=[];
  const errors=[];

  for(const file of files){
    const ext=caseFileExtension(file.name);
    if(!CASE_FILE_EXTENSIONS.has(ext)){
      errors.push(`${file.name}: extensie neacceptată`);
      continue;
    }
    if(Number(file.size)>maxBytes){
      errors.push(`${file.name}: ${humanFileSize(file.size)} depășește limita curentă de ${currentUploadLimitMB()} MB`);
      continue;
    }
    file._uploadState="queued";
    file._uploadError="";
    valid.push(file);
  }

  return {valid,errors};
}

function setModalRoleMode(){
  const doctor=isDoctor();
  const tech=isTechnician();

  // V18.5: the Work Order modal is reused between sessions and roles.
  // Remove access state left behind by the V18.4 technician read-only viewer,
  // then rebuild the correct state for the currently authenticated role.
  if(!tech)orderForm?.classList.remove("technician-view-mode");
  if(!doctor)orderForm?.classList.remove("doctor-readonly");
  orderForm?.querySelectorAll("input,select,textarea").forEach(el=>{el.disabled=false;});
  orderForm?.querySelectorAll(".date-picker-btn").forEach(el=>{el.disabled=false;});

  orderForm?.classList.toggle("doctor-mode",doctor);

  document.querySelectorAll(".management-field").forEach(el=>{
    el.classList.toggle("hidden",tech||doctor);
  });
  document.querySelectorAll(".technician-create-field").forEach(el=>{
    el.classList.toggle("hidden",!tech);
  });
  document.querySelectorAll(".tooth-derived-field").forEach(el=>{
    el.classList.toggle("hidden",!tech);
  });
  document.querySelectorAll(".doctor-hidden-field").forEach(el=>{
    el.classList.toggle("hidden",doctor);
  });
  document.querySelectorAll(".doctor-visible-field,.doctor-visible-price").forEach(el=>{
    if(doctor)el.classList.remove("hidden");
  });

  if(status)status.disabled=doctor;
  if(partner)partner.readOnly=doctor;

  // Reset the Doctor-editable controls before applying a possible read-only state.
  [dueDate,patient,orderClinicNote,orderToothType,orderToothShade,orderToothMethod,orderToothNote].forEach(el=>{if(el)el.disabled=false;});
  [orderSelectAnteriorBtn,orderClearTeethBtn,orderToothSaveBtn,orderToothRemoveBtn].forEach(el=>{if(el)el.disabled=false;});
  if(saveOrderBtn){saveOrderBtn.disabled=false;saveOrderBtn.classList.remove("hidden");saveOrderBtn.textContent="Salvează lucrarea";}

  if(doctor){
    partner.value=String(auth?.user?.Partner_Name||"");
    partnerSuggestions?.classList.add("hidden");

    const finalLabel=finalPrice?.closest("div")?.querySelector("span");
    if(finalLabel)finalLabel.textContent="Total de plată";
    recalcFormPrice();

    if(doctorModalReadOnly()){
      orderForm?.classList.add("doctor-readonly");
      [dueDate,patient,orderClinicNote,orderToothType,orderToothShade,orderToothMethod,orderToothNote].forEach(el=>{if(el)el.disabled=true;});
      [orderSelectAnteriorBtn,orderClearTeethBtn,orderToothSaveBtn,orderToothRemoveBtn].forEach(el=>{if(el)el.disabled=true;});
      if(saveOrderBtn){saveOrderBtn.disabled=true;saveOrderBtn.classList.add("hidden");}
    }else{
      orderForm?.classList.remove("doctor-readonly");
    }
  }else{
    const finalLabel=finalPrice?.closest("div")?.querySelector("span");
    if(finalLabel)finalLabel.textContent="Total de plată";
  }

  if(orderCasePdfBtn){
    // Export is always allowed for Doctor, including Locked / Started work.
    // Backend CASE GET remains read-only-safe and does not permit an UPSERT.
    orderCasePdfBtn.classList.remove("hidden");
    orderCasePdfBtn.disabled=false;
  }
  if(doctor&&orderCasePdfBtn){
    orderCasePdfBtn.textContent="Exportă fișa de lucru";
  }else if(orderCasePdfBtn){
    orderCasePdfBtn.textContent="Fișă lucrare / PDF";
  }

  if(isManagement())syncStageApplicabilityControls();

  renderCaseFilesUI();
}

function resetForm(){
  if(!orderForm) throw new Error("Work order form is missing.");
  orderForm.reset();
  // V18.5: fully reset role-specific modal state. V18.4 left the
  // technician-view-mode class and disabled production controls in place,
  // which could hide/lock Admin and Manager production editing after a
  // technician had opened a case in the same browser session.
  orderForm.classList.remove("edit-mode","doctor-mode","doctor-readonly","technician-view-mode");
  renderTechnicianAssignmentSummary(null);
  orderForm.querySelectorAll("input,select,textarea").forEach(el=>{el.disabled=false;});
  orderForm.querySelectorAll(".date-picker-btn").forEach(el=>{el.disabled=false;});
  [orderSelectAnteriorBtn,orderClearTeethBtn,orderToothSaveBtn,orderToothRemoveBtn].forEach(el=>{if(el)el.disabled=false;});
  if(saveOrderBtn){saveOrderBtn.disabled=false;saveOrderBtn.classList.remove("hidden");saveOrderBtn.textContent="Salvează lucrarea";}
  caseFileSelection=[];
  if(caseFileInput)caseFileInput.value="";
  renderCaseFilesUI();
  orderId.value="";
  patientSuggestions?.classList.add("hidden");
  partnerSuggestions?.classList.add("hidden");
  closeOrderToothPopover();
  populateFormOptions({
    status:"Not Started",
    statusModel:"Not Started",
    statusModeling:"Not Started",
    statusCerFin:"Not Started",
    paidModel:"Not Paid",
    paidModeling:"Not Paid",
    paidCerFin:"Not Paid",
    modelNotApplicable:false,
    modelingNotApplicable:false,
    ceramicNotApplicable:false
  });
  discount.value=0;
  myStage.value="Model";
  recalcFormPrice();
  initializeOrderCaseDraft(newOrderCaseDraft());
  orderCaseLoaded=false;
}
async function editOrder(id){
  if(isTechnician())return;
  const o=orders.find(x=>x.id===id);if(!o)return;

  showLoading("Deschid lucrarea","Caut fișa clinică și detaliile dentare...");
  try{
    resetForm();
    orderForm.classList.add("edit-mode");
    modalTitle.textContent=`Editează lucrarea #${id}`;
    modalSubtitle.textContent=isDoctor()
      ? "Poți modifica datele clinice permise și configurația dinților, inclusiv nuanța și notele explicative pentru fiecare dinte. Contractul, partenerul și producția sunt gestionate automat de laborator."
      : "Datele operaționale și fișa clinică sunt gata de editare.";
    orderId.value=o.id;
    dueDate.value=toDateInputValue(o.deadline);
    receptionDate.value=toDateInputValue(o.receptionDate);
    patient.value=o.patient||"";
    partner.value=o.partner||"";
    patientSuggestions?.classList.add("hidden");
    partnerSuggestions?.classList.add("hidden");
    discount.value=o.discount||0;
    populateFormOptions(o);
    renderTechnicianAssignmentSummary(o);
    recalcFormPrice();
    setModalRoleMode();

    const hadSavedCase=await loadOrderCaseForEdit(o);
    modalSubtitle.textContent=isDoctor()
      ? (doctorModalReadOnly()
          ? (o.locked
              ? "Lucrarea este blocată de laborator. Ai acces doar pentru vizualizare și export."
              : "Lucrarea a intrat în producție. Ai acces doar pentru vizualizare și export.")
          : (hadSavedCase
              ? "Fișa clinică și selecția dentară au fost încărcate."
              : "Lucrarea nu are încă o definiție dentară salvată."))
      : (hadSavedCase
          ? "Dinții, nuanța și prescripția au fost încărcate."
          : "Lucrarea nu are încă o definiție dentară salvată.");

    openModal();
    loadCaseFiles();
  }catch(err){
    alert(
      `Could not load the saved patient case for Work Order #${id}. ` +
      `The edit form was not opened to avoid overwriting saved tooth data.\\n\\n${err.message}`
    );
  }finally{
    hideLoading();
  }
}
window.editOrder=editOrder;

function managementFields(){
  return {
    Deadline:dueDate.value,Data_Receptie:receptionDate.value||null,Status:status.value,Nume_Pacient:patient.value.trim(),Nume_Partener:partner.value.trim(),Contract:contract.value,
    Tehnician_Model:modelTech.value,Tehnician1_Modelare:modelingTech.value,Tehnician2_Cer_Fin:ceramicTech.value,
    Status_Model:statusModel.value,Status_Modelare:statusModeling.value,Status_Cer_Fin:statusCerFin.value,
    Paid_Model:paidModel.value,Paid_Modelare:paidModeling.value,Paid_Cer_Fin:paidCerFin.value,Discount:num(discount.value),
    Model_Not_Applicable:Boolean(modelNotApplicable.checked),Modelare_Not_Applicable:Boolean(modelingNotApplicable.checked),Cer_Fin_Not_Applicable:Boolean(ceramicNotApplicable.checked)
  };
}
function technicianCreateFields(){
  return {Deadline:dueDate.value,Data_Receptie:receptionDate.value||null,Nume_Pacient:patient.value.trim(),Nume_Partener:partner.value.trim(),My_Stage:myStage.value};
}
function doctorWorkOrderFields(){
  return {
    Deadline:dueDate.value,
    Nume_Pacient:patient.value.trim()
  };
}

orderForm.addEventListener("submit",async e=>{
  e.preventDefault();
  syncOrderCaseDraftFromInputs();
  const id=num(orderId.value);
  saveOrderBtn.disabled=true;
  showLoading(id?"Actualizare lucrare":"Creare lucrare","Salvez datele...");

  try{
    let response;

    if(isTechnician()){
      if(id) throw new Error("Technicians cannot edit general work order fields.");

      const fields=technicianCreateFields();
      console.log("CREATE technician payload", fields);
      response=await fetchJson(API.createOrder,authPayload({fields}));
    }else if(isDoctor()){
      if(id && doctorModalReadOnly())throw new Error("Lucrarea este read-only pentru medic.");
      const fields=doctorWorkOrderFields();
      console.log(id?"UPDATE doctor payload":"CREATE doctor payload", fields);
      response=id
        ? await fetchJson(API.updateOrder,authPayload({id,fields}))
        : await fetchJson(API.createOrder,authPayload({fields}));
    }else{
      const fields=managementFields();
      console.log(id?"UPDATE admin payload":"CREATE admin payload", fields);

      response=id
        ? await fetchJson(API.updateOrder,authPayload({id,fields}))
        : await fetchJson(API.createOrder,authPayload({fields}));
    }

    console.log("n8n save response",response);

    if(!response || response.ok!==true){
      throw new Error(response?.reply || "Salvarea nu a putut fi confirmată.");
    }

    const savedId=id||Number(response.ID);

    // The Work Order is already committed at this point.
    // Store its ID immediately so a patient-case retry can never create
    // a duplicate Work Order.
    if(savedId>0 && !id){
      orderId.value=String(savedId);
      orderCaseDraft.orderId=savedId;
    }

    if(savedId>0 && (id>0 || hasMeaningfulCaseData(orderCaseDraft))){
      try{
        await persistPatientCase(savedId,orderCaseDraft);
      }catch(caseErr){
        setConnection(false,`Work order #${savedId} saved · case sheet pending`);
        alert(
          `Work order #${savedId} was saved successfully, but the case sheet could not be saved. ` +
          `Formularul rămâne deschis ca să poți încerca din nou salvarea.\n\n${caseErr.message}`
        );
        return;
      }
    }

    closeModal();
    await loadAll(false);
    setConnection(true,`Saved · Work Order #${savedId} + patient case`);

    setConnection(true,id ? "Work order updated" : `Work order #${response.ID ?? ""} created`);
  }catch(err){
    console.error("Work order save failed",err);
    alert(`Save failed: ${err.message}`);
  }finally{
    saveOrderBtn.disabled=false;
    hideLoading();
  }
});

[contract,partner,discount].forEach(el=>el.addEventListener("input",()=>recalcFormPrice()));

[modelNotApplicable,modelingNotApplicable,ceramicNotApplicable].forEach(el=>el?.addEventListener("change",syncStageApplicabilityControls));
[statusModel,statusModeling,statusCerFin].forEach(el=>el?.addEventListener("change",syncOrderStatusChoices));


orderShade?.addEventListener("input",syncOrderCaseDraftFromInputs);
orderMethod?.addEventListener("input",syncOrderCaseDraftFromInputs);
orderClinicNote?.addEventListener("input",syncOrderCaseDraftFromInputs);
orderProductionNotes?.addEventListener("input",syncOrderCaseDraftFromInputs);
orderSelectAnteriorBtn?.addEventListener("click",()=>{
  if(doctorModalReadOnly())return;
  closeOrderToothPopover();
  syncOrderCaseDraftFromInputs();
  const anterior=[13,12,11,21,22,23,43,42,41,31,32,33];
  orderCaseDraft.selected=orderedSelectedTeeth(anterior);
  for(const t of orderCaseDraft.selected){
    orderCaseDraft.perTooth[t]??={
      type:"",
      shade:orderCaseDraft.shade||""
    };
  }
  renderOrderToothPicker();
  renderOrderToothDetails();
});
orderClearTeethBtn?.addEventListener("click",()=>{
  if(doctorModalReadOnly())return;
  closeOrderToothPopover();
  syncOrderCaseDraftFromInputs();
  orderCaseDraft.selected=[];
  orderCaseDraft.perTooth={};
  renderOrderToothPicker();
  renderOrderToothDetails();
});

function setPdfButtonLoading(button,loading,label="Pregătesc PDF..."){
  if(!button)return;

  if(loading){
    if(!button.dataset.originalHtml)button.dataset.originalHtml=button.innerHTML;
    button.disabled=true;
    button.classList.add("pdf-loading");
    button.innerHTML=`<span class="button-spinner" aria-hidden="true"></span><span>${label}</span>`;
  }else{
    button.disabled=false;
    button.classList.remove("pdf-loading");
    if(button.dataset.originalHtml){
      button.innerHTML=button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

async function runPdfAction(button,action){
  setPdfButtonLoading(button,true);
  try{
    // Paint the loading state before starting the async save/export work.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return await action();
  }finally{
    // Keep the feedback visible briefly so a fast response is still perceptible.
    setTimeout(()=>setPdfButtonLoading(button,false),350);
  }
}

orderCasePdfBtn?.addEventListener("click",()=>{
  runPdfAction(orderCasePdfBtn,()=>printOrderCaseSheet())
    .catch(err=>alert(`Case sheet export failed: ${err.message}`));
});

orderToothPopoverClose?.addEventListener("click",closeOrderToothPopover);
orderToothCancelBtn?.addEventListener("click",closeOrderToothPopover);
orderToothSaveBtn?.addEventListener("click",saveOrderToothPopover);
orderToothRemoveBtn?.addEventListener("click",removeActiveOrderTooth);
orderApplySameShade?.addEventListener("change",()=>{
  if(!orderToothShade)return;
  orderToothShade.disabled=!orderApplySameShade.checked;
  orderToothShade.placeholder=orderApplySameShade.checked
    ? "A1, A2, BL2..."
    : "Bifează pentru a aplica o culoare comună";
  if(orderApplySameShade.checked)orderToothShade.focus();
});

attachPartialAutocomplete(
  orderToothType,
  orderToothTypeSuggestions,
  ()=>toothTypeOptions()
);
attachPartialAutocomplete(
  patient,
  patientSuggestions,
  ()=>[...new Set(orders.map(o=>String(o.patient||"").trim()).filter(Boolean))]
);
attachPartialAutocomplete(
  partner,
  partnerSuggestions,
  ()=>[...new Set(orders.map(o=>String(o.partner||"").trim()).filter(Boolean))]
);


function refreshActiveToothTypePreview(){
  updateToothDetailBadge(orderToothType?.value||"");
  if(activeOrderTeeth.length>1){
    orderToothPreview.innerHTML=batchPreviewHtml(activeOrderTeeth);
  }else if(activeOrderTooth!==null){
    orderToothPreview.innerHTML=toothPreviewSvg(activeOrderTooth,workTypeColor(orderToothType?.value||""));
  }
}
orderToothType?.addEventListener("input",refreshActiveToothTypePreview);
orderToothType?.addEventListener("change",refreshActiveToothTypePreview);

document.querySelectorAll("[data-tooth-view]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    orderToothViewMode=btn.dataset.toothView||"upperlower";
    renderOrderToothPicker();

    if(activeOrderTeeth.length){
      const batch=[...activeOrderTeeth];
      const last=batch[batch.length-1];
      const anchor=orderToothChart?.querySelector(`[data-tooth="${last}"]`)??null;
      openOrderToothPopover(last,anchor,{batch});
    }
  });
});


orderToothStage?.addEventListener("click",()=>{});


function openNativeDatePicker(input){
  if(!input)return;

  try{
    if(typeof input.showPicker==="function"){
      input.showPicker();
      return;
    }
  }catch(_err){
    // Browser may restrict showPicker() in some contexts.
  }

  input.focus();
  input.click();
}

document.querySelectorAll("[data-date-picker]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const input=document.getElementById(btn.dataset.datePicker||"");
    openNativeDatePicker(input);
  });
});

window.addEventListener("resize",()=>{
  if(orderToothPopover && !orderToothPopover.classList.contains("hidden")){
    positionOrderToothPopover(activeOrderToothAnchor);
  }
});


[orderToothType,orderToothShade,orderToothMethod,orderToothNote].forEach(el=>{
  el?.addEventListener("keydown",e=>{
    if(e.key!=="Enter")return;

    const suggestionBox=el===orderToothType
      ? orderToothTypeSuggestions
      : null;

    if(suggestionBox&&!suggestionBox.classList.contains("hidden"))return;

    e.preventDefault();
    saveOrderToothPopover();
  });
});



caseFileInput?.addEventListener("change",()=>{
  const {valid,errors}=validateCaseFileSelection([...caseFileInput.files||[]]);
  caseFileSelection=valid;
  renderCaseFilesUI();
  if(errors.length)alert(errors.join("\n"));
});

caseFileUploadBtn?.addEventListener("click",()=>{
  uploadSelectedCaseFiles().catch(err=>alert(`Upload eșuat: ${err.message}`));
});

function openNewOrder(){
  try{
    if(!auth){
      throw new Error("You are not logged in.");
    }
    if(!can("Can_Create_Work_Orders")&&!isTechnician()){
      throw new Error("Your role is not allowed to create work orders.");
    }

    resetForm();
    setModalRoleMode();
    modalTitle.textContent="New work order";
    modalSubtitle.textContent=isTechnician()
      ? `Define the case visually; you will be auto-assigned as ${auth.user.Technician_Name} to the selected stage.`
      : isDoctor()
        ? `Adaugă lucrarea pentru ${auth.user.Partner_Name||"partenerul tău"}. Contractul și prețurile sunt mapate automat.`
        : "Define Project, teeth and Production in one screen.";

    initializeOrderCaseDraft(newOrderCaseDraft());
    openModal();
  }catch(err){
    console.error("openNewOrder failed:",err);
    alert(`Could not open New Work Order: ${err.message}`);
  }
}
window.openNewOrder=openNewOrder;

// Keep a JS listener too; the inline onclick is a fallback.
// Avoid double execution by only attaching when onclick is absent.
if(newOrderBtn && !newOrderBtn.getAttribute("onclick")){
  newOrderBtn.addEventListener("click",openNewOrder);
}
closeModalBtn.addEventListener("click",closeModal);cancelModalBtn.addEventListener("click",closeModal);
closeCaseSheetBtn?.addEventListener("click",closeCaseSheet);
cancelCaseSheetBtn?.addEventListener("click",closeCaseSheet);
saveCaseSheetBtn?.addEventListener("click",()=>saveActiveCaseSheet(true).catch(err=>alert(err.message)));
printCaseSheetBtn?.addEventListener("click",()=>{
  runPdfAction(printCaseSheetBtn,()=>printCaseSheet())
    .catch(err=>alert(err.message));
});
caseSheetBackdrop?.addEventListener("click",e=>{if(e.target===caseSheetBackdrop)closeCaseSheet();});

document.querySelectorAll(".nav-item,.mobile-nav-item[data-view]").forEach(b=>b.addEventListener("click",()=>{
  currentView=b.dataset.view;
  render();
  if(isMobileLayout())closeMobileDrawers();
}));

sidebarCollapseBtn?.addEventListener("click",()=>setSidebarCollapsed(true));
sidebarExpandBtn?.addEventListener("click",()=>setSidebarCollapsed(false));
aiCollapseBtn?.addEventListener("click",()=>setAiCollapsed(true));
aiExpandBtn?.addEventListener("click",()=>setAiCollapsed(false));

mobileMenuBtn?.addEventListener("click",openMobileMenu);
mobileSidebarCloseBtn?.addEventListener("click",closeMobileMenu);
mobileAiBtn?.addEventListener("click",()=>{
  if(aiPanel?.classList.contains("mobile-open"))closeMobileAi();
  else openMobileAi();
});
mobileAiCloseBtn?.addEventListener("click",closeMobileAi);
mobileBackdrop?.addEventListener("click",closeMobileDrawers);
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    if(orderToothPopover&&!orderToothPopover.classList.contains("hidden"))closeOrderToothPopover();
    else if(caseSheetBackdrop&&!caseSheetBackdrop.classList.contains("hidden"))closeCaseSheet();
    else closeMobileDrawers();
  }
});
window.addEventListener("resize",()=>{
  if(!isMobileLayout())closeMobileDrawers();
  applyDesktopPanelState();
  render();
});
loadOlderBtn?.addEventListener("click",async()=>{
  includeOlderOrders=!includeOlderOrders;
  try{
    await loadAll(true);
  }catch(err){
    includeOlderOrders=!includeOlderOrders;
    updateDatasetScope();
    alert(err.message);
  }
});

toggleOldBtn?.addEventListener("click",()=>{
  hideOldOrders=!hideOldOrders;
  localStorage.setItem("flowrise_hide_old_orders",String(hideOldOrders));
  render();
});
refreshBtn.addEventListener("click",()=>loadAll(true).catch(err=>alert(err.message)));
exportBtn?.addEventListener("click",()=>window.print());

function addMessage(role,text){
  const d=document.createElement("div");
  d.className=`msg ${role==="assistant"?"ai":"user"}`;
  d.textContent=text;
  chatMessages.appendChild(d);
  chatMessages.scrollTop=chatMessages.scrollHeight;
  return d;
}

function addThinkingMessage(initialText="Ruminez datele..."){
  const bubble=document.createElement("div");
  bubble.className="msg ai thinking-msg";
  bubble.innerHTML=`
    <div class="thinking-head">
      <span class="thinking-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      <span class="thinking-label">FlowRise AI</span>
    </div>
    <div class="thinking-status"></div>
  `;
  bubble.querySelector(".thinking-status").textContent=initialText;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop=chatMessages.scrollHeight;
  return bubble;
}

function updateThinkingMessage(bubble,text){
  if(!bubble?.isConnected)return;
  const status=bubble.querySelector(".thinking-status");
  if(status)status.textContent=text;
  chatMessages.scrollTop=chatMessages.scrollHeight;
}

function removeThinkingMessage(bubble){
  if(bubble?.isConnected)bubble.remove();
}
async function loadChatHistory(){
  if(!auth||!SESSION_ID)return;
  const epoch=authEpoch;
  const userId=auth.user.User_ID;
  const generation=activeChatGeneration;

  const data=await fetchJson(API.chatHistory,authPayload({session_id:SESSION_ID}));
  if(!requestContextValid(epoch,userId,generation))return;

  chatMessages.innerHTML="";
  const messages=Array.isArray(data?.messages)?data.messages:[];
  for(const m of messages)addMessage(m.Role==="assistant"?"assistant":"user",m.Message??"");

  if(!messages.length){
    addMessage(
      "assistant",
      isTechnician()
        ? `Salut ${auth.user.Name}. Sunt modul ghidat: pot vedea doar lucrarile tale si datele tale permise.`
        : `Salut ${auth.user.Name}. Management AI pastreaza contextul conversatiei in aceasta sesiune si poate gestiona CRUD sau analiza datele laboratorului.`
    );
  }
}
async function sendText(text){return fetchJson(API.ai,authPayload({session_id:SESSION_ID,text}));}

chatForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const text=chatInput.value.trim();
  if(!text)return;

  const requestEpoch=authEpoch;
  const requestUser=auth.user.User_ID;
  const requestGeneration=activeChatGeneration;

  addMessage("user",text);
  chatInput.value="";
  sendBtn.disabled=true;

  const progressMessages=isTechnician()
    ? [
        "Ruminez lucrările tale...",
        "Verific ce e pe masa ta...",
        "Pun statusurile cap la cap...",
        "Fac socotelile pentru etapele tale...",
        "Mai ruminez puțin...",
        "Verific încă o dată...",
        "Aproape gata...",
        "Pun răspunsul în ordine..."
      ]
    : [
        "Ruminez datele...",
        "Pun cap la cap informațiile...",
        "Fac un tur prin baza de date...",
        "Caut ce contează pentru întrebare...",
        "Verific lucrările relevante...",
        "Fac puțină contabilitate dentară...",
        "Verific de două ori...",
        "Mai ruminez puțin...",
        "Aproape gata...",
        "Pun răspunsul în ordine..."
      ];

  let progressIndex=0;
  const thinking=addThinkingMessage(progressMessages[progressIndex++]);

  const progressTimer=setInterval(()=>{
    const message=progressMessages[
      Math.min(progressIndex,progressMessages.length-1)
    ];
    updateThinkingMessage(thinking,message);
    if(progressIndex<progressMessages.length-1)progressIndex++;
  },25000);

  const longWaitTimer=setTimeout(()=>{
    updateThinkingMessage(
      thinking,
      "Încă ruminez. Cererea este activă și continui să lucrez la ea."
    );
  },8*60*1000);

  try{
    const data=await sendText(text);
    if(!requestContextValid(requestEpoch,requestUser,requestGeneration))return;
    trackAiOperationResponse(data);
    clearInterval(progressTimer);
    clearTimeout(longWaitTimer);
    removeThinkingMessage(thinking);

    addMessage("assistant",data?.reply??JSON.stringify(data));
    if(["create_work_order","update_work_order","delete_work_order"].includes(data?.type)||(data?.intent==="execute"&&data?.mutation?.ok)){
      await loadAll(false);
    }
  }catch(err){
    if(!requestContextValid(requestEpoch,requestUser,requestGeneration))return;
    clearInterval(progressTimer);
    clearTimeout(longWaitTimer);
    removeThinkingMessage(thinking);

    const isTimeout=String(err?.name||"")==="AbortError" ||
      String(err?.message||"").toLowerCase().includes("aborted");

    addMessage(
      "assistant",
      isTimeout
        ? "Cererea a durat prea mult. Motorul AI poate încă finaliza răspunsul."
        : `Request failed: ${err.message}`
    );
  }finally{
    sendBtn.disabled=false;
    chatInput.focus();
  }
});
chatInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();chatForm.requestSubmit();}});
document.querySelectorAll(".chip").forEach(b=>b.addEventListener("click",()=>{chatInput.value=b.dataset.prompt;chatInput.focus();}));

photoInput.addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  const requestEpoch=authEpoch,requestUser=auth.user.User_ID,requestGeneration=activeChatGeneration;
  addMessage("user",`📷 ${file.name}`);
  appendChatMessage("user",`📷 ${file.name}`).catch(()=>{});
  const thinking=addThinkingMessage("Privesc imaginea...");

  const progressTimer=setInterval(()=>{
    const statuses=[
      "Privesc imaginea...",
      "Caut detaliile importante...",
      "Leg imaginea de informațiile relevante...",
      "Mai ruminez puțin...",
      "Pun concluziile în ordine..."
    ];
    const i=Math.floor(Date.now()/25000)%statuses.length;
    updateThinkingMessage(thinking,statuses[i]);
  },25000);

  try{
    const fd=new FormData();
    fd.append("data",file);
    fd.append("input_type","image");
    fd.append("session_id",SESSION_ID);
    fd.append("client_request_id",aiClientRequestId());
    if(aiPendingOperation)fd.append("pending_operation",JSON.stringify(aiPendingOperation));

    const data=await fetchForm(API.ai,fd);
    if(!requestContextValid(requestEpoch,requestUser,requestGeneration))return;
    trackAiOperationResponse(data);
    removeThinkingMessage(thinking);
    addMessage("assistant",data?.reply??JSON.stringify(data));

    if(["create_work_order","update_work_order","delete_work_order"].includes(data?.type)||(data?.intent==="execute"&&data?.mutation?.ok)){
      await loadAll(false);
    }
  }catch(err){
    if(!requestContextValid(requestEpoch,requestUser,requestGeneration))return;
    removeThinkingMessage(thinking);
    addMessage("assistant",`Procesarea imaginii a eșuat: ${err.message}`);
  }finally{
    clearInterval(progressTimer);
    e.target.value="";
  }
});

async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){addMessage("assistant","Înregistrarea audio nu este suportată de acest browser.");return;}
  mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data);};
  mediaRecorder.onstop=async()=>{
    const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});
    mediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;mediaRecorder=null;isRecording=false;voiceBtn.classList.remove("recording");voiceBtn.textContent="🎙️";voiceState.textContent="";
    const requestEpoch=authEpoch,requestUser=auth.user.User_ID,requestGeneration=activeChatGeneration;
    addMessage("user","🎙️ Mesaj vocal");
    appendChatMessage("user","🎙️ Mesaj vocal").catch(()=>{});
    const thinking=addThinkingMessage("Ascult mesajul...");

    const voiceProgress=setInterval(()=>{
      const statuses=[
        "Ascult mesajul...",
        "Pun cuvintele în ordine...",
        "Caut datele relevante...",
        "Mai ruminez puțin...",
        "Pregătesc răspunsul..."
      ];
      const i=Math.floor(Date.now()/25000)%statuses.length;
      updateThinkingMessage(thinking,statuses[i]);
    },25000);

    try{
      const fd=new FormData();
      fd.append("data",blob,"voice.webm");
      fd.append("input_type","audio");
      fd.append("session_id",SESSION_ID);
      fd.append("client_request_id",aiClientRequestId());
      if(aiPendingOperation)fd.append("pending_operation",JSON.stringify(aiPendingOperation));

      const data=await fetchForm(API.ai,fd);
      if(!requestContextValid(requestEpoch,requestUser,requestGeneration))return;
      trackAiOperationResponse(data);
      removeThinkingMessage(thinking);
      addMessage("assistant",data?.reply??JSON.stringify(data));
      if(data?.reply)appendChatMessage("assistant",data.reply).catch(()=>{});

      if(["create_work_order","update_work_order","delete_work_order"].includes(data?.type)||(data?.intent==="execute"&&data?.mutation?.ok)){
        await loadAll(false);
      }
    }catch(err){
      removeThinkingMessage(thinking);
      addMessage("assistant",`Voice failed: ${err.message}`);
    }finally{
      clearInterval(voiceProgress);
    }
  };
  mediaRecorder.start();isRecording=true;voiceBtn.classList.add("recording");voiceBtn.textContent="⏹️";voiceState.textContent="Recording — press stop";
}
voiceBtn.addEventListener("click",async()=>{try{if(isRecording&&mediaRecorder){voiceState.textContent="Stopping...";mediaRecorder.stop();}else await startRecording();}catch(err){addMessage("assistant",`Microphone error: ${err.message}`);}});

newChatBtn.addEventListener("click",()=>{
  startFreshSession(auth.user.User_ID);
  addMessage("assistant","Conversatie noua. Istoricul anterior ramane salvat separat.");
});


/* ========================================================================== 
   V16 — SUPABASE OPERATIONAL CUTOVER + LIGHT UI SUPPORT
   Operational source of truth: Supabase.
   n8n remains transitional for AI, chat history, Calendar, Materials and Admin Users.
   ========================================================================== */

let labOrganizationId=null;

saveAuth=function(a){
  sessionStorage.setItem("dental_lab_auth",JSON.stringify({
    appVersion:"V16",
    user:a.user,
    permissions:a.permissions,
    password:a.password,
    supabaseProfile:a.supabaseProfile||null,
    loginIdentifier:a.loginIdentifier||""
  }));
};
loadSavedAuth=function(){
  try{
    const x=JSON.parse(sessionStorage.getItem("dental_lab_auth")||"null");
    if(x?.appVersion==="V16"&&x?.user?.User_ID&&x?.password&&x?.supabaseProfile?.id)return x;
  }catch{}
  return null;
};

function isDashboard(){return String(auth?.user?.Role||"").toLowerCase()==="dashboard";}

async function sbRpc(name,args={}){
  if(!supabaseClient)throw new Error("Conexiunea cu baza de date nu este disponibilă.");
  const {data,error}=await supabaseClient.rpc(name,args);
  if(error)throw new Error(error.message||`Operațiunea în baza de date a eșuat.`);
  return data;
}

async function resolveLabOrganizationId(force=false){
  if(labOrganizationId&&!force)return labOrganizationId;
  const id=await sbRpc("get_flowrise_lab_id");
  if(!id)throw new Error("Laboratorul Flowrise nu a fost găsit în baza de date.");
  labOrganizationId=String(id);
  return labOrganizationId;
}

function legacyPermissionsFromRow(r={}){
  return {
    Work_Order_Scope:r.work_order_scope||"All",
    Can_View_Work_Orders:Boolean(r.can_view_work_orders),
    Can_View_Production:Boolean(r.can_view_production),
    Can_View_Partners:Boolean(r.can_view_partners),
    Can_View_Technicians:Boolean(r.can_view_technicians),
    Can_Create_Work_Orders:Boolean(r.can_create_work_orders),
    Can_Edit_All_Work_Orders:Boolean(r.can_edit_all_work_orders),
    Can_Edit_Own_Stage_Status:Boolean(r.can_edit_own_stage_status),
    Can_Assign_Technicians:Boolean(r.can_assign_technicians),
    Can_View_Client_Pricing:Boolean(r.can_view_client_pricing),
    Can_View_Other_Technician_Costs:Boolean(r.can_view_other_technician_costs),
    Can_View_Own_Technician_Cost:Boolean(r.can_view_own_technician_cost),
    Can_Edit_Payment_Status:Boolean(r.can_edit_payment_status),
    Can_Edit_Global_Status:Boolean(r.can_edit_global_status),
    Can_Access_Backend:Boolean(r.can_access_backend),
    AI_Flow:r.ai_flow||"",
    Active:Boolean(r.active),
    Can_Edit_Partner_Work_Orders:Boolean(r.can_edit_partner_work_orders)
  };
}

// autentificarea securizată + Supabase memberships are the primary identity layer in V16.
// Password is kept only in session memory/storage for the remaining legacy n8n modules.
login=async function(identifier,password){
  const cleanIdentifier=String(identifier||"").trim().toLowerCase();
  if(!cleanIdentifier)throw new Error("Introdu nickname-ul sau emailul.");

  const sb=await supabaseIdentifierLogin(cleanIdentifier,password);
  const labId=await resolveLabOrganizationId(true);

  const [roleRaw,legacyUserId,technicianName,partnerName]=await Promise.all([
    sbRpc("effective_lab_role",{p_lab_organization_id:labId}),
    sbRpc("current_legacy_user_id"),
    sbRpc("current_technician_name"),
    sbRpc("current_partner_name")
  ]);

  const role=String(roleRaw||"").trim();
  if(!role){
    await supabaseClient?.auth.signOut({scope:"local"}).catch(()=>{});
    throw new Error("Contul nu are un rol activ pentru Flowrise Dental Lab sau o clinică conectată.");
  }

  const {data:roleRows,error:roleError}=await supabaseClient
    .from("role_permissions")
    .select("*")
    .ilike("role",role)
    .eq("active",true)
    .limit(1);
  if(roleError)throw new Error(roleError.message);
  const roleRow=roleRows?.[0];
  if(!roleRow)throw new Error(`Permisiunile pentru rolul ${role} nu sunt configurate.`);

  const canonicalRole=String(roleRow.role||role);
  const legacyId=String(legacyUserId||sb.profile.legacy_user_id||"").trim();
  if(!legacyId)throw new Error("Profilul nu are legacy_user_id configurat.");

  auth={
    user:{
      User_ID:legacyId,
      Email:sb.profile.email||"",
      Name:sb.profile.display_name||sb.profile.username||legacyId,
      Role:canonicalRole,
      Technician_Name:String(technicianName||""),
      Partner_Name:String(partnerName||""),
      Active:true
    },
    permissions:legacyPermissionsFromRow(roleRow),
    password,
    supabaseProfile:{...sb.profile,legacy_user_id:legacyId},
    loginIdentifier:cleanIdentifier
  };

  authEpoch++;
  saveAuth(auth);
  startFreshSession(auth.user.User_ID);
};

const applyRoleUIV15=applyRoleUI;
applyRoleUI=function(){
  applyRoleUIV15();
  appShell.classList.remove("dashboard-role-mode");
  if(isDashboard()){
    aiMode.textContent="Dashboard read-only";
    appShell.classList.add("doctor-role-mode","dashboard-role-mode");
    mobileAiBtn?.classList.add("hidden");
    aiExpandBtn?.classList.add("hidden");
    aiPanel?.classList.remove("mobile-open");

    // Dashboard is intentionally restricted to exactly two operational sections:
    // Work Orders + Production. Everything else is hidden, including AI.
    const allowedDashboardViews=new Set(["workorders","production"]);
    document.querySelectorAll(".nav-item,.mobile-nav-item[data-view]").forEach(el=>{
      const view=String(el.dataset.view||"");
      el.classList.toggle("hidden",!allowedDashboardViews.has(view));
    });
    document.querySelectorAll(".doctor-management-only,.management-only,.admin-only,.doctor-hidden")
      .forEach(el=>{
        const view=String(el.dataset?.view||"");
        if(!allowedDashboardViews.has(view))el.classList.add("hidden");
      });

    if(!allowedDashboardViews.has(currentView))currentView="workorders";
  }
};

function costStageKey(value){
  const n=normalize(value);
  if(n==="model")return "model";
  if(n==="modelare")return "modelare";
  if(["cerfin","ceramicafinisare","ceramicaﬁnisare"].includes(n))return "cerfin";
  return n;
}

function mapSupabaseOrder(r){
  const items=Array.isArray(r.items)?r.items:[];
  const itemScope=deriveWorkOrderScope(items,{validate:false});
  const types=Array.isArray(r.work_types)&&r.work_types.length?r.work_types:itemScope.work_types;
  const elementsCount=num(r.element_count??itemScope.element_count);
  const discountValue=r.discount===null||r.discount===undefined?0:num(r.discount);
  const list=num(r.snapshot_list_price??r.list_price);
  const final=num(r.snapshot_final_price??r.final_price);

  const modelTechName=r.tehnician_model??"";
  const modelingTechName=r.tehnician1_modelare??"";
  const ceramicTechName=r.tehnician2_cer_fin??"";
  const modelNA=Boolean(r.model_not_applicable);
  const modelingNA=Boolean(r.modelare_not_applicable);
  const ceramicNA=Boolean(r.cer_fin_not_applicable);

  const costModel=modelNA?0:num(r.cost_model);
  const costModeling=modelingNA?0:num(r.cost_modelare);
  const costCerFin=ceramicNA?0:num(r.cost_cer_fin);

  const ownTech=normalize(auth?.user?.Technician_Name||"");
  const myStages=[];
  let ownCost=0;
  if(ownTech){
    if(!modelNA&&normalize(modelTechName)===ownTech){myStages.push({stage:"Model",status:r.status_model??"Not Started",cost:costModel,paid:null});ownCost+=costModel;}
    if(!modelingNA&&normalize(modelingTechName)===ownTech){myStages.push({stage:"Modelare",status:r.status_modelare??"Not Started",cost:costModeling,paid:null});ownCost+=costModeling;}
    if(!ceramicNA&&normalize(ceramicTechName)===ownTech){myStages.push({stage:"Cer_Fin",status:r.status_cer_fin??"Not Started",cost:costCerFin,paid:null});ownCost+=costCerFin;}
  }

  return {
    id:num(r.id),
    deadline:r.deadline??"",
    receptionDate:r.data_receptie??"",
    status:r.status??"Not Started",
    patient:r.nume_pacient??"",
    partner:r.nume_partener??"",
    contract:r.contract??(isDoctor()||isTechnician()?"General":""),
    items,
    workTypes:types,
    workType:r.work_type_summary??itemScope.work_type_summary,
    elements:elementsCount,
    modelTech:modelTechName,
    modelingTech:modelingTechName,
    ceramicTech:ceramicTechName,
    statusModel:r.status_model??"Not Started",
    statusModeling:r.status_modelare??"Not Started",
    statusCerFin:r.status_cer_fin??"Not Started",
    modelNotApplicable:modelNA,
    modelingNotApplicable:modelingNA,
    ceramicNotApplicable:ceramicNA,
    paidModel:r.paid_model??"Not Paid",
    paidModeling:r.paid_modelare??"Not Paid",
    paidCerFin:r.paid_cer_fin??"Not Paid",
    discount:discountValue,
    listPrice:list,
    finalPrice:final,
    costModel,
    costModeling,
    costCerFin,
    totalTechCost:num(r.total_technician_cost??(costModel+costModeling+costCerFin)),
    myStages,
    ownCost,
    clinicNote:"",
    locked:boolish(r.locked)
  };
}

function cutoffDate45(){
  const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-45);
  return d.toISOString().slice(0,10);
}

function applyDefaultOrderWindow(all){
  if(includeOlderOrders)return [...all];
  const cutoff=cutoffDate45();
  return all.filter(o=>!o.deadline||String(o.deadline).slice(0,10)>=cutoff);
}

let legacyAdminCache=null;
let legacyAdminCacheUser="";
const clearAuthV15=clearAuth;
clearAuth=function(options={}){
  labOrganizationId=null;legacyAdminCache=null;legacyAdminCacheUser="";technicianSalaryRows=[];
  return clearAuthV15(options);
};
async function loadLegacyAdminUsersSafe(){
  if(!isAdmin()||RUNTIME_CONFIG?.legacyModules?.adminUsers===false)return {users:[],roles:[]};
  const currentUser=String(auth?.user?.User_ID||"");
  if(legacyAdminCache&&legacyAdminCacheUser===currentUser)return legacyAdminCache;
  try{
    const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error("legacy admin timeout")),4500));
    const data=await Promise.race([fetchJson(API.adminConfig,authPayload({action:"list"})),timeout]);
    legacyAdminCache={
      users:Array.isArray(data?.users)?data.users:[],
      roles:Array.isArray(data?.roles)?data.roles:[]
    };
    legacyAdminCacheUser=currentUser;
    return legacyAdminCache;
  }catch(err){
    console.warn("Legacy Admin Users unavailable:",err);
    return {users:[],roles:[]};
  }
}

loadAll=async function(show=true){
  if(!auth)throw new Error("Neautentificat");
  const epoch=authEpoch;
  const userId=auth.user.User_ID;
  if(show)showLoading("Actualizez","Pun datele în ordine...");

  try{
    const labId=await resolveLabOrganizationId();

    const woPromise=sbRpc("get_my_work_orders_v188",{p_lab_organization_id:labId});
    const refPromise=sbRpc("get_work_order_reference_data",{p_lab_organization_id:labId});
    const salaryPromise=isTechnician()
      ? sbRpc("get_my_salary",{p_lab_organization_id:labId})
      : Promise.resolve([]);
    const costsPromise=isManagement()
      ? supabaseClient
          .from("lab_technician_costs")
          .select("source_row_no,legacy_id,tehnician,tip_lucrare,etapa,cost")
          .eq("lab_organization_id",labId)
          .order("source_row_no",{ascending:true})
      : Promise.resolve({data:[],error:null});

    const adminPricesPromise=isAdmin()
      ? supabaseClient.from("lab_contract_work_prices").select("id,contract,tip_lucrare,pret").eq("lab_organization_id",labId).order("contract").order("tip_lucrare")
      : Promise.resolve({data:[],error:null});
    const adminTypesPromise=isAdmin()
      ? supabaseClient.from("lab_work_types").select("id,tip_lucrare,active").eq("lab_organization_id",labId).order("tip_lucrare")
      : Promise.resolve({data:[],error:null});
    const legacyAdminPromise=loadLegacyAdminUsersSafe();

    const [woRows,ref,salaryData,costRes,adminPriceRes,adminTypeRes,legacyAdmin]=await Promise.all([
      woPromise,refPromise,salaryPromise,costsPromise,adminPricesPromise,adminTypesPromise,legacyAdminPromise
    ]);

    if(!requestContextValid(epoch,userId))return;
    if(costRes.error)throw new Error(costRes.error.message);
    if(adminPriceRes.error)throw new Error(adminPriceRes.error.message);
    if(adminTypeRes.error)throw new Error(adminTypeRes.error.message);

    const refObj=ref&&typeof ref==="object"?ref:{};
    priceRules=Array.isArray(refObj.contract_prices)
      ? refObj.contract_prices.map(r=>({ID:r.id,Contract:r.contract,Tip_Lucrare:r.tip_lucrare,Pret:num(r.pret)}))
      : [];
    technicianCostRules=Array.isArray(costRes.data)
      ? costRes.data.map(r=>({
          ID:r.source_row_no,
          Legacy_ID:r.legacy_id,
          Tehnician:r.tehnician,
          Tip_Lucrare:r.tip_lucrare,
          Etapa:r.etapa,
          Cost:r.cost===null?null:num(r.cost)
        }))
      : [];

    workTypes=Array.isArray(refObj.work_types)
      ? refObj.work_types.map(r=>String(r.tip_lucrare||"")).filter(Boolean)
      : [];
    technicians=Array.isArray(refObj.technicians)&&refObj.technicians.length
      ? refObj.technicians.map(r=>String(r.technician_name||r.display_name||"")).filter(Boolean)
      : (isTechnician()?[auth.user.Technician_Name].filter(Boolean):[]);

    contracts=[...new Set(priceRules.map(r=>String(r.Contract||"")).filter(Boolean))];
    if(!contracts.length&&(isDoctor()||isTechnician()))contracts=["General"];

    statuses=["Not Started","Started","Finished","Shipped","List Sent","Paid"];
    stageStatuses=["Not Started","Started","Finished"];
    paidStatuses=["Paid","Not Paid"];

    technicianSalaryRows=Array.isArray(salaryData)?salaryData.map(row=>({
      workOrderId:num(row.work_order_id),
      stageKey:String(row.stage_key||""),
      stageLabel:String(row.stage_label||row.stage_key||""),
      stageStatus:String(row.stage_status||"Not Started"),
      paymentStatus:String(row.payment_status||"Not Paid"),
      unitCost:num(row.unit_cost),
      amount:num(row.amount)
    })):[];

    const salaryByOrder=new Map();
    technicianSalaryRows.forEach(row=>{
      if(!salaryByOrder.has(row.workOrderId))salaryByOrder.set(row.workOrderId,[]);
      salaryByOrder.get(row.workOrderId).push(row);
    });

    const mappedAll=(Array.isArray(woRows)?woRows:[]).map(mapSupabaseOrder).map(order=>{
      const salaryStages=salaryByOrder.get(order.id)||[];
      if(isTechnician()){
        order.salaryStages=salaryStages;
        order.ownCost=salaryStages.reduce((sum,stage)=>sum+num(stage.amount),0);
        order.myStages=(order.myStages||[]).map(stage=>{
          const salary=salaryStages.find(row=>costStageKey(row.stageKey)===costStageKey(stage.stage));
          return salary?{...stage,cost:salary.amount,paid:salary.paymentStatus}:stage;
        });
      }
      return order;
    });
    orders=applyDefaultOrderWindow(mappedAll);
    workOrderScope={
      include_older:includeOlderOrders,
      days:45,
      returned:orders.length,
      total:mappedAll.length,
      cutoff_date:cutoffDate45()
    };
    updateDatasetScope();

    if(isAdmin()){
      const prices=(adminPriceRes.data||[]).map((r,i)=>({
        ID:i+1,
        _supabase_id:String(r.id),
        Contract:r.contract,
        Tip_Lucrare:r.tip_lucrare,
        Pret:num(r.pret)
      }));
      const types=(adminTypeRes.data||[]).map(r=>({ID:num(r.id),Tip_Lucrare:r.tip_lucrare,Active:Boolean(r.active)}));
      const costs=technicianCostRules.map(r=>({...r}));
      adminConfigData={
        prices,
        technicianCosts:costs,
        workTypes:types,
        contracts:[...new Set(prices.map(r=>r.Contract).filter(Boolean))],
        users:legacyAdmin.users||[],
        roles:(legacyAdmin.roles||[]).length?legacyAdmin.roles:["Admin","Manager","Technician","Doctor","Dashboard"]
      };
    }else{
      adminConfigData={prices:[],technicianCosts:[],workTypes:[],contracts:[],users:[],roles:[]};
    }

    calendarLoaded=false;
    materialsLoaded=false;
    lastRefresh.textContent=`Actualizat ${new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
    setConnection(true,"Baza de date conectată");
    render();
  }catch(err){
    if(requestContextValid(epoch,userId)){
      setConnection(false,"Conexiune indisponibilă");
      if(String(err.message).toLowerCase().includes("jwt")||String(err.message).toLowerCase().includes("session")){
        clearAuth();showLogin();
      }
    }
    throw err;
  }finally{
    if(show)hideLoading();
  }
};

// V18.16: pricing is calculated by Supabase from every configured tooth.
// This keeps Doctor commercial access restricted and gives all editable roles
// exactly the same Partner -> dedicated contract -> General fallback rules.
let toothPriceEstimateTimer=null;
let toothPriceEstimateRequest=0;

function renderToothPriceBreakdown(result={}){
  const box=$("priceBreakdown");
  const lines=(Array.isArray(result.lines)?result.lines:[]).map(line=>({
    workType:String(line?.work_type??line?.workType??"—"),
    quantity:Math.max(0,num(line?.quantity??1)),
    contract:String(line?.contract||"General"),
    itemPrice:num(line?.unit_price??line?.pret),
    subtotal:num(line?.subtotal??line?.line_total),
    matched:Boolean(line?.matched)
  }));
  const list=num(result.list_price);
  const total=num(result.final_price);
  const appliedDiscount=Math.max(0,Math.min(100,num(result.discount)));
  if(box){
    box.innerHTML=lines.length?`
      <div class="price-breakdown-scroll">
        <table class="price-breakdown-table">
          <colgroup>
            <col class="price-col-type"><col class="price-col-count"><col class="price-col-unit"><col class="price-col-subtotal">
          </colgroup>
          <thead><tr><th>Tip</th><th>Nr. Elem.</th><th>Preț / Elem</th><th>Subtotal</th></tr></thead>
          <tbody>${lines.map(line=>`
            <tr class="${line.matched?"":"price-breakdown-unmatched"}">
              <td><strong>${escapeHtml(line.workType)}</strong>${isManagement()?`<small>Contract: ${escapeHtml(line.contract)}</small>`:""}</td>
              <td>${line.quantity}</td>
              <td>${money(line.itemPrice)}</td>
              <td><strong>${money(line.subtotal)}</strong></td>
            </tr>`).join("")}</tbody>
          <tfoot>
            ${appliedDiscount?`<tr><td colspan="3">Total înainte de discount</td><td>${money(list)}</td></tr>
            <tr><td colspan="3">Discount</td><td>${appliedDiscount}%</td></tr>`:""}
            <tr class="price-breakdown-total"><td colspan="3">Total</td><td>${money(total)}</td></tr>
          </tfoot>
        </table>
      </div>
    `:"";
  }

  const count=Math.max(0,num(result.element_count));
  listPrice.value=list;
  finalPrice.value=total;

  const firstContract=lines[0]?.contract;
  if(firstContract)setFormContractValue(firstContract);
  if(lines.length&&!result.matched_all){
    const missing=lines.filter(line=>!line.matched).map(line=>line.workType).join(", ");
    priceHint.textContent=`Lipsesc prețuri pentru: ${missing}. Liniile respective au valoarea 0.`;
    priceHint.classList.add("error-text");
  }else if(lines.length){
    priceHint.textContent=`${count} ${count===1?"element":"elemente"} · ${lines.length} ${lines.length===1?"tip de lucrare":"tipuri de lucrare"}`;
    priceHint.classList.remove("error-text");
  }
}

async function requestToothPriceEstimate(requestId,items){
  try{
    const result=await sbRpc("estimate_work_order_items",{
      p_lab_organization_id:await resolveLabOrganizationId(),
      p_partner_name:String(partner?.value||""),
      p_requested_contract:String(contract?.value||"General"),
      p_items:items,
      p_discount:isDoctor()?0:Math.max(0,Math.min(100,num(discount?.value)))
    });
    if(requestId!==toothPriceEstimateRequest||isTechnician())return;
    renderToothPriceBreakdown(result||{});
  }catch(err){
    if(requestId!==toothPriceEstimateRequest||isTechnician())return;
    listPrice.value=0;
    finalPrice.value=0;
    const box=$("priceBreakdown");
    if(box)box.innerHTML="";
    priceHint.textContent=`Estimarea nu a putut fi încărcată din baza de date: ${err.message}`;
    priceHint.classList.add("error-text");
  }
}

recalcFormPrice=function(){
  if(isTechnician())return;
  const saved=currentModalOrder();
  if(saved&&Number(orderId?.value)===Number(saved.id)){
    listPrice.value=num(saved.listPrice);
    finalPrice.value=num(saved.finalPrice);
    const box=$("priceBreakdown");
    if(box)box.innerHTML="";
    priceHint.textContent="Totalurile sunt instantanee financiare salvate pentru această lucrare.";
    priceHint.classList.remove("error-text");
    return;
  }
  clearTimeout(toothPriceEstimateTimer);
  const requestId=++toothPriceEstimateRequest;
  const items=workOrderToothItems().filter(item=>item.work_type);
  const missing=workOrderToothItems().filter(item=>!item.work_type);
  if(!items.length){
    listPrice.value=0;
    finalPrice.value=0;
    const box=$("priceBreakdown");
    if(box)box.innerHTML="";
    priceHint.textContent="Selectează un dinte și configurează tipul lucrării pentru estimarea prețului.";
    priceHint.classList.remove("error-text");
    return;
  }
  if(missing.length){
    listPrice.value=0;
    finalPrice.value=0;
    const box=$("priceBreakdown");
    if(box)box.innerHTML="";
    priceHint.textContent=`Configurează tipul lucrării pentru dinții: ${missing.map(item=>item.tooth_number).join(", ")}.`;
    priceHint.classList.add("error-text");
    return;
  }
  priceHint.textContent="Calculez estimarea din baza de date...";
  priceHint.classList.remove("error-text");
  toothPriceEstimateTimer=setTimeout(()=>requestToothPriceEstimate(requestId,items),180);
};

fetchPatientCase=async function(workOrderId){
  const labId=await resolveLabOrganizationId();
  const rows=await sbRpc("get_patient_case",{
    p_lab_organization_id:labId,
    p_work_order_id:Number(workOrderId)
  });
  const row=Array.isArray(rows)?rows[0]:rows;
  if(!row)return null;

  let parsed={};
  try{parsed=row.tooth_details_json?JSON.parse(row.tooth_details_json):{};}catch{parsed={};}
  const snapshot=parsed&&typeof parsed.__case==="object"?parsed.__case:{};
  const perTooth={...parsed};delete perTooth.__case;

  return {
    id:row.id,
    work_order_id:row.work_order_id,
    selected_teeth:String(row.selected_teeth||"").split(",").map(x=>Number(x.trim())).filter(Number.isFinite),
    tooth_details:perTooth,
    case_snapshot:snapshot,
    shade:row.shade||"",
    method:row.method||"",
    clinic_note:row.clinic_note||"",
    production_notes:row.production_notes||""
  };
};

persistPatientCase=async function(workOrderId,draft,{replaceItems=true}={}){
  const labId=await resolveLabOrganizationId();
  const data=caseDraftPayload(draft);
  if(isTechnician()){
    const ownStatuses={Status_Model:null,Status_Modelare:null,Status_Cer_Fin:null};
    orderForm?.querySelectorAll("[data-technician-stage-field]").forEach(select=>{
      if(Object.prototype.hasOwnProperty.call(ownStatuses,select.dataset.technicianStageField)){
        ownStatuses[select.dataset.technicianStageField]=select.value;
      }
    });
    const result=await sbRpc("save_my_work_order_case",{
      p_lab_organization_id:labId,
      p_work_order_id:Number(workOrderId),
      p_status_model:ownStatuses.Status_Model,
      p_status_modelare:ownStatuses.Status_Modelare,
      p_status_cer_fin:ownStatuses.Status_Cer_Fin,
      p_items:workOrderToothItems(draft),
      p_case:data
    });
    return {ok:true,ID:result};
  }
  const result=await sbRpc("upsert_patient_case",{
    p_lab_organization_id:labId,
    p_work_order_id:Number(workOrderId),
    p_items:workOrderToothItems(draft),
    p_case:data
  });
  return {ok:true,ID:result};
};

function outstandingAssignmentError(error){
  const match=String(error?.message||error||"").match(/OUTSTANDING_ASSIGNMENT:(modelare|cer_fin|model):([0-9]+(?:\.[0-9]+)?)/i);
  if(!match)return null;
  return {stage:match[1].toLowerCase(),amount:Number(match[2])};
}

function confirmKeepOutstanding({stage,amount}){
  const label={model:"Model",modelare:"Modelare",cer_fin:"Ceramică / Finisare"}[stage]||stage;
  const keep=window.confirm(
    `Etapa ${label} are un sold restant de ${money(amount)} pentru tehnicianul actual.\n\n`+
    `OK: păstrează soldul pe atribuirea veche și continuă reasignarea.\n`+
    `Anulează: oprește salvarea ca să poți înregistra plata înainte.`
  );
  if(!keep)throw new Error("Reasignarea a fost oprită. Înregistrează plata vechiului tehnician sau reia și păstrează soldul restant.");
  return "keep_outstanding";
}

async function saveManagementWorkOrderSupabase(id,fields,settlements={}){
  const labId=await resolveLabOrganizationId();
  const choices={...settlements};
  for(let attempt=0;attempt<4;attempt+=1){
    try{
      return await sbRpc("update_management_work_order_v188",{
        p_lab_organization_id:labId,
        p_work_order_id:Number(id),
        p_deadline:fields.Deadline||null,
        p_status:fields.Status||"Not Started",
        p_nume_pacient:fields.Nume_Pacient||"",
        p_nume_partener:fields.Nume_Partener||"",
        p_contract:fields.Contract||"General",
        p_discount:Number(fields.Discount)||0,
        p_data_receptie:fields.Data_Receptie||null,
        p_tehnician_model:fields.Tehnician_Model||null,
        p_tehnician1_modelare:fields.Tehnician1_Modelare||null,
        p_tehnician2_cer_fin:fields.Tehnician2_Cer_Fin||null,
        p_status_model:fields.Status_Model||"Not Started",
        p_status_modelare:fields.Status_Modelare||"Not Started",
        p_status_cer_fin:fields.Status_Cer_Fin||"Not Started",
        p_paid_model:fields.Paid_Model||"Not Paid",
        p_paid_modelare:fields.Paid_Modelare||"Not Paid",
        p_paid_cer_fin:fields.Paid_Cer_Fin||"Not Paid",
        p_model_not_applicable:Boolean(fields.Model_Not_Applicable),
        p_modelare_not_applicable:Boolean(fields.Modelare_Not_Applicable),
        p_cer_fin_not_applicable:Boolean(fields.Cer_Fin_Not_Applicable),
        p_locked:Boolean(fields.Locked),
        p_model_settlement:choices.model||null,
        p_modelare_settlement:choices.modelare||null,
        p_cer_fin_settlement:choices.cer_fin||null,
        p_items:currentOrderScope({validate:true}).items,
        p_case:caseDraftPayload(orderCaseDraft),
        p_requested_contract:String(fields.Contract||"General")
      });
    }catch(error){
      const outstanding=outstandingAssignmentError(error);
      if(!outstanding||choices[outstanding.stage])throw error;
      choices[outstanding.stage]=confirmKeepOutstanding(outstanding);
    }
  }
  throw new Error("Nu am putut confirma decontarea tuturor etapelor reasignate.");
}

async function handleSupabaseOrderSubmit(e){
  e.preventDefault();
  e.stopImmediatePropagation();
  syncOrderCaseDraftFromInputs();
  const id=num(orderId.value);
  saveOrderBtn.disabled=true;
  showLoading(id?"Actualizare lucrare":"Creare lucrare","Salvez lucrarea...");

  try{
    const scope=currentOrderScope({validate:true});
    const casePayload=caseDraftPayload(orderCaseDraft);
    const labId=await resolveLabOrganizationId();
    let savedId=id;

    if(isTechnician()){
      if(id){
        const current=orders.find(o=>Number(o.id)===id);
        if(!current)throw new Error("Lucrarea nu mai este disponibilă.");
        if(current.locked)throw new Error("Lucrarea este blocată și nu poate fi modificată.");
        await persistPatientCase(id,orderCaseDraft);
      }else{
        const fields=technicianCreateFields();
        savedId=Number(await sbRpc("create_technician_work_order",{
          p_lab_organization_id:labId,
          p_deadline:fields.Deadline||null,
          p_nume_pacient:fields.Nume_Pacient||"",
          p_nume_partener:fields.Nume_Partener||"",
          p_data_receptie:fields.Data_Receptie||null,
          p_my_stage:fields.My_Stage||"Model",
          p_items:scope.items,
          p_case:casePayload
        }));
      }
    }else if(isDoctor()){
      if(id&&doctorModalReadOnly())throw new Error("Lucrarea este read-only pentru medic.");
      const fields=doctorWorkOrderFields();
      if(id){
        await sbRpc("update_doctor_work_order",{
          p_lab_organization_id:labId,
          p_work_order_id:id,
          p_deadline:fields.Deadline||null,
          p_nume_pacient:fields.Nume_Pacient||"",
          p_items:scope.items,
          p_case:casePayload
        });
      }else{
        savedId=Number(await sbRpc("create_work_order",{
          p_lab_organization_id:labId,
          p_deadline:fields.Deadline||null,
          p_nume_pacient:fields.Nume_Pacient||"",
          p_nume_partener:null,
          p_contract:contract.value||"General",
          p_status:"Not Started",
          p_discount:0,
          p_data_receptie:null,
          p_items:scope.items,
          p_case:casePayload
        }));
      }
    }else{
      const fields=managementFields();
      const current=orders.find(o=>o.id===id);
      fields.Locked=current?.locked||false;
      if(id){
        await saveManagementWorkOrderSupabase(id,fields);
      }else{
        savedId=Number(await sbRpc("create_work_order",{
          p_lab_organization_id:labId,
          p_deadline:fields.Deadline||null,
          p_nume_pacient:fields.Nume_Pacient||"",
          p_nume_partener:fields.Nume_Partener||"",
          p_contract:fields.Contract||"General",
          p_status:fields.Status||"Not Started",
          p_discount:Number(fields.Discount)||0,
          p_data_receptie:fields.Data_Receptie||null,
          p_items:scope.items,
          p_case:casePayload
        }));
        // Persist the returned ID before the compatibility update. If that
        // second RPC fails, retry edits this row instead of creating a duplicate.
        orderId.value=String(savedId);
        if(orderCaseDraft)orderCaseDraft.orderId=savedId;
        await saveManagementWorkOrderSupabase(savedId,{...fields,Locked:false});
      }
    }

    if(savedId>0&&!id){
      orderId.value=String(savedId);
      if(orderCaseDraft)orderCaseDraft.orderId=savedId;
    }

    // V18.7: files selected while creating the Work Order stay queued locally.
    // Once Supabase returns the new ID, upload them through the existing signed
    // URL authorization flow. A partial failure keeps the modal open so the
    // failed files can be retried without creating a duplicate Work Order.
    if(savedId>0&&caseFileSelection.length){
      try{
        const loadingText=$("flowLoadingText");
        if(loadingText)loadingText.textContent=`Încarc fișierele lucrării #${savedId}...`;

        const uploadResult=await uploadSelectedCaseFiles({showFailureAlert:false});
        if(uploadResult.failures.length){
          setConnection(false,`Lucrarea #${savedId} salvată · unele fișiere necesită retry`);
          await loadAll(false);
          alert(
            `Lucrarea #${savedId} a fost creată, dar unele fișiere nu s-au încărcat. ` +
            `Formularul rămâne deschis pentru retry.\n\n${uploadResult.failures.join("\n")}`
          );
          return;
        }
      }catch(fileErr){
        setConnection(false,`Lucrarea #${savedId} salvată · upload fișiere în așteptare`);
        await loadAll(false);
        alert(
          `Lucrarea #${savedId} a fost creată, dar fișierele nu au putut fi încărcate. ` +
          `Formularul rămâne deschis pentru retry.\n\n${fileErr.message}`
        );
        return;
      }
    }

    await loadAll(false);
    setConnection(true,`Lucrarea #${savedId} salvată`);
    closeModal();
  }catch(err){
    alert(`Salvarea a eșuat: ${err.message}`);
  }finally{
    hideLoading();
    saveOrderBtn.disabled=false;
  }
}

// Capture phase prevents the legacy n8n submit listener from running in V16.
orderForm.addEventListener("submit",handleSupabaseOrderSubmit,true);

setOrderLock=async function(id,locked){
  if(!isManagement()||!can("Can_Edit_All_Work_Orders")){alert("Doar Admin / Manager poate modifica blocarea lucrării.");return;}
  showLoading(locked?"Blocare lucrare":"Deblocare lucrare",`Actualizez lucrarea #${id}...`);
  try{
    await sbRpc("set_work_order_lock",{p_lab_organization_id:await resolveLabOrganizationId(),p_work_order_id:Number(id),p_locked:Boolean(locked)});
    await loadAll(false);setConnection(true,locked?`Lucrarea #${id} blocată`:`Lucrarea #${id} deblocată`);
  }catch(err){alert(`Nu am putut modifica blocarea: ${err.message}`);}finally{hideLoading();}
};
window.setOrderLock=setOrderLock;

quickUpdate=async function(id,field,value){
  showLoading("Actualizare lucrare","Verific accesul și salvez...");
  const stageFieldMap={Status_Model:"statusModel",Status_Modelare:"statusModeling",Status_Cer_Fin:"statusCerFin"};
  const isOwnStageUpdate=isTechnician()&&Object.prototype.hasOwnProperty.call(stageFieldMap,field);
  try{
    const labId=await resolveLabOrganizationId();
    if(field==="Status"){
      await sbRpc("set_work_order_status",{p_lab_organization_id:labId,p_work_order_id:Number(id),p_status:value});
    }else if(["Paid_Model","Paid_Modelare","Paid_Cer_Fin"].includes(field)){
      const stage={Paid_Model:"model",Paid_Modelare:"modelare",Paid_Cer_Fin:"cer_fin"}[field];
      await sbRpc("set_stage_payment_status",{p_lab_organization_id:labId,p_work_order_id:Number(id),p_stage:stage,p_paid_status:value});
    }else if(["Status_Model","Status_Modelare","Status_Cer_Fin"].includes(field)&&isTechnician()){
      const stage={Status_Model:"model",Status_Modelare:"modelare",Status_Cer_Fin:"cer_fin"}[field];
      await sbRpc("update_my_stage_status",{p_lab_organization_id:labId,p_work_order_id:Number(id),p_stage:stage,p_status:value});
    }else if(isManagement()){
      const map={
        Status_Model:"status_model",Status_Modelare:"status_modelare",Status_Cer_Fin:"status_cer_fin",
        Tehnician_Model:"tehnician_model",Tehnician1_Modelare:"tehnician1_modelare",Tehnician2_Cer_Fin:"tehnician2_cer_fin"
      };
      const column=map[field];
      if(!column)throw new Error(`Câmp nesuportat: ${field}`);
      let settlement=null;
      try{
        await sbRpc("update_management_work_order_stage_field",{
          p_lab_organization_id:labId,p_work_order_id:Number(id),p_field:column,p_value:value,p_settlement:settlement
        });
      }catch(error){
        const outstanding=outstandingAssignmentError(error);
        if(!outstanding)throw error;
        settlement=confirmKeepOutstanding(outstanding);
        await sbRpc("update_management_work_order_stage_field",{
          p_lab_organization_id:labId,p_work_order_id:Number(id),p_field:column,p_value:value,p_settlement:settlement
        });
      }
    }else{
      throw new Error("Nu ai dreptul să modifici acest câmp.");
    }
    await loadAll(false);
  }catch(err){
    // The stage RPC may commit the technician's update and then surface a
    // secondary overall-status guard (for example when an older work order is
    // still marked Paid). Verify the persisted stage before showing an error.
    if(isOwnStageUpdate){
      try{
        await loadAll(false);
        const current=orders.find(order=>Number(order.id)===Number(id));
        if(current&&String(current[stageFieldMap[field]]??"")===String(value??"")){
          setConnection(true,"Etapa a fost actualizată");
          return;
        }
      }catch(_reloadErr){/* fall through to the real error below */}
    }
    alert(`Actualizarea a eșuat: ${err.message}`);
  }finally{hideLoading();}
};
window.quickUpdate=quickUpdate;

updateProductionStatusByDrop=async function(orderIdValue,newStatus,card,targetColumn){
  const order=orders.find(o=>Number(o.id)===Number(orderIdValue));if(!order)return;
  if(!allowedOrderStatuses(order).includes(newStatus)){
    clearProductionDragState();
    alert("Lucrarea poate trece într-un status final doar după finalizarea tuturor etapelor aplicabile.");
    return;
  }
  const previousStatus=String(order.status||"");if(previousStatus===newStatus){clearProductionDragState();return;}
  const targetList=targetColumn?.querySelector(".kanban-card-list");
  if(targetList&&card){targetList.appendChild(card);card.dataset.orderStatus=newStatus;const select=card.querySelector(".kanban-status-select");if(select)select.value=newStatus;card.classList.remove("dragging");card.classList.add("drag-saving");}
  clearProductionDragState();
  try{
    await sbRpc("set_work_order_status",{p_lab_organization_id:await resolveLabOrganizationId(),p_work_order_id:Number(orderIdValue),p_status:newStatus});
    await loadAll(false);setConnection(true,`Lucrarea #${orderIdValue}: ${uiText(newStatus)}`);
  }catch(err){if(currentView==="production")renderProduction();alert(`Nu am putut actualiza statusul lucrării #${orderIdValue}: ${err.message}`);}
};

deleteOrder=async function(id){
  const current=orders.find(x=>x.id===Number(id));
  const doctorDeleteAllowed=isDoctor()&&can("Can_Edit_Partner_Work_Orders")&&doctorCanModifyOrder(current);
  const managementDeleteAllowed=isManagement()&&can("Can_Edit_All_Work_Orders");
  if(isTechnician()||(!doctorDeleteAllowed&&!managementDeleteAllowed)){alert("Nu ai dreptul să ștergi această lucrare.");return;}
  if(!current){alert("Lucrarea nu a fost găsită.");return;}
  if(!confirm(`Ștergi lucrarea #${current.id}?\n\nPacient: ${current.patient||"-"}\nTip lucrare: ${current.workType||"-"}\n\nȘtergerea este permanentă.`))return;
  showLoading("Ștergere lucrare",`Șterg lucrarea #${current.id}...`);
  try{
    const fn=isDoctor()?"delete_doctor_work_order":"delete_management_work_order";
    await sbRpc(fn,{p_lab_organization_id:await resolveLabOrganizationId(),p_work_order_id:Number(current.id)});
    await loadAll(false);setConnection(true,`Lucrarea #${current.id} a fost ștearsă`);
  }catch(err){alert(`Ștergerea a eșuat: ${err.message}`);}finally{hideLoading();}
};
window.deleteOrder=deleteOrder;

/* ---------------- ADMIN CONFIG: SUPABASE CRUD ---------------- */

async function nextWorkTypeId(){
  const max=Math.max(0,...adminConfigData.workTypes.map(r=>num(r.ID)));
  return max+1;
}
async function nextCostSourceRow(){
  const max=Math.max(0,...adminConfigData.technicianCosts.map(r=>num(r.ID)));
  return max+1;
}
function adminPriceByUiId(id){return adminConfigData.prices.find(r=>String(r.ID)===String(id));}

async function supabaseAdminMutation(entity,action,data={}){
  const labId=await resolveLabOrganizationId();
  if(entity==="price"){
    if(action==="create"){
      const row={lab_organization_id:labId,id:`price_${crypto.randomUUID()}`,contract:String(data.Contract||"").trim(),tip_lucrare:String(data.Tip_Lucrare||"").trim(),pret:Number(data.Pret)||0};
      const {error}=await supabaseClient.from("lab_contract_work_prices").insert(row);if(error)throw new Error(error.message);return;
    }
    const current=adminPriceByUiId(data.ID);if(!current)throw new Error("Price row not found.");
    if(action==="update"){
      const {error}=await supabaseClient.from("lab_contract_work_prices").update({contract:String(data.Contract||"").trim(),tip_lucrare:String(data.Tip_Lucrare||"").trim(),pret:Number(data.Pret)||0,updated_at:new Date().toISOString()}).eq("lab_organization_id",labId).eq("id",current._supabase_id);if(error)throw new Error(error.message);return;
    }
    if(action==="delete"){
      const {error}=await supabaseClient.from("lab_contract_work_prices").delete().eq("lab_organization_id",labId).eq("id",current._supabase_id);if(error)throw new Error(error.message);return;
    }
  }
  if(entity==="contract"&&action==="delete"){
    const {error}=await supabaseClient.from("lab_contract_work_prices").delete().eq("lab_organization_id",labId).eq("contract",String(data.Contract||""));if(error)throw new Error(error.message);return;
  }
  if(entity==="work_type"){
    if(action==="create"){
      const {error}=await supabaseClient.from("lab_work_types").insert({lab_organization_id:labId,id:await nextWorkTypeId(),tip_lucrare:String(data.Tip_Lucrare||"").trim(),active:Boolean(data.Active)});if(error)throw new Error(error.message);return;
    }
    if(action==="update"){
      const {error}=await supabaseClient.from("lab_work_types").update({tip_lucrare:String(data.Tip_Lucrare||"").trim(),active:Boolean(data.Active),updated_at:new Date().toISOString()}).eq("lab_organization_id",labId).eq("id",Number(data.ID));if(error)throw new Error(error.message);return;
    }
    if(action==="delete"){
      const {error}=await supabaseClient.from("lab_work_types").delete().eq("lab_organization_id",labId).eq("id",Number(data.ID));if(error)throw new Error(error.message);return;
    }
  }
  if(entity==="cost"){
    if(action==="create"){
      const sourceRow=await nextCostSourceRow();
      const row={lab_organization_id:labId,source_row_no:sourceRow,legacy_id:`cost_${crypto.randomUUID()}`,tehnician:String(data.Tehnician||"").trim(),tip_lucrare:String(data.Tip_Lucrare||"").trim(),etapa:String(data.Etapa||"").trim(),cost:Number.isFinite(Number(data.Cost))?Number(data.Cost):null};
      const {error}=await supabaseClient.from("lab_technician_costs").insert(row);if(error)throw new Error(error.message);return;
    }
    if(action==="update"){
      const {error}=await supabaseClient.from("lab_technician_costs").update({tehnician:String(data.Tehnician||"").trim(),tip_lucrare:String(data.Tip_Lucrare||"").trim(),etapa:String(data.Etapa||"").trim(),cost:Number.isFinite(Number(data.Cost))?Number(data.Cost):null,updated_at:new Date().toISOString()}).eq("lab_organization_id",labId).eq("source_row_no",Number(data.ID));if(error)throw new Error(error.message);return;
    }
    if(action==="delete"){
      const {error}=await supabaseClient.from("lab_technician_costs").delete().eq("lab_organization_id",labId).eq("source_row_no",Number(data.ID));if(error)throw new Error(error.message);return;
    }
  }
  throw new Error(`Admin operation not supported: ${entity}/${action}`);
}

adminConfigRequest=async function(entity,action,data={}){
  if(!isAdmin())throw new Error("Admin access required");
  if(entity==="user"){
    if(RUNTIME_CONFIG?.legacyModules?.adminUsers===false)throw new Error("Administrarea utilizatorilor legacy este dezactivată.");
    showLoading("Configurare utilizator","Pregătesc conturile...");
    try{
      const result=await fetchJson(API.adminConfig,authPayload({entity,action,data}));
      if(!result?.ok)throw new Error(result?.reply||"Admin user update failed");
      legacyAdminCache=null;legacyAdminCacheUser="";
      await loadAll(false);currentView="adminconfig";renderAdminConfig();return result;
    }finally{hideLoading();}
  }
  showLoading("Salvare configurare","Salvez modificările...");
  try{
    await supabaseAdminMutation(entity,action,data);
    await loadAll(false);currentView="adminconfig";renderAdminConfig();return {ok:true};
  }finally{hideLoading();}
};

adminCreateManyRows=async function(rows,title,entityLabel){
  if(!isAdmin())throw new Error("Admin access required");
  if(!Array.isArray(rows)||!rows.length)return 0;
  showLoading(title,`Pregătesc ${rows.length} ${entityLabel}...`);
  let created=0;
  try{
    for(const item of rows){
      if($("flowLoadingText"))$("flowLoadingText").textContent=`${created+1}/${rows.length} · ${entityLabel}`;
      await supabaseAdminMutation(item.entity,item.action||"create",item.data);
      created++;
    }
    await loadAll(false);currentView="adminconfig";renderAdminConfig();return created;
  }finally{hideLoading();}
};

/* ---------------- ADMIN BULK CSV ---------------- */

function csvEscape(value){
  const s=value===null||value===undefined?"":String(value);
  return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function downloadTextFile(name,text,type="text/csv;charset=utf-8"){
  const blob=new Blob(["\ufeff",text],{type});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),300);
}
function detectCsvDelimiter(text){
  const firstLine=String(text||"").replace(/^\ufeff/,"").split(/\r?\n/).find(l=>l.trim()!=="")||"";
  const candidates=[",",";","\t"];
  let best=",",bestCount=-1;

  for(const delimiter of candidates){
    let quoted=false,count=0;
    for(let i=0;i<firstLine.length;i++){
      const c=firstLine[i];
      if(c==='"'){
        if(quoted&&firstLine[i+1]==='"'){i++;continue;}
        quoted=!quoted;
      }else if(!quoted&&c===delimiter){
        count++;
      }
    }
    if(count>bestCount){best=delimiter;bestCount=count;}
  }
  return best;
}

function parseCsv(text){
  const source=String(text||"").replace(/^\ufeff/,"");
  const delimiter=detectCsvDelimiter(source);
  const rows=[];let row=[],field="",quoted=false;

  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){
      if(c==='"'&&source[i+1]==='"'){field+='"';i++;}
      else if(c==='"')quoted=false;
      else field+=c;
    }else{
      if(c==='"')quoted=true;
      else if(c===delimiter){row.push(field);field="";}
      else if(c==='\n'){row.push(field);rows.push(row);row=[];field="";}
      else if(c!=='\r')field+=c;
    }
  }

  row.push(field);
  if(row.some(v=>String(v).trim()!=="")||rows.length===0)rows.push(row);

  const headers=(rows.shift()||[]).map(h=>String(h).trim().replace(/^\ufeff/,""));
  if(headers.length<2){
    throw new Error("Nu am putut detecta separatorul CSV. Sunt acceptate virgulă, punct și virgulă sau TAB.");
  }

  return {
    delimiter,
    rows:rows
      .filter(r=>r.some(v=>String(v).trim()!==""))
      .map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??""])))
  };
}

function csvValue(row,names){
  const keys=Object.keys(row);
  for(const name of names){
    const found=keys.find(k=>normalize(k)===normalize(name));
    if(found!==undefined)return row[found];
  }
  return "";
}

function parseCsvNumber(value,delimiter){
  let s=String(value??"").trim().replace(/\s/g,"");
  if(!s)return null;

  // Excel in RO commonly writes semicolon CSV + decimal comma.
  if(delimiter===";"&&s.includes(",")&&!s.includes(".")){
    s=s.replace(",",".");
  }else if(s.includes(",")&&s.includes(".")){
    // 1.234,56 -> 1234.56
    if(s.lastIndexOf(",")>s.lastIndexOf(".")){
      s=s.replace(/\./g,"").replace(",",".");
    }else{
      s=s.replace(/,/g,"");
    }
  }else{
    s=s.replace(",",".");
  }

  const n=Number(s);
  return Number.isFinite(n)?n:NaN;
}


function adminCsvDataset(kind){
  if(kind==="prices"){
    return {
      name:"contract_work_prices.csv",
      headers:["ID","Contract","Tip_Lucrare","Pret"],
      rows:adminConfigData.prices.map(r=>[
        r._supabase_id??r.ID??"",
        r.Contract??"",
        r.Tip_Lucrare??"",
        r.Pret??""
      ])
    };
  }

  if(kind==="types"){
    return {
      name:"work_types.csv",
      headers:["ID","Tip_Lucrare","Active"],
      rows:adminConfigData.workTypes.map(r=>[
        r.ID??"",
        r.Tip_Lucrare??"",
        Boolean(r.Active)
      ])
    };
  }

  if(kind==="costs"){
    return {
      name:"technician_costs.csv",
      headers:["Source_Row_No","ID","Tehnician","Tip_Lucrare","Etapa","Cost"],
      rows:adminConfigData.technicianCosts.map(r=>[
        r.ID??"",
        r.Legacy_ID??"",
        r.Tehnician??"",
        r.Tip_Lucrare??"",
        r.Etapa??"",
        r.Cost??""
      ])
    };
  }

  throw new Error(`Secțiune CSV necunoscută: ${kind}`);
}

function downloadAdminCsv(kind){
  if(!isAdmin())return;

  try{
    const data=adminCsvDataset(kind);

    // Use semicolon for better Romanian/European Excel compatibility.
    // Decimal values stay as stored; upload auto-detects ; and decimal comma/dot.
    const delimiter=";";
    const text=[data.headers,...data.rows]
      .map(row=>row.map(csvEscape).join(delimiter))
      .join("\r\n");

    downloadTextFile(data.name,text);
    setConnection(true,`CSV descărcat · ${data.rows.length} rânduri`);
  }catch(err){
    console.error("CSV download failed:",err);
    alert(`Download CSV eșuat: ${err.message}`);
  }
}
window.downloadAdminCsv=downloadAdminCsv;


async function uploadAdminCsv(kind,file){
  if(!isAdmin()||!file)return;

  const text=await file.text();
  let parsedInfo;
  try{
    parsedInfo=parseCsv(text);
  }catch(err){
    alert(`CSV invalid: ${err.message}`);
    return;
  }

  const parsed=parsedInfo.rows;
  const delimiter=parsedInfo.delimiter;

  if(!parsed.length){
    alert("CSV-ul nu conține rânduri.");
    return;
  }

  const modeRaw=window.prompt(
    "Mod import: scrie MERGE pentru adăugare/actualizare sau REPLACE pentru înlocuirea completă a secțiunii.",
    "MERGE"
  );
  if(modeRaw===null)return;

  const mode=String(modeRaw).trim().toUpperCase();
  if(!["MERGE","REPLACE"].includes(mode)){
    alert("Mod invalid. Folosește MERGE sau REPLACE.");
    return;
  }

  if(mode==="REPLACE"&&!confirm(
    `REPLACE va înlocui toate rândurile existente din această secțiune cu cele ${parsed.length} rânduri din CSV. Continui?`
  ))return;

  let rows;

  try{
    if(kind==="prices"){
      rows=parsed.map(r=>{
        const pret=parseCsvNumber(csvValue(r,["Pret","Price"]),delimiter);
        return {
          id:String(csvValue(r,["ID"])).trim(),
          contract:String(csvValue(r,["Contract"])).trim(),
          tip_lucrare:String(csvValue(r,["Tip_Lucrare","Tip Lucrare"])).trim(),
          pret:pret===null?"":pret
        };
      });

      if(rows.some(r=>!r.contract||!r.tip_lucrare||r.pret===""||!Number.isFinite(Number(r.pret)))){
        throw new Error("Pentru prețuri sunt obligatorii Contract, Tip_Lucrare și Pret numeric.");
      }

    }else if(kind==="types"){
      rows=parsed.map(r=>({
        id:String(csvValue(r,["ID"])).trim(),
        tip_lucrare:String(csvValue(r,["Tip_Lucrare","Tip Lucrare"])).trim(),
        active:String(csvValue(r,["Active"])||"true").trim()
      }));

      if(rows.some(r=>!r.tip_lucrare)){
        throw new Error("Pentru tipuri de lucrări, Tip_Lucrare este obligatoriu.");
      }

    }else if(kind==="costs"){
      rows=parsed.map(r=>{
        const raw=csvValue(r,["Cost"]);
        const cost=parseCsvNumber(raw,delimiter);
        return {
          source_row_no:String(csvValue(r,["Source_Row_No","Source Row No"])).trim(),
          legacy_id:String(csvValue(r,["ID","Legacy_ID","Legacy ID"])).trim(),
          tehnician:String(csvValue(r,["Tehnician","Technician"])).trim(),
          tip_lucrare:String(csvValue(r,["Tip_Lucrare","Tip Lucrare"])).trim(),
          etapa:String(csvValue(r,["Etapa","Stage"])).trim(),
          cost:String(raw).trim()===""?"":cost
        };
      });

      if(rows.some(r=>
        !r.tehnician||
        !r.tip_lucrare||
        !r.etapa||
        (r.cost!==""&&!Number.isFinite(Number(r.cost)))
      )){
        throw new Error("Pentru costuri sunt obligatorii Tehnician, Tip_Lucrare și Etapa; Cost trebuie să fie numeric sau gol.");
      }
    }else{
      throw new Error("Secțiune CSV necunoscută.");
    }
  }catch(err){
    alert(`CSV invalid: ${err.message}`);
    return;
  }

  showLoading("Import CSV",`${rows.length} rânduri · ${mode} · verific și import...`);

  try{
    const result=await sbRpc("admin_bulk_config_import",{
      p_kind:kind,
      p_mode:mode,
      p_rows:rows
    });

    await loadAll(false);
    currentView="adminconfig";
    renderAdminConfig();

    const imported=Number(result?.imported_rows??rows.length);
    setConnection(true,`CSV importat · ${imported} rânduri`);
    alert(`Import finalizat: ${imported} rânduri (${mode}).`);
  }catch(err){
    alert(`Import CSV eșuat: ${err.message}`);
  }finally{
    hideLoading();
  }
}
window.uploadAdminCsv=uploadAdminCsv;

const renderAdminConfigV15=renderAdminConfig;
renderAdminConfig=function(){
  renderAdminConfigV15();
  if(!isAdmin())return;
  pageSubtitle.textContent="Configurare laborator · prețuri, tipuri de lucrări și costuri";
  const kind=adminConfigTab;
  if(["prices","types","costs"].includes(kind)){
    const toolbar=document.querySelector(".admin-config-toolbar");
    if(toolbar&&!toolbar.querySelector(".admin-bulk-tools")){
      const tools=document.createElement("div");tools.className="admin-bulk-tools";
      tools.innerHTML=`<button class="secondary-btn" type="button" data-bulk-download>↓ Descarcă CSV</button><button class="secondary-btn" type="button" data-bulk-upload-btn>↑ Încarcă CSV</button><input type="file" accept=".csv,text/csv,text/plain" hidden data-bulk-upload><span class="admin-bulk-hint">CSV: virgulă / ; / TAB · MERGE sau REPLACE</span>`;
      toolbar.appendChild(tools);
      const fileInput=tools.querySelector("[data-bulk-upload]");
      tools.querySelector("[data-bulk-download]")?.addEventListener("click",()=>{
        if(typeof downloadAdminCsv!=="function"){
          alert("Funcția de export CSV nu este disponibilă.");
          return;
        }
        downloadAdminCsv(kind);
      });
      tools.querySelector("[data-bulk-upload-btn]")?.addEventListener("click",()=>fileInput?.click());
      fileInput?.addEventListener("change",async e=>{
        const f=e.target.files?.[0];
        e.target.value="";
        if(f)await uploadAdminCsv(kind,f);
      });
    }
  }else if(kind==="users"){
    const toolbar=document.querySelector(".admin-config-toolbar");
    if(toolbar&&!toolbar.querySelector(".legacy-admin-note")){
      const note=document.createElement("span");note.className="legacy-admin-note";note.textContent="Utilizatori: conturi securizate.";toolbar.appendChild(note);
    }
  }
};

// Keep remaining n8n calls configurable from one place.
authPayload=function(extra={}){
  return {user_id:auth.user.User_ID,password:auth.password,...extra};
};

// Legacy chat history must never block the Supabase operational application.
initializeApp=async function({showLoader=true}={}){
  if(!auth)throw new Error("Neautentificat");
  applyRoleUI();
  if(showLoader)showLoading("Conectare","Pregătesc datele operaționale...");
  try{
    await loadAll(false);
    if(!isDoctor()&&!isDashboard()&&RUNTIME_CONFIG?.legacyModules?.chatHistory!==false){
      try{await loadChatHistory();}catch(err){console.warn("Legacy chat history unavailable:",err);}
    }
  }finally{if(showLoader)hideLoading();}
};


async function initializeApp({showLoader=true}={}){
  if(!auth)throw new Error("Neautentificat");
  applyRoleUI();

  if(showLoader)showLoading("Connecting","Loading fresh permitted data...");

  try{
    await Promise.all([
      loadAll(false),
      isDoctor()?Promise.resolve():loadChatHistory()
    ]);
  }finally{
    if(showLoader)hideLoading();
  }
}


/* ==========================================================================
   V17 — COMPLETE SUPABASE CUTOVER
   n8n is used ONLY for /dental-lab-ai.
   ========================================================================== */

async function refreshSupabaseIdentity(){
  const identity=await sbRpc("get_app_identity",{});
  if(!identity?.ok)throw new Error(identity?.message||"Profilul de acces nu este disponibil.");

  auth={
    user:identity.user,
    permissions:identity.permissions,
    supabaseProfile:identity.profile,
    loginIdentifier:auth?.loginIdentifier||identity.profile?.username||""
  };
  saveAuth(auth);
  return auth;
}

saveAuth=function(a){
  sessionStorage.setItem("dental_lab_auth",JSON.stringify({
    appVersion:"V17",
    user:a.user,
    permissions:a.permissions,
    supabaseProfile:a.supabaseProfile||null,
    loginIdentifier:a.loginIdentifier||""
  }));
};

loadSavedAuth=function(){
  try{
    const x=JSON.parse(sessionStorage.getItem("dental_lab_auth")||"null");
    if(x?.appVersion==="V17"&&x?.user?.User_ID&&x?.supabaseProfile?.id)return x;
  }catch{}
  return null;
};

login=async function(identifier,password){
  const cleanIdentifier=String(identifier||"").trim().toLowerCase();
  if(!cleanIdentifier)throw new Error("Introdu nickname-ul sau emailul.");

  const sb=await supabaseIdentifierLogin(cleanIdentifier,password);
  auth={
    user:{},
    permissions:{},
    supabaseProfile:sb.profile,
    loginIdentifier:cleanIdentifier
  };

  try{
    await refreshSupabaseIdentity();
  }catch(err){
    await supabaseClient?.auth.signOut({scope:"local"}).catch(()=>{});
    auth=null;
    throw err;
  }

  authEpoch++;
  saveAuth(auth);
  startFreshSession(auth.user.User_ID);
};

authPayload=function(extra={}){
  return {...extra};
};

async function currentAccessToken(){
  const {data,error}=await supabaseClient.auth.getSession();
  if(error||!data?.session?.access_token)throw new Error("Sesiunea ta nu mai este validă.");
  return data.session.access_token;
}

async function fetchAiJson(body){
  const token=await currentAccessToken();
  const controller=new AbortController();
  activeControllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const r=await fetch(API.ai,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${token}`,
        "Cache-Control":"no-cache, no-store, max-age=0"
      },
      body:JSON.stringify(body),
      cache:"no-store",
      signal:controller.signal
    });
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null;}catch{data={reply:text};}
    if(!r.ok)throw new Error(data?.reply||data?.message||`${r.status} ${r.statusText}`);
    return data;
  }finally{
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

fetchForm=async function(url,formData){
  const token=await currentAccessToken();
  const controller=new AbortController();
  activeControllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const r=await fetch(url,{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${token}`,
        "Cache-Control":"no-cache, no-store, max-age=0"
      },
      body:formData,
      cache:"no-store",
      signal:controller.signal
    });
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null;}catch{data={reply:text};}
    if(!r.ok)throw new Error(data?.reply||data?.message||`${r.status} ${r.statusText}`);
    return data;
  }finally{
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
};

async function appendChatMessage(role,message){
  if(!auth||!SESSION_ID||!String(message||"").trim())return;
  await sbRpc("append_my_chat_message",{
    p_session_id:SESSION_ID,
    p_role:role,
    p_message:String(message)
  });
}

loadChatHistory=async function(){
  if(!auth||!SESSION_ID||isDoctor()||isDashboard())return;

  const epoch=authEpoch;
  const userId=auth.user.User_ID;
  const generation=activeChatGeneration;
  const rows=await sbRpc("get_my_chat_history",{
    p_session_id:SESSION_ID,
    p_limit:100
  });

  if(!requestContextValid(epoch,userId,generation))return;

  chatMessages.innerHTML="";
  const messages=Array.isArray(rows)?rows:[];
  for(const m of messages){
    addMessage(String(m.role).toLowerCase()==="assistant"?"assistant":"user",m.message??"");
  }

  if(!messages.length){
    addMessage(
      "assistant",
      isTechnician()
        ? `Salut ${auth.user.Name}. Pot analiza lucrările tale asignate și costurile proprii permise.`
        : `Salut ${auth.user.Name}. Pot consulta datele la care ai acces și te pot ajuta cu analiza lor.`
    );
  }
};

sendText=async function(text){
  const sessionId=SESSION_ID;
  const pendingOperation=aiPendingOperation;
  await appendChatMessage("user",text);
  const data=await fetchAiJson({session_id:sessionId,text,pending_operation:pendingOperation,client_request_id:aiClientRequestId()});
  if(SESSION_ID===sessionId&&data?.reply)await appendChatMessage("assistant",data.reply);
  return data;
};

/* ---------------- CALENDAR: DIRECT SUPABASE ---------------- */

loadCalendarData=async function(show=false){
  if(!isManagement())return;
  if(calendarLoading)return;

  calendarLoading=true;
  if(show)showLoading("Calendar","Caut evenimentele...");

  try{
    const labId=await resolveLabOrganizationId();
    const {data,error}=await supabaseClient
      .from("lab_calendar_events")
      .select("id,title,event_type,description,status,created_by_user_id,updated_by_user_id,start_date,end_date,start_time,created_at,updated_at")
      .eq("lab_organization_id",labId)
      .order("start_date",{ascending:true})
      .order("start_time",{ascending:true});

    if(error)throw new Error(error.message);

    calendarEvents=(data||[]).map(r=>normalizeCalendarEvent({
      ID:r.id,
      Title:r.title,
      Event_Type:r.event_type,
      Description:r.description,
      Status:r.status,
      Created_By_User_ID:r.created_by_user_id,
      Updated_By_User_ID:r.updated_by_user_id,
      Start_Date:r.start_date,
      End_Date:r.end_date,
      Start_Time:r.start_time,
      Created_At:r.created_at,
      Updated_At:r.updated_at
    }));
    calendarLoaded=true;
  }finally{
    calendarLoading=false;
    if(show)hideLoading();
  }
};

calendarRequest=async function(action,data={}){
  if(!isManagement())throw new Error("Calendar access denied.");
  const labId=await resolveLabOrganizationId();
  const now=new Date().toISOString();

  showLoading("Calendar","Salvez evenimentul...");
  try{
    if(action==="create"){
      const row={
        lab_organization_id:labId,
        title:String(data.Title||"").trim(),
        event_type:String(data.Event_Type||"").trim()||null,
        description:String(data.Description||"").trim()||null,
        status:String(data.Status||"Planificat").trim(),
        created_by_user_id:auth.user.User_ID,
        updated_by_user_id:auth.user.User_ID,
        start_date:data.Start_Date||null,
        end_date:data.End_Date||null,
        start_time:data.Start_Time||null,
        created_at:now,
        updated_at:now
      };
      const {error}=await supabaseClient.from("lab_calendar_events").insert(row);
      if(error)throw new Error(error.message);
    }else if(action==="update"){
      const row={
        title:String(data.Title||"").trim(),
        event_type:String(data.Event_Type||"").trim()||null,
        description:String(data.Description||"").trim()||null,
        status:String(data.Status||"Planificat").trim(),
        updated_by_user_id:auth.user.User_ID,
        start_date:data.Start_Date||null,
        end_date:data.End_Date||null,
        start_time:data.Start_Time||null,
        updated_at:now
      };
      const {error}=await supabaseClient
        .from("lab_calendar_events")
        .update(row)
        .eq("lab_organization_id",labId)
        .eq("id",Number(data.ID));
      if(error)throw new Error(error.message);
    }else if(action==="delete"){
      const {error}=await supabaseClient
        .from("lab_calendar_events")
        .delete()
        .eq("lab_organization_id",labId)
        .eq("id",Number(data.ID));
      if(error)throw new Error(error.message);
    }else{
      throw new Error(`Calendar action not supported: ${action}`);
    }

    calendarLoaded=false;
    calendarEditor=null;
    await loadCalendarData(false);
    if(currentView==="calendar")renderCalendar();
    return {ok:true};
  }finally{hideLoading();}
};

/* ---------------- MATERIALS: DIRECT SUPABASE ---------------- */

loadMaterialsData=async function(show=false){
  if(materialsLoading)return;
  materialsLoading=true;
  if(show)showLoading("Materiale","Număr ce avem pe raft...");

  try{
    const labId=await resolveLabOrganizationId();
    const {data,error}=await supabaseClient
      .from("lab_materials_inventory")
      .select("id,furnizor,material,um,cantitate,prag_minim,observatii,ultima_actualizare,created_by_user_id,updated_by_user_id,created_at,updated_at")
      .eq("lab_organization_id",labId)
      .order("material",{ascending:true});

    if(error)throw new Error(error.message);

    materialsInventory=(data||[]).map(r=>normalizeMaterialRow({
      ID:r.id,
      Furnizor:r.furnizor,
      Material:r.material,
      UM:r.um,
      Cantitate:r.cantitate,
      Prag_Minim:r.prag_minim,
      Observatii:r.observatii,
      Ultima_Actualizare:r.ultima_actualizare,
      Created_By_User_ID:r.created_by_user_id,
      Updated_By_User_ID:r.updated_by_user_id,
      Created_At:r.created_at,
      Updated_At:r.updated_at
    }));
    materialsLoaded=true;
  }finally{
    materialsLoading=false;
    if(show)hideLoading();
  }
};

materialsRequest=async function(action,data={}){
  if(!isManagement())throw new Error("Materials write access denied.");
  const labId=await resolveLabOrganizationId();
  const now=new Date().toISOString();

  showLoading("Materiale","Actualizez stocul...");
  try{
    const row={
      furnizor:String(data.Furnizor||"").trim()||null,
      material:String(data.Material||"").trim(),
      um:String(data.UM||"").trim()||null,
      cantitate:Number(data.Cantitate)||0,
      prag_minim:Number(data.Prag_Minim)||0,
      observatii:String(data.Observatii||"").trim()||null,
      ultima_actualizare:data.Ultima_Actualizare||now,
      updated_by_user_id:auth.user.User_ID,
      updated_at:now
    };

    if(action==="create"){
      const {error}=await supabaseClient.from("lab_materials_inventory").insert({
        lab_organization_id:labId,
        ...row,
        created_by_user_id:auth.user.User_ID,
        created_at:now
      });
      if(error)throw new Error(error.message);
    }else if(action==="update"){
      const {error}=await supabaseClient
        .from("lab_materials_inventory")
        .update(row)
        .eq("lab_organization_id",labId)
        .eq("id",Number(data.ID));
      if(error)throw new Error(error.message);
    }else if(action==="delete"){
      const {error}=await supabaseClient
        .from("lab_materials_inventory")
        .delete()
        .eq("lab_organization_id",labId)
        .eq("id",Number(data.ID));
      if(error)throw new Error(error.message);
    }else{
      throw new Error(`Materials action not supported: ${action}`);
    }

    materialsLoaded=false;
    materialEditor=null;
    await loadMaterialsData(false);
    if(currentView==="materials")renderMaterials();
    return {ok:true};
  }finally{hideLoading();}
};

/* ---------------- ADMIN USERS: SUPABASE AUTH EDGE FUNCTION ---------------- */

async function callAdminUsers(action,data={}){
  if(!isAdmin())throw new Error("Admin access required.");
  const token=await currentAccessToken();
  const fn=String(SUPABASE_CONFIG.adminUsersFunction||"admin-users");
  const endpoint=`${String(SUPABASE_CONFIG.projectUrl).replace(/\/+$/,"")}/functions/v1/${encodeURIComponent(fn)}`;

  const r=await fetch(endpoint,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":`Bearer ${token}`,
      "apikey":SUPABASE_CONFIG.publishableKey
    },
    body:JSON.stringify({action,data})
  });

  const text=await r.text();
  let payload=null;
  try{payload=text?JSON.parse(text):null;}catch{payload={message:text};}
  if(!r.ok||!payload?.ok)throw new Error(payload?.message||"Admin users operation failed.");
  return payload;
}

loadLegacyAdminUsersSafe=async function(){
  if(!isAdmin())return {users:[],roles:[]};
  const currentUser=String(auth?.user?.User_ID||"");
  if(legacyAdminCache&&legacyAdminCacheUser===currentUser)return legacyAdminCache;

  const data=await callAdminUsers("list",{});
  legacyAdminCache={
    users:Array.isArray(data?.users)?data.users:[],
    roles:Array.isArray(data?.roles)?data.roles:[]
  };
  legacyAdminCacheUser=currentUser;
  return legacyAdminCache;
};

const adminConfigRequestV17Base=adminConfigRequest;
adminConfigRequest=async function(entity,action,data={}){
  if(!isAdmin())throw new Error("Admin access required");

  if(entity!=="user"){
    return adminConfigRequestV17Base(entity,action,data);
  }

  showLoading("Configurare utilizator","Actualizez contul...");
  try{
    const result=await callAdminUsers(action,data);
    legacyAdminCache=null;
    legacyAdminCacheUser="";
    await loadAll(false);
    currentView="adminconfig";
    renderAdminConfig();
    return result;
  }finally{hideLoading();}
};

const renderAdminConfigV17Base=renderAdminConfig;
renderAdminConfig=function(){
  renderAdminConfigV17Base();
  if(!isAdmin())return;
  pageSubtitle.textContent="Configurare laborator · utilizatori, prețuri, tipuri de lucrări și costuri";
  document.querySelector(".legacy-admin-note")?.replaceChildren(
    document.createTextNode("Utilizatori: conturi securizate")
  );
};

/* ---------------- INITIALIZATION ---------------- */

initializeApp=async function({showLoader=true}={}){
  if(!auth)throw new Error("Neautentificat");
  if(showLoader)showLoading("Conectare","Verific accesul și pregătesc datele...");

  try{
    await refreshSupabaseIdentity();
    applyRoleUI();
    await loadAll(false);

    if(!isDoctor()&&!isDashboard()){
      try{await loadChatHistory();}catch(err){console.warn("Istoricul conversației nu este disponibil:",err);}
    }
  }finally{
    if(showLoader)hideLoading();
  }
};




/* ==========================================================================
   V18 — HUMAN CHAT
   Direct chat stored in the application database. No automation workflow.
   ========================================================================== */

const CHAT_BUCKET="chat-files";
const CHAT_FILE_MAX=25*1024*1024;

let humanChatMounted=false;
let humanChatOpen=false;
let humanChatThread=null;
let humanChatOtherUser=null;
let humanChatRealtime=null;
let humanChatPendingFiles=[];
let humanChatThreadPoll=null;
let humanChatGroupMembers=[];
let humanChatGroupMode=false;

function humanChatEnabled(){
  return Boolean(auth && !isDashboard());
}

function humanChatEscape(s){
  return escapeHtml(String(s??""));
}

function humanChatInitials(name){
  const parts=String(name||"?").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0,2).map(x=>x[0]||"").join("")||"?").toUpperCase();
}

function humanChatFileSize(n){
  const size=Number(n||0);
  if(size<1024)return `${size} B`;
  if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`;
  return `${(size/(1024*1024)).toFixed(1)} MB`;
}


function humanChatFormatDateTime(value){
  if(!value)return "";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return String(value);

  const now=new Date();
  const sameDay=
    d.getFullYear()===now.getFullYear() &&
    d.getMonth()===now.getMonth() &&
    d.getDate()===now.getDate();

  if(sameDay){
    return d.toLocaleTimeString("ro-RO",{
      hour:"2-digit",
      minute:"2-digit"
    });
  }

  return d.toLocaleString("ro-RO",{
    day:"2-digit",
    month:"2-digit",
    year:d.getFullYear()===now.getFullYear()?undefined:"numeric",
    hour:"2-digit",
    minute:"2-digit"
  });
}

function humanChatSafeFilename(name){
  return String(name||"file")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-zA-Z0-9._-]+/g,"_")
    .replace(/_+/g,"_")
    .slice(-120);
}

function humanChatMount(){
  if(humanChatMounted)return;
  humanChatMounted=true;

  const root=document.createElement("div");
  root.id="humanChatRoot";
  root.innerHTML=`
    <button id="humanChatLauncher" class="human-chat-launcher hidden" type="button" aria-label="Mesaje">
      <span class="human-chat-launcher-icon">💬</span>
      <span class="human-chat-launcher-label">Mesaje</span>
      <span id="humanChatUnread" class="human-chat-unread hidden">0</span>
    </button>

    <section id="humanChatPanel" class="human-chat-panel hidden" aria-label="Chat">
      <header class="human-chat-header">
        <div class="human-chat-header-main">
          <button id="humanChatBack" class="human-chat-icon-btn hidden" type="button" aria-label="Înapoi">‹</button>
          <div>
            <strong id="humanChatTitle">Mesaje</strong>
            <span id="humanChatSubtitle">Discuții rapide cu oamenii potriviți.</span>
          </div>
        </div>
        <button id="humanChatMinimize" class="human-chat-icon-btn" type="button" aria-label="Minimizează">—</button>
      </header>

      <div id="humanChatHome" class="human-chat-home">
        <div id="humanChatStandardHome" class="human-chat-standard-home">
          <div class="human-chat-search-wrap human-chat-search-actions">
            <input id="humanChatSearch" type="search" placeholder="Caută un coleg..." autocomplete="off">
            <button id="humanChatNewGroup" class="human-chat-new-group-btn" type="button">＋ Grup</button>
          </div>

          <div id="humanChatSearchSection" class="human-chat-search-section hidden">
            <div class="human-chat-section-label">Poți discuta cu</div>
            <div id="humanChatSearchResults" class="human-chat-user-list"></div>
          </div>

          <div class="human-chat-section-label human-chat-recent-label">Conversații recente</div>
          <div id="humanChatThreads" class="human-chat-thread-list"></div>
        </div>

        <div id="humanChatGroupCreator" class="human-chat-group-creator hidden">
          <div class="human-chat-group-intro">
            <strong>Grup nou</strong>
            <span>Alege oamenii și dă grupului un nume.</span>
          </div>
          <label class="human-chat-group-field">Nume grup
            <input id="humanChatGroupTitle" maxlength="80" placeholder="ex. Cazuri urgente">
          </label>
          <div id="humanChatGroupSelected" class="human-chat-group-selected hidden"></div>
          <label class="human-chat-group-field">Adaugă persoane
            <input id="humanChatGroupSearch" type="search" placeholder="Caută persoane..." autocomplete="off">
          </label>
          <div id="humanChatGroupResults" class="human-chat-user-list human-chat-group-results"></div>
          <div class="human-chat-group-actions">
            <button id="humanChatCancelGroup" class="secondary-btn" type="button">Renunță</button>
            <button id="humanChatCreateGroup" class="primary-btn" type="button">Creează grup</button>
          </div>
        </div>
      </div>

      <div id="humanChatConversation" class="human-chat-conversation hidden">
        <div class="human-chat-conversation-tools">
          <button id="humanChatClearOld" class="human-chat-clean-btn" type="button">Curăță mesajele &gt;30 zile</button>
        </div>
        <div id="humanChatMessages" class="human-chat-messages"></div>

        <div id="humanChatPending" class="human-chat-pending hidden"></div>

        <form id="humanChatComposer" class="human-chat-composer">
          <label class="human-chat-attach-btn" title="Adaugă fișiere">
            📎
            <input id="humanChatFileInput" type="file" multiple hidden>
          </label>
          <textarea id="humanChatText" rows="1" maxlength="4000" placeholder="Scrie un mesaj..."></textarea>
          <button id="humanChatSend" class="human-chat-send-btn" type="submit">Trimite</button>
        </form>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  $("humanChatLauncher")?.addEventListener("click",humanChatToggle);
  $("humanChatMinimize")?.addEventListener("click",humanChatMinimize);
  $("humanChatBack")?.addEventListener("click",humanChatShowHome);
  $("humanChatNewGroup")?.addEventListener("click",humanChatShowGroupCreator);
  $("humanChatCancelGroup")?.addEventListener("click",humanChatCancelGroupCreator);
  $("humanChatCreateGroup")?.addEventListener("click",()=>{
    humanChatCreateGroup().catch(err=>alert(`Grupul nu a fost creat: ${err.message}`));
  });

  let groupSearchTimer=null;
  $("humanChatGroupSearch")?.addEventListener("input",e=>{
    clearTimeout(groupSearchTimer);
    groupSearchTimer=setTimeout(()=>humanChatSearchGroupUsers(e.target.value).catch(console.warn),180);
  });

  let searchTimer=null;
  $("humanChatSearch")?.addEventListener("input",e=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>humanChatSearchUsers(e.target.value).catch(console.warn),180);
  });

  $("humanChatComposer")?.addEventListener("submit",e=>{
    e.preventDefault();
    humanChatSendCurrent().catch(err=>alert(`Mesajul nu a fost trimis: ${err.message}`));
  });

  $("humanChatText")?.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&!e.shiftKey){
      e.preventDefault();
      $("humanChatComposer")?.requestSubmit();
    }
  });

  $("humanChatFileInput")?.addEventListener("change",e=>{
    const files=[...(e.target.files||[])];
    e.target.value="";
    for(const file of files){
      if(file.size>CHAT_FILE_MAX){
        alert(`${file.name}: limita este 25 MB / fișier.`);
        continue;
      }
      if(humanChatPendingFiles.length>=10){
        alert("Poți atașa maximum 10 fișiere într-un mesaj.");
        break;
      }
      humanChatPendingFiles.push(file);
    }
    humanChatRenderPending();
  });

  $("humanChatClearOld")?.addEventListener("click",()=>{
    humanChatClearOlderThan30().catch(err=>alert(`Curățarea nu a reușit: ${err.message}`));
  });

  document.addEventListener("click",e=>{
    const threadBtn=e.target.closest("[data-human-chat-thread]");
    if(threadBtn){
      humanChatOpenThread(
        threadBtn.dataset.humanChatThread,
        {
          thread_type:threadBtn.dataset.threadType||"direct",
          title:threadBtn.dataset.title||"",
          member_count:Number(threadBtn.dataset.memberCount||0),
          user_id:threadBtn.dataset.userId,
          username:threadBtn.dataset.username,
          display_name:threadBtn.dataset.displayName,
          role:threadBtn.dataset.role,
          organization_name:threadBtn.dataset.organization
        }
      ).catch(err=>alert(err.message));
      return;
    }

    const groupUserBtn=e.target.closest("[data-human-chat-group-user]");
    if(groupUserBtn){
      humanChatToggleGroupMember({
        user_id:groupUserBtn.dataset.humanChatGroupUser,
        username:groupUserBtn.dataset.username,
        display_name:groupUserBtn.dataset.displayName,
        role:groupUserBtn.dataset.role,
        organization_name:groupUserBtn.dataset.organization
      });
      return;
    }

    const userBtn=e.target.closest("[data-human-chat-user]");
    if(userBtn){
      humanChatStartWith(userBtn.dataset.humanChatUser,{
        user_id:userBtn.dataset.humanChatUser,
        username:userBtn.dataset.username,
        display_name:userBtn.dataset.displayName,
        role:userBtn.dataset.role,
        organization_name:userBtn.dataset.organization
      }).catch(err=>alert(err.message));
      return;
    }

    const attachmentBtn=e.target.closest("[data-human-chat-file]");
    if(attachmentBtn){
      humanChatDownloadAttachment(attachmentBtn.dataset.humanChatFile).catch(err=>alert(`Fișierul nu poate fi deschis: ${err.message}`));
      return;
    }

    const pendingRemove=e.target.closest("[data-human-chat-remove-file]");
    if(pendingRemove){
      humanChatPendingFiles.splice(Number(pendingRemove.dataset.humanChatRemoveFile),1);
      humanChatRenderPending();
    }
  });
}

async function humanChatInitialize(){
  humanChatMount();

  const launcher=$("humanChatLauncher");
  if(!humanChatEnabled()){
    launcher?.classList.add("hidden");
    humanChatMinimize();
    return;
  }

  launcher?.classList.remove("hidden");

  try{
    await humanChatRefreshThreads();
  }catch(err){
    console.warn("Mesagerie indisponibilă:",err);
  }

  clearInterval(humanChatThreadPoll);
  humanChatThreadPoll=setInterval(()=>{
    if(auth&&humanChatEnabled()){
      humanChatRefreshThreads().catch(()=>{});
    }
  },20000);
}

function humanChatDestroy(){
  humanChatUnsubscribe();
  clearInterval(humanChatThreadPoll);
  humanChatThreadPoll=null;
  humanChatThread=null;
  humanChatOtherUser=null;
  humanChatPendingFiles=[];
  humanChatGroupMembers=[];
  humanChatGroupMode=false;
  humanChatOpen=false;
  $("humanChatPanel")?.classList.add("hidden");
  $("humanChatLauncher")?.classList.add("hidden");
}

function humanChatToggle(){
  if(!humanChatEnabled())return;
  const panel=$("humanChatPanel");
  humanChatOpen=panel?.classList.contains("hidden");
  panel?.classList.toggle("hidden",!humanChatOpen);
  if(humanChatOpen){
    if(humanChatThread){
      humanChatLoadMessages().catch(()=>{});
    }else{
      humanChatShowHome();
    }
    humanChatRefreshThreads().catch(()=>{});
  }
}

function humanChatMinimize(){
  humanChatOpen=false;
  $("humanChatPanel")?.classList.add("hidden");
}

function humanChatShowHome(){
  humanChatThread=null;
  humanChatOtherUser=null;
  humanChatPendingFiles=[];
  humanChatRenderPending();
  humanChatUnsubscribe();
  humanChatGroupMode=false;
  humanChatGroupMembers=[];

  $("humanChatConversation")?.classList.add("hidden");
  $("humanChatHome")?.classList.remove("hidden");
  $("humanChatStandardHome")?.classList.remove("hidden");
  $("humanChatGroupCreator")?.classList.add("hidden");
  $("humanChatBack")?.classList.add("hidden");
  $("humanChatTitle").textContent="Mesaje";
  $("humanChatSubtitle").textContent="Discuții rapide cu oamenii potriviți.";
  $("humanChatSearch").value="";
  $("humanChatSearchSection")?.classList.add("hidden");
  humanChatRefreshThreads().catch(()=>{});
}

function humanChatShowGroupCreator(){
  if(!humanChatEnabled())return;
  humanChatGroupMode=true;
  humanChatGroupMembers=[];
  $("humanChatStandardHome")?.classList.add("hidden");
  $("humanChatGroupCreator")?.classList.remove("hidden");
  if($("humanChatGroupTitle"))$("humanChatGroupTitle").value="";
  if($("humanChatGroupSearch"))$("humanChatGroupSearch").value="";
  if($("humanChatGroupResults"))$("humanChatGroupResults").innerHTML=`<div class="human-chat-empty">Caută persoane pentru grup.</div>`;
  humanChatRenderGroupSelected();
  $("humanChatGroupTitle")?.focus();
}

function humanChatCancelGroupCreator(){
  humanChatGroupMode=false;
  humanChatGroupMembers=[];
  $("humanChatGroupCreator")?.classList.add("hidden");
  $("humanChatStandardHome")?.classList.remove("hidden");
  humanChatRenderGroupSelected();
}

function humanChatToggleGroupMember(user){
  const id=String(user?.user_id||"");
  if(!id)return;
  const idx=humanChatGroupMembers.findIndex(x=>String(x.user_id)===id);
  if(idx>=0)humanChatGroupMembers.splice(idx,1);
  else humanChatGroupMembers.push(user);
  humanChatRenderGroupSelected();
  const q=String($("humanChatGroupSearch")?.value||"");
  humanChatSearchGroupUsers(q).catch(()=>{});
}

function humanChatRenderGroupSelected(){
  const wrap=$("humanChatGroupSelected");
  if(!wrap)return;
  if(!humanChatGroupMembers.length){
    wrap.classList.add("hidden");
    wrap.innerHTML="";
    return;
  }
  wrap.classList.remove("hidden");
  wrap.innerHTML=humanChatGroupMembers.map(u=>`
    <button type="button" class="human-chat-group-chip"
      data-human-chat-group-user="${humanChatEscape(u.user_id)}"
      data-username="${humanChatEscape(u.username)}"
      data-display-name="${humanChatEscape(u.display_name)}"
      data-role="${humanChatEscape(u.role)}"
      data-organization="${humanChatEscape(u.organization_name)}">
      <span>${humanChatEscape(u.display_name)}</span><b>×</b>
    </button>
  `).join("");
}

async function humanChatSearchGroupUsers(query=""){
  if(!humanChatEnabled()||!humanChatGroupMode)return;
  const list=$("humanChatGroupResults");
  if(!list)return;
  const q=String(query||"").trim();
  if(!q){
    list.innerHTML=`<div class="human-chat-empty">Caută persoane pentru grup.</div>`;
    return;
  }
  list.innerHTML=`<div class="human-chat-empty">Caut...</div>`;
  const rows=await sbRpc("chat_search_users",{p_query:q,p_limit:50});
  if(!Array.isArray(rows)||!rows.length){
    list.innerHTML=`<div class="human-chat-empty">N-am găsit persoane disponibile.</div>`;
    return;
  }
  const selected=new Set(humanChatGroupMembers.map(x=>String(x.user_id)));
  list.innerHTML=rows.map(u=>{
    const active=selected.has(String(u.user_id));
    return `
      <button type="button" class="human-chat-user-row ${active?"selected":""}"
        data-human-chat-group-user="${humanChatEscape(u.user_id)}"
        data-username="${humanChatEscape(u.username)}"
        data-display-name="${humanChatEscape(u.display_name)}"
        data-role="${humanChatEscape(u.role)}"
        data-organization="${humanChatEscape(u.organization_name)}">
        <span class="human-chat-avatar">${humanChatEscape(active?"✓":humanChatInitials(u.display_name))}</span>
        <span class="human-chat-user-copy">
          <strong>${humanChatEscape(u.display_name)}</strong>
          <small>@${humanChatEscape(u.username)} · ${humanChatEscape(u.role)}${u.organization_name?` · ${humanChatEscape(u.organization_name)}`:""}</small>
        </span>
      </button>`;
  }).join("");
}

async function humanChatCreateGroup(){
  if(!humanChatEnabled())return;
  const title=String($("humanChatGroupTitle")?.value||"").trim();
  if(title.length<2){
    alert("Dă grupului un nume de cel puțin 2 caractere.");
    return;
  }
  if(!humanChatGroupMembers.length){
    alert("Alege cel puțin o persoană pentru grup.");
    return;
  }
  const button=$("humanChatCreateGroup");
  if(button)button.disabled=true;
  try{
    const threadId=await sbRpc("chat_create_group",{
      p_title:title,
      p_participant_ids:humanChatGroupMembers.map(x=>x.user_id)
    });
    const memberCount=humanChatGroupMembers.length+1;
    humanChatGroupMode=false;
    await humanChatOpenThread(threadId,{
      thread_type:"group",
      title,
      display_name:title,
      role:"Grup",
      organization_name:`${memberCount} membri`,
      member_count:memberCount
    });
  }finally{
    if(button)button.disabled=false;
  }
}

async function humanChatSearchUsers(query=""){
  if(!humanChatEnabled())return;

  const q=String(query||"").trim();
  const section=$("humanChatSearchSection");
  const list=$("humanChatSearchResults");

  if(!q){
    section?.classList.add("hidden");
    if(list)list.innerHTML="";
    return;
  }

  section?.classList.remove("hidden");
  if(list)list.innerHTML=`<div class="human-chat-empty">Caut...</div>`;

  const rows=await sbRpc("chat_search_users",{p_query:q,p_limit:30});
  if(!list)return;

  if(!Array.isArray(rows)||!rows.length){
    list.innerHTML=`<div class="human-chat-empty">N-am găsit pe nimeni disponibil pentru conversație.</div>`;
    return;
  }

  list.innerHTML=rows.map(u=>`
    <button type="button" class="human-chat-user-row"
      data-human-chat-user="${humanChatEscape(u.user_id)}"
      data-username="${humanChatEscape(u.username)}"
      data-display-name="${humanChatEscape(u.display_name)}"
      data-role="${humanChatEscape(u.role)}"
      data-organization="${humanChatEscape(u.organization_name)}">
      <span class="human-chat-avatar">${humanChatEscape(humanChatInitials(u.display_name))}</span>
      <span class="human-chat-user-copy">
        <strong>${humanChatEscape(u.display_name)}</strong>
        <small>@${humanChatEscape(u.username)} · ${humanChatEscape(u.role)}${u.organization_name?` · ${humanChatEscape(u.organization_name)}`:""}</small>
      </span>
    </button>
  `).join("");
}

async function humanChatRefreshThreads(){
  if(!humanChatEnabled())return;

  const rows=await sbRpc("chat_list_threads",{});
  const list=$("humanChatThreads");

  const totalUnread=(rows||[]).reduce((s,r)=>s+Number(r.unread_count||0),0);
  const badge=$("humanChatUnread");
  if(badge){
    badge.textContent=totalUnread>99?"99+":String(totalUnread);
    badge.classList.toggle("hidden",totalUnread<=0);
  }

  if(!list)return;

  if(!Array.isArray(rows)||!rows.length){
    list.innerHTML=`<div class="human-chat-empty">Nicio conversație încă. Caută un coleg mai sus.</div>`;
    return;
  }

  list.innerHTML=rows.map(t=>{
    const isGroup=String(t.thread_type||"direct")==="group";
    const display=t.display_name||t.title||"Conversație";
    return `
    <button type="button" class="human-chat-thread-row ${isGroup?"is-group":""}"
      data-human-chat-thread="${humanChatEscape(t.thread_id)}"
      data-thread-type="${humanChatEscape(t.thread_type||"direct")}"
      data-title="${humanChatEscape(t.title||"")}"
      data-member-count="${humanChatEscape(t.member_count||0)}"
      data-user-id="${humanChatEscape(t.other_user_id||"")}"
      data-username="${humanChatEscape(t.username||"")}"
      data-display-name="${humanChatEscape(display)}"
      data-role="${humanChatEscape(t.role||"")}"
      data-organization="${humanChatEscape(t.organization_name||"")}">
      <span class="human-chat-avatar ${isGroup?"group-avatar":""}">${isGroup?"#":humanChatEscape(humanChatInitials(display))}</span>
      <span class="human-chat-thread-copy">
        <span class="human-chat-thread-top">
          <strong>${humanChatEscape(t.display_name)}</strong>
          <small>${t.last_message_at?humanChatEscape(humanChatFormatDateTime(t.last_message_at)):""}</small>
        </span>
        <span class="human-chat-thread-bottom">
          <span>${humanChatEscape(t.last_message||"Conversație nouă")}</span>
          ${Number(t.unread_count||0)>0?`<b>${Math.min(99,Number(t.unread_count))}</b>`:""}
        </span>
      </span>
    </button>
  `}).join("");
}

async function humanChatStartWith(userId,user){
  const threadId=await sbRpc("chat_open_direct_thread",{p_other_user:userId});
  await humanChatOpenThread(threadId,user);
}

async function humanChatOpenThread(threadId,user){
  humanChatThread=String(threadId);
  humanChatOtherUser=user||{};

  $("humanChatHome")?.classList.add("hidden");
  $("humanChatConversation")?.classList.remove("hidden");
  $("humanChatBack")?.classList.remove("hidden");

  const isGroup=String(user?.thread_type||"direct")==="group";
  $("humanChatTitle").textContent=isGroup
    ? (user?.title||user?.display_name||"Grup")
    : (user?.display_name||"Conversație");
  $("humanChatSubtitle").textContent=isGroup
    ? `${Number(user?.member_count||0)||""} membri`.trim()
    : [user?.role||"",user?.organization_name||""].filter(Boolean).join(" · ");

  await humanChatLoadMessages();
  await sbRpc("chat_mark_read",{p_thread_id:humanChatThread}).catch(()=>{});
  await humanChatRefreshThreads().catch(()=>{});
  humanChatSubscribe(humanChatThread);
}

async function humanChatLoadMessages(){
  if(!humanChatThread)return;

  const rows=await sbRpc("chat_get_messages",{
    p_thread_id:humanChatThread,
    p_before:null,
    p_limit:200
  });

  humanChatRenderMessages(Array.isArray(rows)?rows:[]);
}

function humanChatRenderMessages(rows){
  const box=$("humanChatMessages");
  if(!box)return;

  if(!rows.length){
    box.innerHTML=`<div class="human-chat-empty human-chat-empty-conversation">Conversația e nouă. Sparge gheața. 🙂</div>`;
    return;
  }

  const myId=String(auth?.supabaseProfile?.id||"");

  box.innerHTML=rows.map(m=>{
    const mine=String(m.sender_id)===myId;
    const attachments=Array.isArray(m.attachments)?m.attachments:[];
    return `
      <div class="human-chat-message ${mine?"mine":"theirs"}">
        <div class="human-chat-bubble">
          ${m.body?`<div class="human-chat-message-text">${humanChatEscape(m.body).replace(/\n/g,"<br>")}</div>`:""}
          ${attachments.length?`
            <div class="human-chat-files">
              ${attachments.map(a=>`
                <button type="button" class="human-chat-file-chip" data-human-chat-file="${humanChatEscape(a.storage_path)}">
                  <span>📎</span>
                  <span>
                    <strong>${humanChatEscape(a.file_name)}</strong>
                    <small>${humanChatEscape(humanChatFileSize(a.size_bytes))}</small>
                  </span>
                </button>
              `).join("")}
            </div>
          `:""}
          <div class="human-chat-message-meta">
            ${mine?"Tu":humanChatEscape(m.sender_name||humanChatOtherUser?.display_name||"")}
            · ${humanChatEscape(humanChatFormatDateTime(m.created_at))}
          </div>
        </div>
      </div>
    `;
  }).join("");

  requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});
}

function humanChatRenderPending(){
  const wrap=$("humanChatPending");
  if(!wrap)return;

  if(!humanChatPendingFiles.length){
    wrap.classList.add("hidden");
    wrap.innerHTML="";
    return;
  }

  wrap.classList.remove("hidden");
  wrap.innerHTML=humanChatPendingFiles.map((f,i)=>`
    <span class="human-chat-pending-file">
      <span>📎 ${humanChatEscape(f.name)} · ${humanChatEscape(humanChatFileSize(f.size))}</span>
      <button type="button" data-human-chat-remove-file="${i}" aria-label="Elimină">×</button>
    </span>
  `).join("");
}

async function humanChatUploadPendingFiles(){
  if(!humanChatThread||!humanChatPendingFiles.length)return {metadata:[],paths:[]};

  const myId=String(auth?.supabaseProfile?.id||"");
  const metadata=[];
  const paths=[];

  for(const file of humanChatPendingFiles){
    if(file.size>CHAT_FILE_MAX)throw new Error(`${file.name}: limita este 25 MB.`);

    const path=`${humanChatThread}/${myId}/${crypto.randomUUID()}_${humanChatSafeFilename(file.name)}`;

    const {error}=await supabaseClient.storage
      .from(CHAT_BUCKET)
      .upload(path,file,{
        cacheControl:"3600",
        upsert:false,
        contentType:file.type||"application/octet-stream"
      });

    if(error)throw new Error(error.message);

    paths.push(path);
    metadata.push({
      storage_path:path,
      file_name:file.name,
      mime_type:file.type||"application/octet-stream",
      size_bytes:file.size
    });
  }

  return {metadata,paths};
}

async function humanChatSendCurrent(){
  if(!humanChatThread)return;

  const input=$("humanChatText");
  const body=String(input?.value||"").trim();

  if(!body&&!humanChatPendingFiles.length)return;

  const sendBtn=$("humanChatSend");
  if(sendBtn)sendBtn.disabled=true;

  let uploadedPaths=[];
  let messageSaved=false;

  try{
    const uploaded=await humanChatUploadPendingFiles();
    uploadedPaths=uploaded.paths;

    await sbRpc("chat_send_message",{
      p_thread_id:humanChatThread,
      p_body:body||null,
      p_attachments:uploaded.metadata
    });
    messageSaved=true;

    if(input)input.value="";
    humanChatPendingFiles=[];
    humanChatRenderPending();

    // Rendering/refresh is best-effort after the message is confirmed saved.
    // A display problem must never be reported as "message not sent".
    try{
      await humanChatLoadMessages();
      await humanChatRefreshThreads();
    }catch(refreshErr){
      console.warn("Mesajul a fost salvat, dar conversația nu s-a reîmprospătat imediat:",refreshErr);
    }
  }catch(err){
    // Remove uploaded files only if the actual message record was NOT saved.
    if(!messageSaved&&uploadedPaths.length){
      await supabaseClient.storage.from(CHAT_BUCKET).remove(uploadedPaths).catch(()=>{});
    }
    throw err;
  }finally{
    if(sendBtn)sendBtn.disabled=false;
  }
}

async function humanChatDownloadAttachment(path){
  const {data,error}=await supabaseClient.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path,600);

  if(error||!data?.signedUrl)throw new Error(error?.message||"Link indisponibil.");
  window.open(data.signedUrl,"_blank","noopener,noreferrer");
}

function humanChatUnsubscribe(){
  if(humanChatRealtime&&supabaseClient){
    supabaseClient.removeChannel(humanChatRealtime).catch(()=>{});
  }
  humanChatRealtime=null;
}

function humanChatSubscribe(threadId){
  humanChatUnsubscribe();
  if(!threadId||!supabaseClient)return;

  humanChatRealtime=supabaseClient
    .channel(`human-chat-${threadId}`)
    .on(
      "postgres_changes",
      {
        event:"INSERT",
        schema:"public",
        table:"chat_messages",
        filter:`thread_id=eq.${threadId}`
      },
      async payload=>{
        if(String(payload?.new?.sender_id)!==String(auth?.supabaseProfile?.id||"")){
          await humanChatLoadMessages().catch(()=>{});
          await sbRpc("chat_mark_read",{p_thread_id:threadId}).catch(()=>{});
        }
        await humanChatRefreshThreads().catch(()=>{});
      }
    )
    .subscribe();
}

async function humanChatClearOlderThan30(){
  if(!humanChatThread)return;

  const preview=await sbRpc("chat_cleanup_preview",{p_thread_id:humanChatThread});
  const messageCount=Number(preview?.message_count||0);
  const fileCount=Number(preview?.file_count||0);
  const paths=Array.isArray(preview?.storage_paths)?preview.storage_paths:[];

  if(!messageCount){
    alert("Conversația nu are mesaje mai vechi de 30 de zile.");
    return;
  }

  if(!confirm(
    `Ștergi definitiv ${messageCount} mesaje mai vechi de 30 de zile${fileCount?` și ${fileCount} fișiere atașate`:""}?\n\nAceastă curățare afectează istoricul conversației pentru ambele persoane.`
  ))return;

  showLoading("Curățenie în chat","Fac puțin loc în arhivă...");

  try{
    for(let i=0;i<paths.length;i+=100){
      const chunk=paths.slice(i,i+100);
      const {error}=await supabaseClient.storage.from(CHAT_BUCKET).remove(chunk);
      if(error)throw new Error(`Fișierele vechi nu au putut fi șterse: ${error.message}`);
    }

    const result=await sbRpc("chat_clear_older_than_30_days",{p_thread_id:humanChatThread});
    await humanChatLoadMessages();
    await humanChatRefreshThreads();
    alert(`Curățare terminată: ${Number(result?.deleted_messages||messageCount)} mesaje eliminate.`);
  }finally{
    hideLoading();
  }
}

/* Hook human chat into normal app lifecycle. */
const initializeAppBeforeHumanChat=initializeApp;
initializeApp=async function(opts={}){
  const result=await initializeAppBeforeHumanChat(opts);
  await humanChatInitialize();
  return result;
};

const clearAuthBeforeHumanChat=clearAuth;
clearAuth=function(opts={}){
  humanChatDestroy();
  return clearAuthBeforeHumanChat(opts);
};




/* ==========================================================================
   V18.4 — TECHNICIAN WORKSPACE
   ========================================================================== */

let calendarScopeView="shared";

function technicianWorkspaceAllowed(){
  return isTechnician();
}

/* Technician navigation: Patients + Calendar + Materials are available. */
const applyRoleUIV184Base=applyRoleUI;
applyRoleUI=function(){
  applyRoleUIV184Base();
  document.querySelectorAll('[data-view="technicians"] span:last-child').forEach(label=>{
    label.textContent=isTechnician()?"Salariu":"Tehnicieni";
  });
  if(isTechnician()){
    ["patients","calendar","materials","technicians"].forEach(view=>{
      document.querySelectorAll(`[data-view="${view}"]`).forEach(el=>el.classList.remove("hidden"));
    });
  }
};

/* ---------------- TECHNICIAN READ-ONLY WORK ORDER / DENTAL CHART ---------------- */

function applyTechnicianOrderViewMode(order=null){
  if(!isTechnician())return;

  const locked=Boolean(order?.locked);
  orderForm?.classList.add("technician-view-mode");
  orderForm?.classList.toggle("doctor-readonly",locked);
  modalTitle.textContent=`${locked?"Vizualizează":"Editează"} lucrarea #${Number(orderId?.value||0)}`;
  modalSubtitle.textContent=locked
    ? "Lucrarea este blocată · poți consulta cazul și adăuga fișiere. Datele comerciale nu sunt afișate."
    : "Poți actualiza prescripția dentară și statusul etapei tale. Datele comerciale și etapele colegilor sunt protejate.";

  orderForm?.querySelectorAll("input,select,textarea").forEach(el=>{el.disabled=true;});
  orderForm?.querySelectorAll(".date-picker-btn").forEach(el=>{el.disabled=true;});
  [orderSelectAnteriorBtn,orderClearTeethBtn,orderToothSaveBtn,orderToothRemoveBtn].forEach(el=>{if(el)el.disabled=true;});
  if(!locked){
    [orderShade,orderMethod,orderClinicNote,orderToothType,orderToothShade,orderToothMethod,orderToothNote]
      .forEach(el=>{if(el)el.disabled=false;});
    [orderSelectAnteriorBtn,orderClearTeethBtn,orderToothSaveBtn,orderToothRemoveBtn]
      .forEach(el=>{if(el)el.disabled=false;});
    orderForm?.querySelectorAll("[data-technician-stage-field]").forEach(el=>{el.disabled=false;});
    if(saveOrderBtn){
      saveOrderBtn.disabled=false;
      saveOrderBtn.classList.remove("hidden");
      saveOrderBtn.textContent="Salvează modificările";
    }
  }else if(saveOrderBtn){
    saveOrderBtn.disabled=true;
    saveOrderBtn.classList.add("hidden");
  }

  // Technician new-order-only field has no meaning in an existing read-only case.
  document.querySelectorAll(".technician-create-field").forEach(el=>el.classList.add("hidden"));

  renderCaseFilesUI();
}

const editOrderV184Base=editOrder;
editOrder=async function(id){
  if(!isTechnician())return editOrderV184Base(id);

  const o=orders.find(x=>Number(x.id)===Number(id));
  if(!o)return;

  showLoading("Deschid lucrarea","Pregătesc fișa dentară...");
  try{
    resetForm();
    orderForm.classList.add("edit-mode","technician-view-mode");
    orderId.value=String(o.id);
    dueDate.value=toDateInputValue(o.deadline);
    receptionDate.value=toDateInputValue(o.receptionDate);
    patient.value=o.patient||"";
    partner.value=o.partner||"";
    discount.value=0;
    populateFormOptions(o);
    renderTechnicianAssignmentSummary(o);
    recalcFormPrice();
    setModalRoleMode();

    const hadSavedCase=await loadOrderCaseForEdit(o);
    applyTechnicianOrderViewMode(o);
    if(!o.locked){
      modalSubtitle.textContent=hadSavedCase
        ? "Poți modifica și salva prescripția dentară și statusul etapei tale. Etapele colegilor și datele comerciale sunt read-only."
        : "Poți defini și salva prescripția dentară și statusul etapei tale. Etapele colegilor și datele comerciale sunt read-only.";
    }

    openModal();
    loadCaseFiles();
  }catch(err){
    alert(`Fișa lucrării #${id} nu a putut fi deschisă.\n\n${err.message}`);
  }finally{
    hideLoading();
  }
};
window.editOrder=editOrder;

/* ---------------- TECHNICIAN PRODUCTION: ADMIN-LIKE KANBAN, SAFE STATUS SET ---------------- */

const renderProductionV184Base=renderProduction;
renderProduction=function(){
  if(!isTechnician()){
    const result=renderProductionV184Base();
    if(isDashboard()){
      const toolbar=document.createElement("div");
      toolbar.className="dashboard-production-toolbar";
      toolbar.innerHTML=`<button class="secondary-btn dashboard-maximize-btn" type="button" onclick="toggleDashboardProductionMaximize()">${document.body.classList.contains("dashboard-production-maximized")?"↙ Revino":"⛶ Maximizează statusurile"}</button>`;
      content.prepend(toolbar);
      content.querySelectorAll(".kanban-draggable-card").forEach(card=>card.setAttribute("draggable","false"));
      content.querySelectorAll("select, .kanban-menu-btn").forEach(control=>{control.disabled=true;});
    }
    return result;
  }

  pageTitle.textContent="Producție";
  pageSubtitle.textContent="Fluxul lucrărilor tale · fără statusuri comerciale";
  const techStatuses=["Not Started","Started","Finished","Shipped"];
  const baseOrders=applyViewDateRanges(displayedOrders(),"production")
    .filter(o=>techStatuses.includes(String(o.status||"")));
  const dateBar=dateRangeFilterBar("production",[{field:"deadline",label:"Termen"}]);
  updateOldToggle();

  const card=o=>`<div class="kanban-card technician-production-card ${productionDeadlineClass(o)}">
    <div class="kanban-card-drag-head">
      <strong>#${o.id} · ${escapeHtml(o.patient)||"—"}</strong>
      <span class="production-deadline-stack">${productionTomorrowBadge(o)}${orderLockBadge(o)}</span>
    </div>
    <div class="kanban-meta">${escapeHtml(o.partner)||"—"}</div>
    <div class="kanban-meta">${escapeHtml(o.workType)||"—"} · ${o.elements} elem.</div>
    <div class="kanban-meta">Termen ${fmtDate(o.deadline)}</div>
    <button class="secondary-btn technician-production-view" type="button" onclick="editOrder(${o.id})">🦷 Vezi fișa</button>
    <div class="technician-production-stage-wrap">${technicianStageHtml(o,true)}</div>
  </div>`;

  if(isMobileLayout()){
    content.innerHTML=dateBar+`<div class="mobile-production-stack">${techStatuses.map(stage=>{
      const list=sortProductionByDeadline(baseOrders.filter(o=>String(o.status||"")===stage));
      return `<section class="mobile-production-section">
        <div class="mobile-production-title"><span>${escapeHtml(uiText(stage))}</span><span>${list.length}</span></div>
        ${list.length?list.map(o=>`<article class="mobile-kanban-card ${productionDeadlineClass(o)}">
          <div class="mobile-card-head">
            <div><div class="mobile-id">#${o.id}</div><strong>${escapeHtml(o.patient)||"—"}</strong><div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div></div>
            <div class="production-deadline-stack">${productionTomorrowBadge(o)}<span class="mobile-deadline">${fmtDate(o.deadline)}</span></div>
          </div>
          <div class="mobile-muted">${escapeHtml(o.workType)||"—"} · ${o.elements} elem.</div>
          <button class="secondary-btn mobile-full-select technician-production-view" type="button" onclick="editOrder(${o.id})">🦷 Vezi fișa</button>
          <div class="mobile-stage-block">${technicianStageHtml(o,true)}</div>
        </article>`).join(""):'<div class="mobile-stage-empty">Nicio lucrare</div>'}
      </section>`;
    }).join("")}</div>`;
  }else{
    content.innerHTML=dateBar+`
      <div class="doctor-production-note">Sunt afișate doar lucrările tale în statusurile operaționale: Neînceput · Început · Finalizat · Livrat.</div>
      <div class="kanban-wrap technician-production-wrap">
        <div class="kanban technician-production-kanban">${techStatuses.map(stage=>{
          const list=sortProductionByDeadline(baseOrders.filter(o=>String(o.status||"")===stage));
          return `<div class="kanban-col technician-production-col">
            <div class="kanban-title"><span>${escapeHtml(uiText(stage))}</span><span class="kanban-count">${list.length}</span></div>
            <div class="kanban-card-list">${list.length?list.map(card).join(""):'<div class="mobile-stage-empty">Nicio lucrare</div>'}</div>
          </div>`;
        }).join("")}</div>
      </div>`;
  }

  wireDateRangeFilters("production",renderProduction);
};

function toggleDashboardProductionMaximize(){
  if(!isDashboard()||currentView!=="production")return;
  document.body.classList.toggle("dashboard-production-maximized");
  renderProduction();
}
window.toggleDashboardProductionMaximize=toggleDashboardProductionMaximize;

/* ---------------- TECHNICIAN PATIENTS: ASSIGNED CASES, NO PRICING ---------------- */

const renderPatientsV184Base=renderPatients;
renderPatients=function(){
  if(!isTechnician())return renderPatientsV184Base();

  pageTitle.textContent="Pacienți";
  pageSubtitle.textContent="Cazurile din lucrările tale · vizualizare fără date comerciale";
  const visible=applyViewDateRanges(displayedOrders(),"patients");
  const dateBar=dateRangeFilterBar("patients",[{field:"deadline",label:"Termen"}]);
  updateOldToggle();

  let rows=filterByReportControls(visible,patientReportFilters);
  const partners=[...new Set(visible.map(o=>o.partner).filter(Boolean))];
  const types=[...new Set(visible.map(o=>o.workType).filter(Boolean))];
  const filterBar=`<div class="report-filter-panel">
    <div class="report-filter-head"><div><strong>Filtre pacienți</strong><span>${rows.length} lucrări</span></div></div>
    <div class="report-filter-grid">
      <label>Status<select data-patient-report-filter="status">${reportSelect(statuses,patientReportFilters.status,"Toate statusurile")}</select></label>
      <label>Pacient<input data-patient-report-filter="patient" value="${escapeHtml(patientReportFilters.patient)}" placeholder="Caută pacient..."></label>
      <label>Partener<select data-patient-report-filter="partner">${reportSelect(partners,patientReportFilters.partner,"Toți partenerii")}</select></label>
      <label>Tip lucrare<select data-patient-report-filter="workType">${reportSelect(types,patientReportFilters.workType,"Toate tipurile")}</select></label>
    </div>
    <div class="report-filter-foot"><span>Doar lucrările la care ai acces · fără prețuri sau discounturi</span><button id="clearPatientReportFilters" class="secondary-btn" type="button">Resetează</button></div>
  </div>`;

  const kpis=`<div class="kpi-grid">
    ${kpi("Pacienți",new Set(rows.map(o=>o.patient).filter(Boolean)).size,"Cazurile tale")}
    ${kpi("Lucrări",rows.length,`${rows.reduce((s,o)=>s+num(o.elements),0)} elemente`)}
    ${kpi("Parteneri",new Set(rows.map(o=>o.partner).filter(Boolean)).size,"Cazurile tale")}
    ${kpi("În producție",rows.filter(o=>String(o.status)==="Started").length,"Status Started")}
  </div>`;

  if(isMobileLayout()){
    content.innerHTML=dateBar+filterBar+kpis+`<div class="mobile-card-list">${rows.length?rows.map(o=>`<article class="mobile-order-card">
      <div class="mobile-card-actions patient-case-actions patient-case-actions-left"><button class="primary-btn mobile-touch-btn" type="button" onclick="editOrder(${o.id})">🦷 Vezi fișa</button></div>
      <div class="mobile-card-head"><div><div class="mobile-id">#${o.id}</div><strong>${escapeHtml(o.patient)||"—"}</strong><div class="mobile-muted">${escapeHtml(o.partner)||"—"}</div></div><span class="mobile-status-badge">${escapeHtml(uiText(o.status)||"—")}</span></div>
      <div class="mobile-card-grid"><div><span>Tip lucrare</span><strong>${escapeHtml(o.workType)||"—"}</strong></div><div><span>Termen</span><strong>${fmtDate(o.deadline)}</strong></div><div><span>Elemente</span><strong>${o.elements}</strong></div></div>
    </article>`).join(""):'<div class="empty-state mobile-empty">Niciun caz pentru filtrele selectate.</div>'}</div>`;
  }else{
    content.innerHTML=dateBar+filterBar+kpis+`<div class="card panel"><div class="table-tools"><strong>Cazurile pacienților</strong><span class="table-count">${rows.length} lucrări</span></div><div class="table-wrap patient-detail-table"><table>
      <thead><tr><th>Fișă</th><th>Pacient</th><th>Partener</th><th>Tip lucrare</th><th>Termen</th><th>Elemente</th><th>Status</th></tr></thead>
      <tbody>${rows.length?rows.map(o=>`<tr><td><button class="primary-btn case-sheet-row-btn" type="button" onclick="editOrder(${o.id})">🦷 Vezi fișa</button></td><td><strong>${escapeHtml(o.patient)||"—"}</strong></td><td>${escapeHtml(o.partner)||"—"}</td><td>${escapeHtml(o.workType)||"—"}</td><td>${fmtDate(o.deadline)}</td><td>${o.elements}</td><td>${escapeHtml(uiText(o.status))||"—"}</td></tr>`).join(""):'<tr><td colspan="7">Niciun caz pentru filtrele selectate.</td></tr>'}</tbody>
    </table></div></div>`;
  }

  wirePatientReportFilters();
  wireDateRangeFilters("patients",renderPatients);
};

/* ---------------- MATERIAL QUANTITY: TECHNICIAN-SAFE RPC ---------------- */

adjustMaterialQuantity=async function(id,delta){
  if(!(isManagement()||isTechnician()))return;
  const m=materialsInventory.find(x=>Number(x.id)===Number(id));
  if(!m)return;

  const change=Number(delta||0);
  if(!change)return;
  showLoading("Materiale","Actualizez cantitatea...");
  try{
    const labId=await resolveLabOrganizationId();
    await sbRpc("adjust_material_quantity",{
      p_lab_organization_id:labId,
      p_material_id:Number(id),
      p_mode:change>0?"add":"subtract",
      p_value:Math.abs(change),
      p_expected_quantity:null,
      p_request_key:`ui-material-${id}-${Date.now()}`
    });
    materialsLoaded=false;
    await loadMaterialsData(false);
    if(currentView==="materials")renderMaterials();
  }catch(err){
    alert(`Cantitatea nu a putut fi actualizată: ${err.message}`);
  }finally{hideLoading();}
};
window.adjustMaterialQuantity=adjustMaterialQuantity;

/* ---------------- SHARED + PERSONAL CALENDAR ---------------- */

normalizeCalendarEvent=function(r){
  return {
    id:num(r.ID),title:String(r.Title??""),type:String(r.Event_Type??"Altul"),
    startDate:toDateInputValue(r.Start_Date),endDate:toDateInputValue(r.End_Date),
    startTime:String(r.Start_Time??""),description:String(r.Description??""),status:String(r.Status??"Planificat"),
    scope:String(r.Calendar_Scope??"shared"),ownerUserId:String(r.Owner_User_ID??""),
    createdBy:String(r.Created_By_User_ID??""),createdAt:String(r.Created_At??""),updatedBy:String(r.Updated_By_User_ID??""),updatedAt:String(r.Updated_At??"")
  };
};

function calendarUserAllowed(){return isManagement()||isTechnician();}
function calendarEventCanEdit(event){
  if(!calendarUserAllowed())return false;
  const me=String(auth?.supabaseProfile?.id||"");
  if(String(event?.ownerUserId||"")===me)return true;
  return String(event?.scope||"shared")==="shared";
}

function calendarEventCanDelete(event){
  if(!calendarUserAllowed())return false;
  const me=String(auth?.supabaseProfile?.id||"");
  if(String(event?.ownerUserId||"")===me)return true;
  return isManagement()&&String(event?.scope||"shared")==="shared";
}

loadCalendarData=async function(show=false){
  if(!calendarUserAllowed())return;
  if(calendarLoading)return;
  calendarLoading=true;
  if(show)showLoading("Calendar","Caut evenimentele...");

  try{
    const labId=await resolveLabOrganizationId();
    const {data,error}=await supabaseClient
      .from("lab_calendar_events")
      .select("id,title,event_type,description,status,created_by_user_id,updated_by_user_id,start_date,end_date,start_time,calendar_scope,owner_user_id,created_at,updated_at")
      .eq("lab_organization_id",labId)
      .order("start_date",{ascending:true})
      .order("start_time",{ascending:true});
    if(error)throw new Error(error.message);

    calendarEvents=(data||[]).map(r=>normalizeCalendarEvent({
      ID:r.id,Title:r.title,Event_Type:r.event_type,Description:r.description,Status:r.status,
      Created_By_User_ID:r.created_by_user_id,Updated_By_User_ID:r.updated_by_user_id,
      Start_Date:r.start_date,End_Date:r.end_date,Start_Time:r.start_time,
      Calendar_Scope:r.calendar_scope,Owner_User_ID:r.owner_user_id,
      Created_At:r.created_at,Updated_At:r.updated_at
    }));
    calendarLoaded=true;
  }finally{
    calendarLoading=false;
    if(show)hideLoading();
  }
};

calendarEventsForDay=function(dateStr){
  return calendarEvents.filter(e=>{
    if(String(e.scope||"shared")!==calendarScopeView)return false;
    const start=e.startDate||"",end=e.endDate||start;
    return start&&dateStr>=start&&dateStr<=end;
  }).sort((a,b)=>String(a.startTime||"").localeCompare(String(b.startTime||""))||a.title.localeCompare(b.title));
};

openCalendarEditor=function(id=null,date=null){
  if(!calendarUserAllowed())return;
  if(id){
    const e=calendarEvents.find(x=>Number(x.id)===Number(id));
    if(!e)return;
    calendarEditor={...e,readOnly:!calendarEventCanEdit(e)};
  }else{
    const day=date||calendarIsoDate(new Date());
    calendarEditor={id:0,title:"",type:"Întâlnire",startDate:day,endDate:day,startTime:"",description:"",status:"Planificat",scope:calendarScopeView,ownerUserId:String(auth?.supabaseProfile?.id||""),readOnly:false};
  }
  renderCalendar();
};
window.openCalendarEditor=openCalendarEditor;

calendarRequest=async function(action,data={}){
  if(!calendarUserAllowed())throw new Error("Nu ai acces la calendar.");
  showLoading("Calendar","Salvez evenimentul...");
  try{
    await sbRpc("mutate_calendar_event",{
      p_action:action,
      p_event_id:data.ID?Number(data.ID):null,
      p_fields:{
        title:String(data.Title||"").trim(),event_type:String(data.Event_Type||"").trim(),
        description:String(data.Description||"").trim(),status:String(data.Status||"Planificat").trim(),
        start_date:data.Start_Date||null,end_date:data.End_Date||null,start_time:data.Start_Time||null,
        calendar_scope:String(data.Calendar_Scope||"shared")
      },
      p_request_key:`ui-calendar-${action}-${data.ID||"new"}-${Date.now()}`
    });

    calendarLoaded=false;calendarEditor=null;
    await loadCalendarData(false);
    if(currentView==="calendar")renderCalendar();
    return {ok:true};
  }finally{hideLoading();}
};

saveCalendarEditor=async function(){
  if(calendarEditor?.readOnly)return;
  const data={
    ID:num($("calendarEventId")?.value),Title:String($("calendarTitle")?.value||"").trim(),
    Event_Type:$("calendarType")?.value||"Altul",Start_Date:$("calendarStartDate")?.value||"",
    End_Date:$("calendarEndDate")?.value||$("calendarStartDate")?.value||"",Start_Time:$("calendarStartTime")?.value||"",
    Description:String($("calendarDescription")?.value||"").trim(),Status:$("calendarStatus")?.value||"Planificat",
    Calendar_Scope:$("calendarScope")?.value||calendarScopeView
  };
  if(!data.Title||!data.Start_Date){alert("Titlul și data de început sunt obligatorii.");return;}
  await calendarRequest(data.ID?"update":"create",data);
};
window.saveCalendarEditor=saveCalendarEditor;

renderCalendar=function(){
  if(!calendarUserAllowed()){content.innerHTML="";return;}
  pageTitle.textContent="Calendar";
  pageSubtitle.textContent=calendarScopeView==="shared"?"Calendar partajat pentru întreg laboratorul":"Calendarul meu personal";

  if(!calendarLoaded){
    content.innerHTML='<div class="card panel calendar-loading-state">Caut evenimentele...</div>';
    loadCalendarData(false).then(()=>{if(currentView==="calendar")renderCalendar();}).catch(err=>{if(currentView==="calendar")content.innerHTML=`<div class="card panel error-text">${escapeHtml(err.message)}</div>`;});
    return;
  }

  const monthStart=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1);
  const weekday=(monthStart.getDay()+6)%7;
  const gridStart=new Date(monthStart);gridStart.setDate(monthStart.getDate()-weekday);
  const monthLabel=monthStart.toLocaleDateString("ro-RO",{month:"long",year:"numeric"});
  const today=calendarIsoDate(new Date());
  const weekdays=["Lun","Mar","Mie","Joi","Vin","Sâm","Dum"];
  const cells=[];

  for(let i=0;i<42;i++){
    const d=new Date(gridStart);d.setDate(gridStart.getDate()+i);
    const ds=calendarIsoDate(d),events=calendarEventsForDay(ds),current=d.getMonth()===monthStart.getMonth();
    cells.push(`<div class="calendar-day ${current?"":"calendar-day-outside"} ${ds===today?"calendar-day-today":""}" ondblclick="openCalendarEditor(null,'${ds}')">
      <div class="calendar-day-head"><button type="button" onclick="openCalendarEditor(null,'${ds}')">${d.getDate()}</button>${events.length?`<span>${events.length}</span>`:""}</div>
      <div class="calendar-events">${events.slice(0,4).map(e=>`<button class="calendar-event ${calendarTypeClass(e.type)} ${e.status==="Finalizat"?"calendar-event-done":""}" type="button" onclick="openCalendarEditor(${e.id})"><span>${e.startTime?escapeHtml(e.startTime)+" · ":""}</span>${escapeHtml(e.title)}${calendarEventCanEdit(e)?"":'<em class="calendar-readonly-dot">◉</em>'}</button>`).join("")}${events.length>4?`<div class="calendar-more">+${events.length-4} evenimente</div>`:""}</div>
    </div>`);
  }

  const ro=Boolean(calendarEditor?.readOnly);
  const disabled=ro?"disabled":"";
  const scopeDisabled=ro||(calendarEditor?.id&&String(calendarEditor?.ownerUserId||"")!==String(auth?.supabaseProfile?.id||""))?"disabled":"";
  const editor=calendarEditor?`<div class="calendar-editor-backdrop" onclick="if(event.target===this)closeCalendarEditor()"><div class="calendar-editor-card">
    <div class="calendar-editor-head"><div><span>${calendarEditor.id?`Eveniment #${calendarEditor.id}`:"Eveniment nou"}</span><h3>${ro?"Vezi eveniment":(calendarEditor.id?"Editează eveniment":"Adaugă în calendar")}</h3></div><button class="icon-btn" type="button" onclick="closeCalendarEditor()">×</button></div>
    <input id="calendarEventId" type="hidden" value="${calendarEditor.id||0}">
    <div class="calendar-editor-grid">
      <label class="wide">Titlu<input id="calendarTitle" value="${escapeHtml(calendarEditor.title||"")}" ${disabled}></label>
      <label>Calendar<select id="calendarScope" ${scopeDisabled}><option value="shared" ${calendarEditor.scope!=="personal"?"selected":""}>Partajat laborator</option><option value="personal" ${calendarEditor.scope==="personal"?"selected":""}>Personal</option></select></label>
      <label>Tip<select id="calendarType" ${disabled}>${optionHtml(CALENDAR_EVENT_TYPES,calendarEditor.type||"Întâlnire",false)}</select></label>
      <label>Status<select id="calendarStatus" ${disabled}>${optionHtml(CALENDAR_STATUSES,calendarEditor.status||"Planificat",false)}</select></label>
      <label>Data start<div class="date-input-with-picker"><input id="calendarStartDate" type="date" value="${escapeHtml(calendarEditor.startDate||"")}" ${disabled}><button class="date-picker-btn" type="button" data-date-picker="calendarStartDate" ${disabled}>📅</button></div></label>
      <label>Data stop<div class="date-input-with-picker"><input id="calendarEndDate" type="date" value="${escapeHtml(calendarEditor.endDate||calendarEditor.startDate||"")}" ${disabled}><button class="date-picker-btn" type="button" data-date-picker="calendarEndDate" ${disabled}>📅</button></div></label>
      <label>Ora<input id="calendarStartTime" type="time" value="${escapeHtml(calendarEditor.startTime||"")}" ${disabled}></label>
      <label class="wide">Detalii<textarea id="calendarDescription" rows="4" ${disabled}>${escapeHtml(calendarEditor.description||"")}</textarea></label>
    </div>
    <div class="calendar-editor-actions">${calendarEditor.id&&!ro&&calendarEventCanDelete(calendarEditor)?`<button class="danger-btn" type="button" onclick="deleteCalendarEvent(${calendarEditor.id})">Șterge</button>`:"<span></span>"}<span></span><button class="secondary-btn" type="button" onclick="closeCalendarEditor()">${ro?"Închide":"Anulează"}</button>${ro?"":'<button class="primary-btn" type="button" onclick="saveCalendarEditor()">Salvează</button>'}</div>
  </div></div>`:"";

  content.innerHTML=`<div class="calendar-scope-switch card"><button class="${calendarScopeView==="shared"?"active":""}" data-calendar-scope="shared" type="button">👥 Partajat laborator</button><button class="${calendarScopeView==="personal"?"active":""}" data-calendar-scope="personal" type="button">◉ Personal</button></div>
  <div class="calendar-toolbar card"><div><button id="calendarPrev" class="secondary-btn" type="button">‹</button><button id="calendarToday" class="secondary-btn" type="button">Azi</button><button id="calendarNext" class="secondary-btn" type="button">›</button></div><h2>${escapeHtml(monthLabel)}</h2><button id="calendarAdd" class="primary-btn" type="button">+ Eveniment</button></div>
  <div class="calendar-board card"><div class="calendar-weekdays">${weekdays.map(x=>`<div>${x}</div>`).join("")}</div><div class="calendar-grid">${cells.join("")}</div></div>${editor}`;

  document.querySelectorAll("[data-calendar-scope]").forEach(btn=>btn.addEventListener("click",()=>{calendarScopeView=btn.dataset.calendarScope;calendarEditor=null;renderCalendar();}));
  $("calendarPrev")?.addEventListener("click",()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderCalendar();});
  $("calendarNext")?.addEventListener("click",()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderCalendar();});
  $("calendarToday")?.addEventListener("click",()=>{const n=new Date();calendarMonth=new Date(n.getFullYear(),n.getMonth(),1);renderCalendar();});
  $("calendarAdd")?.addEventListener("click",()=>openCalendarEditor(null,calendarIsoDate(new Date())));
  document.querySelectorAll('[data-date-picker="calendarStartDate"],[data-date-picker="calendarEndDate"]').forEach(btn=>btn.addEventListener("click",()=>{if(!btn.disabled)openNativeDatePicker($(btn.dataset.datePicker));}));
};


setInterval(()=>{
  if(auth)loadAll(false).catch(()=>{});
},AUTO_REFRESH_MS);

if(window.location.protocol==="file:"){
  alert("Run this folder with python3 -m http.server 8080 and open http://localhost:8080");
}

(async()=>{
  const saved=loadSavedAuth();

  if(!saved){
    showLogin();
    return;
  }

  showLoading("Refac sesiunea","Verific accesul și pregătesc spațiul de lucru...");
  try{
    const valid=await validateSupabaseSavedSession(saved);
    if(!valid)throw new Error("Sesiunea ta nu mai este validă.");

    auth=saved;
    authEpoch++;
    resetRuntimeState();
    restoreSessionForUser(auth.user.User_ID);

    await initializeApp({showLoader:false});
    showApp();
  }catch{
    clearAuth();
    showLogin();
  }finally{
    hideLoading();
  }
})();
