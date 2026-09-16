// Runs in Node or in JavaScriptCore via tests/sql/test_billing_ui_runtime.py.
// Only RPC/network and DOM boundaries are replaced; production functions execute unchanged.
(function(){
  const source=typeof APP_SOURCE==='string'?APP_SOURCE:require('node:fs').readFileSync(require('node:path').join(__dirname,'../../website/app/app.js'),'utf8');
  const cases=[];
  const test=(name,run)=>cases.push({name,run});
  function assert(value,message){if(!value)throw new Error(message);}
  function named(name){
    const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert(start>=0,`Missing production function: ${name}`);
    for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){
      const code=source.slice(start,end+1);
      try{Function(`return (${code})`);return code;}catch{}
    }
    throw new Error(`Cannot extract ${name}`);
  }
  function bind(env,name){return Function('env',`with(env){return (${named(name)});}`)(env);}
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  function environment(){
    const box={innerHTML:'current'},hint={textContent:'current',classList:{add(){},remove(){}}};
    const env={auth:{user:{User_ID:'admin',Role:'Admin',Technician_Name:'Denis'}},authEpoch:1,
      toothPriceEstimateRequest:7,toothPriceEstimateTimer:42,orderId:{value:'19'},priceHint:hint,
      $:()=>box,box,can:()=>env.pricing,isTechnician:()=>env.auth?.user.Role==='Technician',
      isManagement:()=>['Admin','Manager'].includes(env.auth?.user.Role),pricing:true,
      resolveLabOrganizationId:async()=>'lab',rendered:[],renderToothPriceBreakdown:r=>env.rendered.push(r),
      calls:[],pending:deferred(),sbRpc:(name,args)=>{env.calls.push({name,args});return env.pending.promise;},
      BILLING_MODE_LABELS:{per_tooth:'Per dinte',per_arch:'Per arcadă',per_piece:'Per piesă'},
      num:v=>Number(v)||0,money:v=>`${Number(v).toFixed(2)} RON`,uiText:String,
      adminConfigData:{workTypes:[{Tip_Lucrare:'Arc',Billing_Mode:'per_piece'}]}};
    for(const name of ['requestContextValid','normalize','escapeHtml','normalizeBillingMode','billingModeLabel','technicianMoney','adminInput'])env[name]=bind(env,name);
    return env;
  }
  async function startPrice(env){
    const task=bind(env,'loadSavedWorkOrderPriceLines')({id:19},7);
    await Promise.resolve();
    assert(env.calls.length===1,'Expected saved-price RPC to start');
    return {task};
  }
  const changes={
    logout:e=>{e.auth=null;e.authEpoch++;},
    'changed user':e=>{e.auth.user.User_ID='another';},
    'technician role':e=>{e.auth.user.Role='Technician';},
    'doctor role with pricing permission retained':e=>{e.auth.user.Role='Doctor';},
    'removed pricing permission':e=>{e.pricing=false;},
    'new session with same user and order ID':e=>{e.authEpoch++;},
    'new request':e=>{e.toothPriceEstimateRequest++;},
    'different order':e=>{e.orderId.value='20';}
  };
  for(const [label,change] of Object.entries(changes))for(const failure of [false,true]){
    test(`saved prices discard ${failure?'error':'success'} after ${label}`,async()=>{
      const env=environment(),{task}=await startPrice(env);change(env);
      if(failure)env.pending.reject(new Error('old session error'));else env.pending.resolve({lines:[{unit_price:999}]});
      await task;
      assert(env.rendered.length===0,'Stale commercial response rendered');
      assert(env.box.innerHTML==='current'&&env.priceHint.textContent==='current','Stale response changed current UI');
    });
  }
  test('current saved-price success renders and current error reports',async()=>{
    const env=environment(),{task}=await startPrice(env);env.pending.resolve({lines:[]});await task;
    assert(env.rendered.length===1&&env.rendered[0].saved,'Valid saved response was discarded');
    env.pending=deferred();const next=bind(env,'loadSavedWorkOrderPriceLines')({id:19},7);
    await Promise.resolve();env.pending.reject(new Error('unavailable'));await next;
    assert(env.priceHint.textContent.includes('unavailable'),'Current error hidden');
  });
  test('technicians cannot start the commercial request',async()=>{
    const env=environment();env.auth.user.Role='Technician';
    await bind(env,'loadSavedWorkOrderPriceLines')({id:19},7);
    assert(env.calls.length===0,'Technician started commercial RPC');
  });
  test('runtime reset invalidates pending pricing work and cancels timer',()=>{
    const env=environment();let cleared=null;
    Object.assign(env,{clearTimeout:id=>{cleared=id;},caseSheetBackdrop:null,chatMessages:{},content:{},lastRefresh:{},setConnection(){},activeChatGeneration:1});
    bind(env,'resetRuntimeState')();
    assert(env.toothPriceEstimateRequest>7,'Reset retained pricing request generation');
    assert(cleared===42&&env.toothPriceEstimateTimer===null,'Reset retained pricing timer');
  });
  const history={Work_Order_ID:19,Sale_Price:{Final_Price:987654321},Assignments:[{
    Assignment_ID:'a1',Stage:'Model',Technician:'Denis',Original_Agreed_Amount:170,Agreed_Amount:270,
    Cost_Lines:[
      {work_type:'Crown',billing_mode:'per_tooth',quantity:2,unit_cost:10,amount:20},
      {work_type:'Arc',billing_mode:'per_arch',quantity:1,unit_cost:100,amount:100},
      {work_type:'Piece',billing_mode:'per_piece',quantity:1,unit_cost:50,amount:50}],
    Adjustments:[{work_type:'Arc',billing_mode:'per_arch',quantity_delta:1,unit_cost:100,amount:100}]
  }]};
  function costEnvironment(){
    const env=environment();
    for(const name of ['technicianCostBreakdownHtml','technicianCostDisclosureHtml'])env[name]=bind(env,name);
    return env;
  }
  test('saved mixed-mode costs show frozen basis, signed arch adjustment and totals',()=>{
    const env=costEnvironment();
    const html=env.technicianCostBreakdownHtml(history,'Denis');
    for(const text of ['Per dinte','Per arcadă','Per piesă','Tarif','Unități','Bază','Ajustare','+1','+100.00 RON','270.00 RON','Total Arc','2','200.00 RON'])assert(html.includes(text),`Missing cost basis: ${text}`);
    assert(/Total Arc[\s\S]*?<td>2<\/td>[\s\S]*?200.00 RON/.test(html),'Adjusted arch must total two billable units and 200 RON');
    assert(html.includes('<caption>')&&html.includes('scope="col"'),'Cost table lacks accessible headers');
    assert(!html.includes('987654321')&&!html.includes('Sale_Price'),'Commercial data rendered in cost breakdown');
    assert(html.includes('100.00 RON'),'Frozen tariff replaced by catalog');
  });
  test('negative arch adjustment preserves base and shows reduced total quantity',()=>{
    const env=costEnvironment(),data=JSON.parse(JSON.stringify(history));
    data.Assignments[0].Adjustments[0].quantity_delta=-1;data.Assignments[0].Adjustments[0].amount=-100;data.Assignments[0].Agreed_Amount=70;
    const html=env.technicianCostBreakdownHtml(data,'Denis');
    assert(html.includes('-1')&&html.includes('-100.00 RON'),'Negative adjustment lost its sign');
    assert(/Total Arc[\s\S]*?<td>0<\/td>[\s\S]*?0.00 RON/.test(html),'Arch effective quantity and total are not zero');
    assert(html.includes('170.00 RON')&&html.includes('70.00 RON'),'Base or adjusted agreement missing');
  });
  test('cost disclosure is accessible to management and assigned technician, excludes other roles',()=>{
    const env=costEnvironment();
    for(const role of ['Admin','Manager','Technician']){
      env.auth.user.Role=role;const html=env.technicianCostDisclosureHtml({id:19},'Denis');
      assert(html.includes('<details')&&html.includes('<summary>')&&html.includes('loadSavedTechnicianCostBreakdown(this)'),'Missing keyboard-accessible cost disclosure');
    }
    env.auth.user.Role='Doctor';assert(env.technicianCostDisclosureHtml({id:19},'Denis')==='','Doctor received cost disclosure');
  });
  test('history loader uses guarded history RPC and frozen costs for technician',async()=>{
    const env=costEnvironment();env.auth.user.Role='Technician';
    const box={innerHTML:'',textContent:''};
    const details={open:true,isConnected:true,dataset:{orderId:'19',technician:'Denis'},querySelector:()=>box};
    const task=bind(env,'loadSavedTechnicianCostBreakdown')(details);await Promise.resolve();
    assert(env.calls[0]?.name==='get_work_order_financial_history'&&env.calls[0]?.args.p_work_order_id===19,'Wrong financial endpoint');
    env.pending.resolve(history);await task;
    assert(box.innerHTML.includes('Per arcadă')&&!box.innerHTML.includes('987654321'),'History did not render safe frozen cost basis');
  });
  for(const failure of [false,true])test(`cost history discards stale ${failure?'error':'success'}`,async()=>{
    const env=costEnvironment(),box={innerHTML:'current',textContent:''};
    const details={open:true,isConnected:true,dataset:{orderId:'19',technician:'Denis'},querySelector:()=>box};
    const task=bind(env,'loadSavedTechnicianCostBreakdown')(details);await Promise.resolve();env.authEpoch++;
    box.textContent='new session';
    if(failure)env.pending.reject(new Error('old error'));else env.pending.resolve(history);
    await task;assert(box.innerHTML==='current'&&box.textContent==='new session','Stale cost history updated DOM');
  });
  test('Admin tariff displays mode beside the cost input',()=>{
    const env=environment();env.adminCostBillingModeLabel=bind(env,'adminCostBillingModeLabel');
    const html=bind(env,'adminCostTariffHtml')('costValue9',50,'Arc');
    assert(html.includes('50')&&html.includes('Per piesă'),'Configured mode absent beside tariff');
    assert(env.adminCostBillingModeLabel('unknown')==='—','Unknown type falsely claims a configured mode');
  });
  const run=async()=>{const results=[];for(const item of cases){try{await item.run();results.push({name:item.name,ok:true});}catch(error){results.push({name:item.name,ok:false,error:String(error.message||error)});}}return results;};
  if(typeof APP_SOURCE==='string')run().then(results=>{globalThis.BILLING_TEST_RESULTS=results;});
  else require('node:test')('billing integration behavior',async()=>{
    const results=await run();assert(results.every(r=>r.ok),JSON.stringify(results.filter(r=>!r.ok),null,2));
  });
})();
