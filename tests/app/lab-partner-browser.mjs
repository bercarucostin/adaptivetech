// Real application scripts and styles, offline RPC fixtures, installed Chrome.
// PLAYWRIGHT_MODULE_PATH may point to a temporary Playwright installation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const output=process.env.SCREENSHOT_DIR||'/tmp/flowrise-portal-review';mkdirSync(output,{recursive:true});
const app=resolve('website/app');
let html=readFileSync(resolve(app,'index.html'),'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g,'')
  .replace(/<script src="supabase-config[^\"]*"><\/script>/g,'')
  .replace(/(src|href)="([^":]+\.(?:js|css|jpg|svg))(\?[^" ]*)?"/g,(_,attr,file)=>`${attr}="${pathToFileURL(resolve(app,file))}"`);
const prelude=`<script>
window.fixtureErrors=[];window.fixtureCalls=[];
window.onerror=message=>fixtureErrors.push(String(message));window.onunhandledrejection=e=>fixtureErrors.push(String(e.reason));
window.alert=message=>{if(!String(message).startsWith('Run this folder'))fixtureErrors.push(String(message));};localStorage.clear();sessionStorage.clear();
window.fetch=()=>Promise.reject(new Error('Unexpected network request'));
window.FLOWRISE_SUPABASE={enabled:true,url:'https://fixture.invalid',anonKey:'fixture'};
window.fixtureClient={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from(table){
  const query={select(){return this},eq(){return this},order(){return this},maybeSingle:async()=>({data:table==='lab_order_pricing_settings'?{default_contract:'General',urgent_window_hours:24}:null,error:null}),then(done){return Promise.resolve({data:[],error:null}).then(done)}};return query;
},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:async()=>{}};window.supabase={createClient:()=>fixtureClient};
</script>`;
html=html.replace(`<script src="${pathToFileURL(resolve(app,'login-security.js'))}">`,prelude+`<script src="${pathToFileURL(resolve(app,'login-security.js'))}">`);
const fixture=resolve(output,'portal.html');writeFileSync(fixture,html);
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
try{
  for(const viewport of [{width:1440,height:1000},{width:1024,height:768},{width:390,height:844},{width:320,height:740}]){
    const page=await browser.newPage({viewport});const label=`${viewport.width}x${viewport.height}`;
    page.on('dialog',async dialog=>dialog.type()==='prompt'?dialog.accept('Termen de livrare neconfirmat'):dialog.accept());
    await page.route(/^https?:/,route=>route.abort());
    await page.goto(pathToFileURL(fixture).href);
    await page.evaluate(async()=>{
      auth={user:{User_ID:'partner',Role:'Lab Partner',Name:'Laborator partener'},supabaseProfile:{id:'partner'},permissions:{Can_View_Work_Orders:true,Can_Create_Work_Orders:true,Can_View_Client_Pricing:true}};
      authEpoch++;labOrganizationId='lab';resolveLabOrganizationId=async()=>'lab';
      window.fixtureOrders=['Not Started','Not Started','Started','Finished','Shipped','List Sent','Paid'].map((status,index)=>({id:index+1,status,locked:index===5,can_edit:status==='Not Started',submission_revision:1,approval_state:index===0?'pending':'approved',deadline:'2030-10-05',deadline_at:'2030-10-05T12:00:00Z',final_price:450+index*90,items:[{work_type:'Coroană zirconiu',quantity:2,color:'A2',processing_requested:true,note:'Finisare și adaptare înainte de livrare'}],price_lines:[{contract:'General',base_subtotal:450,urgent_percent:0,urgency_surcharge:0,line_total:450}]}));
      window.fixtureOrders[5].can_edit=false;
      window.fixtureMessages=[];
      sbRpc=async(name,args)=>{
        fixtureCalls.push({name,args});
        if(name==='list_lab_partner_work_orders')return fixtureOrders;
        if(name==='get_lab_partner_work_order')return fixtureOrders.find(order=>order.id===args.p_order);
        if(name==='get_work_order_reference_data')return {work_types:[{tip_lucrare:'Coroană zirconiu',active:true,processing_enabled:true},{tip_lucrare:'Punte provizorie',active:true,processing_enabled:false}]};
        if(name==='estimate_lab_partner_work_order_price')return {urgent:false,urgent_window_hours:24,final_price:450,lines:[{work_type:'Coroană zirconiu',quantity:2,contract:'General',base_subtotal:400,processing_requested:true,processing_subtotal:50,urgent_percent:0,line_total:450}]};
        if(name==='resubmit_lab_partner_work_order'){const order=fixtureOrders.find(order=>order.id===args.p_order);order.approval_state='pending';order.submission_revision++;return true;}
        if(name==='review_external_work_order'){const order=fixtureOrders.find(order=>order.id===args.p_order);if(args.p_expected_revision!==order.submission_revision)throw new Error('Unseen submission');order.approval_state=args.p_decision==='approve'?'approved':'rejected';order.approval_reason=args.p_reason;return true;}
        if(name==='set_work_order_manual_supplement'){
          const order=fixtureOrders.find(order=>order.id===args.p_order);
          order.final_price=Number(order.final_price)-Number(order.manual_supplement||0)+args.p_amount;
          order.manual_supplement=args.p_amount;order.manual_supplement_reason=args.p_reason;return true;
        }
        if(name==='update_management_work_order_with_supplement')return true;
        if(name==='delete_lab_partner'){partnerCatalog=partnerCatalog.filter(row=>row.id!==args.p_partner);return true;}
        if(name==='chat_search_users')return [{user_id:'admin',display_name:'Administrator Flowrise',username:'admin',role:'Admin',organization_name:'Flowrise Dental'},{user_id:'manager',display_name:'Manager laborator',username:'manager',role:'Manager',organization_name:'Flowrise Dental'}];
        if(name==='chat_list_threads')return [];
        if(name==='chat_open_direct_thread'){if(!['admin','manager'].includes(args.p_other_user))throw new Error('Unexpected recipient');return 'thread';}
        if(name==='chat_get_messages')return fixtureMessages;
        if(name==='chat_mark_read')return true;
        if(name==='chat_send_message'){fixtureMessages.push({id:1,sender_id:'partner',sender_name:'Laborator partener',body:args.p_body,created_at:new Date().toISOString(),attachments:[]});return 1;}
        throw new Error('Unexpected RPC '+name);
      };
      callFileAuthorization=async()=>({files:[{id:'scan',original_file_name:'scanare-coroana-zirconiu.stl'}]});
      loginScreen.classList.add('hidden');appShell.classList.remove('hidden');applyRoleUI();currentView='workorders';await loadAll(false);await humanChatInitialize();
    });
    assert.equal(await page.locator('.nav-item[data-view="patients"]').isVisible(),false);
    assert.equal(await page.locator('.nav-item[data-view="materials"]').isVisible(),false);
    assert.equal(await page.locator('.nav-item[data-view="production"]').getAttribute('class').then(value=>value.includes('hidden')),false);
    assert.match(await page.locator('#content').innerText(),/Neînceput/);
    if(viewport.width<=700){
      assert.equal(await page.locator('.lab-partner-order-card').count(),7);
      assert.match(await page.locator('.lab-partner-order-card').nth(2).innerText(),/În lucru/);
      const nav=await page.locator('.mobile-bottom-nav').boundingBox();assert.ok(nav.height<90,'partner navigation stays on one row');
    }
    await page.screenshot({path:resolve(output,`partner-orders-${label}.png`),fullPage:true});
    await page.locator('#humanChatLauncher').click();await page.locator('#humanChatSearch').fill('a');
    await page.waitForFunction(()=>document.querySelectorAll('[data-human-chat-user]').length===2);
    await page.locator('[data-human-chat-user="manager"]').click();
    await page.waitForFunction(()=>document.getElementById('humanChatTitle').textContent==='Manager laborator');
    await page.locator('#humanChatText').fill('Bună ziua! Aș dori confirmarea termenului de livrare.');
    await page.locator('#humanChatSend').click();
    await page.waitForFunction(()=>document.getElementById('humanChatMessages').textContent.includes('confirmarea termenului'));
    await assertPageFits(page,label);await page.screenshot({path:resolve(output,`partner-chat-${label}.png`),fullPage:true});
    await page.locator('#humanChatMinimize').click();
    await page.evaluate(()=>{currentView='production';render();});
    assert.equal(await page.locator('[data-partner-order]').count(),7);
    await page.evaluate(()=>loadAll(false));assert.equal(await page.evaluate(()=>currentView),'production');
    assert.equal(await page.locator('#content [draggable="true"]').count(),0);
    await assertPageFits(page,label);
    await page.screenshot({path:resolve(output,`partner-dashboard-${label}.png`),fullPage:true});
    await page.evaluate(()=>openLabPartnerOrder(2));await page.waitForFunction(()=>document.querySelector('#labPartnerQuote')?.textContent.includes('450'));
    assert.equal(await page.locator('#labPartnerDeadline').isDisabled(),false);
    await assertDialogFits(page,label);
    await page.screenshot({path:resolve(output,`partner-order-form-${label}.png`),fullPage:true});
    await page.locator('#labPartnerNote').fill('Instrucțiuni actualizate de partener');
    await page.locator('#labPartnerForm [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#labPartnerOrderDialog').open);
    assert.equal(await page.evaluate(()=>fixtureOrders[1].approval_state),'pending');
    assert.equal(await page.evaluate(()=>fixtureCalls.findLast(call=>call.name==='resubmit_lab_partner_work_order').args.p_note),'Instrucțiuni actualizate de partener');
    for(const id of [3,6]){
      await page.evaluate(id=>openLabPartnerOrder(id),id);
      assert.equal(await page.locator('#labPartnerDeadline').isDisabled(),true);
      assert.equal(await page.locator('#labPartnerForm [type="submit"],[data-remove-line],[data-delete-file-id],#labPartnerUploadFiles').count(),0);
      await page.locator('#labPartnerClose').click();
    }
    await page.evaluate(async()=>{
      auth.user.Role='Admin';auth.user.Name='Administrator Flowrise';auth.permissions=new Proxy({},{get:()=>true});applyRoleUI();
      loadAll=async()=>{};await openLabPartnerOrder(1);
    });
    await assertDialogFits(page,label);
    await page.locator('#partnerSupplementAmount').fill('50');
    await page.locator('#partnerSupplementReason').fill('Transport');
    assert.match(await page.locator('#partnerSupplementPreview').innerText(),/500/);
    await page.locator('#partnerSupplementSave').click();
    await page.waitForFunction(()=>document.getElementById('partnerSupplementAmount')?.value==='50'&&document.querySelector('#labPartnerQuote')?.textContent.includes('Transport'));
    await assertDialogFits(page,label);
    await page.screenshot({path:resolve(output,`admin-approval-${label}.png`),fullPage:true});
    await page.locator('[data-review-decision="approve"]').click();
    await page.waitForFunction(()=>document.querySelector('#labPartnerForm')?.textContent.includes('Aprobată'));
    assert.equal(await page.locator('[data-review-decision]').count(),0);
    await page.locator('#labPartnerClose').click();
    await page.evaluate(async()=>{auth.user.Role='Manager';applyRoleUI();await openLabPartnerOrder(2);});
    await page.locator('[data-review-decision="reject"]').click();
    await page.waitForFunction(()=>document.querySelector('#labPartnerForm')?.textContent.includes('Refuzată'));
    assert.match(await page.locator('#labPartnerForm').innerText(),/Termen de livrare neconfirmat/);
    await page.locator('#labPartnerClose').click();
    await page.evaluate(()=>{
      auth.user.Role='Admin';applyRoleUI();resetForm();orderId.value='77';
      orderCaseDraft={...newOrderCaseDraft(),selected:[16],perTooth:{16:{type:'Coroană zirconiu'}}};
      setModalRoleMode();orderForm.classList.add('edit-mode');modalTitle.textContent='Editează lucrarea #77';openModal();
      renderToothPriceBreakdown({saved:true,list_price:200,final_price:180,discount:10,element_count:1,manual_supplement:0,lines:[{work_type:'Coroană zirconiu',unit_price:200,subtotal:200,quantity:1,matched:true}]});
    });
    await page.locator('#manualSupplementAmount').fill('50');await page.locator('#manualSupplementReason').fill('Transport');
    assert.equal(await page.locator('#finalPrice').inputValue(),'230');
    for(const id of ['manualSupplementAmount','manualSupplementReason']){
      const rect=await page.locator('#'+id).boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=viewport.width,`${id} exceeds ${label}`);
    }
    if(viewport.width<=600){
      const amount=await page.locator('#manualSupplementAmount').boundingBox(),reason=await page.locator('#manualSupplementReason').boundingBox();
      assert.ok(reason.y>=amount.y+amount.height,'mobile manual supplement fields must stack');
      assert.ok(reason.width>=viewport.width*.6,'mobile reason must be readable');
    }
    assert.notEqual(await page.locator('#manualSupplementAmount').evaluate(el=>getComputedStyle(el).color),'rgb(224, 226, 228)');
    await page.locator('#manualSupplementFields').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(output,`management-supplement-${label}.png`),fullPage:true});
    await page.evaluate(async()=>{
      await saveManagementWorkOrderSupabase(77,{Deadline:'2030-10-05',Nume_Pacient:'Pacient',Nume_Partener:'Laborator partener',Discount:10});
      closeModal();
    });
    const savedSupplement=await page.evaluate(()=>fixtureCalls.find(call=>call.name==='update_management_work_order_with_supplement').args);
    assert.equal(savedSupplement.p_manual_supplement,50);assert.equal(savedSupplement.p_manual_supplement_reason,'Transport');
    await page.evaluate(async()=>{
      manualSupplementDirty=false;document.getElementById('manualSupplementAmount').value='0';
      await saveManagementWorkOrderSupabase(77,{Deadline:'2030-10-05',Nume_Pacient:'Pacient',Nume_Partener:'Laborator partener',Discount:10});
      auth.user.Role='Doctor';setModalRoleMode();
    });
    assert.equal(await page.locator('#manualSupplementFields').isVisible(),false);
    const unchanged=await page.evaluate(()=>fixtureCalls.filter(call=>call.name==='update_management_work_order_with_supplement').at(-1).args);
    assert.equal(unchanged.p_manual_supplement,null,'a save without a fee edit preserves an existing server supplement');

    await page.evaluate(()=>{
      auth.user.Role='Admin';applyRoleUI();
      currentView='adminconfig';adminConfigTab='prices';selectedAdminContract='LUXURY SMILES by Dr.S';
      partnerCatalog=[{id:'partner-lab',name:'Laborator partener',active:true}];
      adminConfigData={prices:[{ID:1,Contract:'General',Tip_Lucrare:'Coroană zirconiu',Pret:450},{ID:2,Contract:'LUXURY SMILES by Dr.S',Tip_Lucrare:'Coroană zirconiu',Pret:500},{ID:3,Contract:'LUXURY SMILES by Dr.S',Tip_Lucrare:'Punte provizorie',Pret:140}],technicianCosts:[{ID:1,Tehnician:'Robert',Tip_Lucrare:'Coroană zirconiu',Etapa:'Model',Cost:35}],workTypes:[{ID:1,Tip_Lucrare:'Coroană zirconiu',Active:true,Billing_Mode:'per_tooth',Processing_Enabled:true}],contracts:['General','LUXURY SMILES by Dr.S'],users:[{User_ID:'partner',Username:'partener',Name:'Laborator partener',Email:'partener@example.invalid',Role:'Lab Partner',Active:true,Partner_ID:'partner-lab',Technician_Name:'',Partner_Name:'Laborator partener'}],roles:['Admin','Manager','Technician','Doctor','Lab Partner']};
      labPricingAdmin={settings:{default_contract:'General',urgent_window_hours:24},defaults:[{contract:'LUXURY SMILES by Dr.S',urgent_percent:10,processing_amount:20}]};render();
    });
    const styles=await page.evaluate(()=>{
      const style=id=>{const s=getComputedStyle(document.getElementById(id));return {font:s.fontFamily,border:s.borderStyle,radius:s.borderRadius,height:parseFloat(s.height),background:s.backgroundColor};};
      return {added:style('pricingUrgentHours'),existing:style('newPriceValue'),heading:getComputedStyle(document.querySelector('.admin-section-head h3')).color};
    });
    assert.equal(styles.added.font,styles.existing.font);assert.notEqual(styles.added.radius,'0px');assert.equal(styles.added.border,'solid');assert.ok(styles.added.height>=44);
    await assertPageFits(page,label);
    if(viewport.width<=700){
      for(const selector of ['#priceUrgent2','#priceProcessing2','#priceValue2']){
        const rect=await page.locator(selector).boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=viewport.width,`${selector} must fit the mobile price card`);
      }
      for(const button of await page.locator('.lab-partner-pricing-table button').all()){
        const rect=await button.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=viewport.width,`mobile price action ${await button.innerText()} exceeds viewport: ${JSON.stringify(rect)}`);
      }
    }
    await page.screenshot({path:resolve(output,`admin-pricing-${label}.png`),fullPage:true});
    await page.evaluate(()=>{adminConfigTab='partners';render();window.confirm=()=>true;});
    assert.equal(await page.getByRole('button',{name:'Șterge',exact:true}).count(),1);
    await assertPageFits(page,label);await page.screenshot({path:resolve(output,`admin-partners-${label}.png`),fullPage:true});
    await page.getByRole('button',{name:'Șterge',exact:true}).click();
    await page.waitForFunction(()=>partnerCatalog.length===0);
    assert.equal(await page.evaluate(()=>fixtureCalls.some(call=>call.name==='delete_lab_partner'&&call.args.p_partner==='partner-lab')),true);
    for(const tab of ['types','costs','users']){
      await page.evaluate(tab=>{adminConfigTab=tab;render();},tab);await assertPageFits(page,label);
      if(tab==='types'){
        const checkbox=await page.locator('#newWorkTypeProcessing').boundingBox();assert.ok(checkbox.width<=24,'processing checkbox follows existing controls');
      }
      await page.screenshot({path:resolve(output,`admin-${tab}-${label}.png`),fullPage:true});
    }
    const errors=await page.evaluate(()=>fixtureErrors);assert.deepEqual(errors,[]);
    results.push({viewport,passed:true});await page.close();
  }
  writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({results,output},null,2));
}finally{await browser.close();}

async function assertPageFits(page,label){
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(dimensions.scroll<=dimensions.width+1,`${label}: page overflows by ${dimensions.scroll-dimensions.width}px`);
}
async function assertDialogFits(page,label){
  const dimensions=await page.evaluate(()=>{
    const d=document.getElementById('labPartnerOrderDialog'),rect=d.getBoundingClientRect();
    const overflow=[...d.querySelectorAll('input,select,textarea,button')].filter(el=>el.getClientRects().length).filter(el=>{const r=el.getBoundingClientRect();return r.left<rect.left-1||r.right>rect.right+1;}).map(el=>el.id||el.textContent);
    return {left:rect.left,right:rect.right,width:innerWidth,scroll:d.scrollWidth,client:d.clientWidth,overflow};
  });
  assert.ok(dimensions.left>=0&&dimensions.right<=dimensions.width,`${label}: dialog exceeds viewport`);
  assert.ok(dimensions.scroll<=dimensions.client+1,`${label}: dialog scrolls horizontally`);
  assert.deepEqual(dimensions.overflow,[],`${label}: controls exceed dialog`);
}
