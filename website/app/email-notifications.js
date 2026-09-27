/* User preferences use authenticated RPCs; email delivery stays server-side. */
(function(){
  const dialog=document.getElementById('emailPreferencesDialog');
  const form=document.getElementById('emailPreferencesForm');
  const fields=document.getElementById('emailPreferencesFields');
  const status=document.getElementById('emailPreferencesStatus');
  const save=document.getElementById('emailPreferencesSave');
  const newOrder=document.getElementById('myNotifyNew');
  const stage=document.getElementById('myNotifyStage');
  let generation=0,busy=false,sessionEpoch;
  const valid=request=>request===generation&&dialog.open&&auth&&sessionEpoch===authEpoch;
  document.getElementById('emailPreferencesBtn').addEventListener('click',async()=>{
    if(!auth)return;
    const request=++generation;sessionEpoch=authEpoch;
    busy=false;fields.disabled=true;save.disabled=true;
    newOrder.checked=false;stage.checked=false;status.textContent='Se încarcă preferințele…';
    dialog.showModal();
    try{
      const data=await sbRpc('get_my_email_preferences');
      if(!valid(request))return;
      if(!Array.isArray(data)||!data[0])throw new Error('Preferințele nu sunt disponibile pentru acest cont.');
      newOrder.checked=data[0].notify_new_work_order===true;stage.checked=data[0].notify_stage_status===true;
      fields.disabled=false;save.disabled=false;status.textContent='';
    }catch(error){if(valid(request))status.textContent=error.message;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||save.disabled||!valid(generation))return;
    const request=generation;busy=true;save.disabled=true;fields.disabled=true;status.textContent='Se salvează…';
    try{
      await sbRpc('set_my_email_preferences',{p_new:newOrder.checked,p_stage:stage.checked});
      if(!valid(request))return;
      legacyAdminCache=null;
      status.textContent='Preferințele au fost salvate.';
    }catch(error){if(valid(request))status.textContent=error.message;}
    finally{if(valid(request)){busy=false;save.disabled=false;fields.disabled=false;}}
  });
  document.getElementById('emailPreferencesClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{generation++;});
  const clear=clearAuth;
  clearAuth=function(...args){generation++;if(dialog.open)dialog.close();return clear(...args);};
})();
