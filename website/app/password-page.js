(async()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const mode=new URLSearchParams(location.search).get('mode')||'request';
  const hash=location.hash;
  // Remove credentials from the address bar, including invalid/expired callbacks.
  history.replaceState(null,'',location.pathname+location.search);
  const status=(message,error=false)=>{el('passwordStatus').textContent=message;el('passwordStatus').dataset.error=String(error);};
  let client;
  try{
    const config=window.FLOWRISE_SUPABASE;
    if(!config?.enabled||!window.supabase)throw new Error('Serviciul nu este disponibil. Reîncarcă pagina.');
    const change=mode==='change';
    client=window.supabase.createClient(config.projectUrl,config.publishableKey,{auth:{
      persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'implicit',
      storage:sessionStorage,storageKey:change?'flowrise_supabase_auth':'flowrise_password_auth'
    }});
    const service=PasswordService.createPasswordService(client.auth,new URL('password.html',location.href).href.split('?')[0]);
    if(mode==='request'){
      el('passwordTitle').textContent='Ai uitat parola?';
      el('passwordDescription').textContent='Introdu emailul asociat contului. Îți trimitem un link pentru a alege o parolă nouă.';
      el('recoveryForm').hidden=false;
      let busy=false, sent=false;
      const captcha=LoginSecurity.create({siteKey:config.turnstileSiteKey,container:el('recoveryCaptcha'),onStateChange(s){el('captchaStatus').textContent=s.error||'';el('requestReset').disabled=busy||sent||!s.ready;}});
      captcha.load();
      el('recoveryForm').addEventListener('submit',async e=>{
        e.preventDefault();if(busy||sent)return;busy=true;el('requestReset').disabled=true;status('Trimit cererea…');
        try{await service.request(el('recoveryEmail').value,captcha.getToken());sent=true;status('Dacă există un cont pentru această adresă, vei primi un email cu instrucțiuni. Verifică și folderul Spam.');}
        catch(error){status(error.message,true);}
        finally{busy=false;captcha.reset();}
      });
      return;
    }
    if(!['change','reset','invite'].includes(mode))throw new Error('Link nevalid. Solicită un link nou.');
    el('passwordTitle').textContent=mode==='invite'?'Alege parola contului':'Schimbă parola';
    const tokens=PasswordService.readCallback(hash);
    if(!change&&!tokens)throw new Error('Deschide linkul din email. Dacă a expirat sau a fost folosit, solicită unul nou.');
    // Callback sessions live in separate storage and never reuse an app account.
    const user=await service.verify(change?undefined:tokens);
    el('passwordDescription').textContent=`Setează parola pentru ${user.email||'contul tău'}. După salvare, autentifică-te din nou.`;
    el('passwordForm').hidden=false;
    let saving=false;
    el('passwordForm').addEventListener('submit',async e=>{
      e.preventDefault();if(saving)return;saving=true;el('savePassword').disabled=true;status('Salvez parola…');
      try{
        const result=await service.save(el('newPassword').value,el('confirmPassword').value);
        el('passwordForm').reset();el('passwordForm').hidden=true;
        sessionStorage.removeItem('dental_lab_auth');
        sessionStorage.removeItem('flowrise_supabase_auth');
        sessionStorage.removeItem('flowrise_password_auth');
        status(result.sessionsRevoked?'Parola a fost salvată. Te poți autentifica folosind noua parolă.':'Parola a fost salvată, dar deconectarea celorlalte sesiuni nu a putut fi confirmată. Contactează administratorul.');
      }catch(error){status(error.message,true);saving=false;el('savePassword').disabled=false;}
    });
  }catch(error){
    el('passwordDescription').textContent='Nu pot continua cu acest link sau această sesiune.';
    status(error.message,true);el('requestAnother').hidden=false;
  }
})();
