(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PasswordService=api;
})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  function passwordError(password,confirmation){
    if(password.length<12)return 'Folosește cel puțin 12 caractere.';
    if(password.length>128)return 'Folosește maximum 128 de caractere.';
    if(password!==confirmation)return 'Parolele nu coincid.';
    return '';
  }
  function readCallback(hash){
    const p=new URLSearchParams(hash.replace(/^#/,''));
    if(p.has('error')||p.has('error_code'))throw new Error('Linkul nu mai este valid. Solicită un link nou.');
    if(!['recovery','invite'].includes(p.get('type')))return null;
    if(!p.get('access_token')||!p.get('refresh_token'))return null;
    return {access_token:p.get('access_token'),refresh_token:p.get('refresh_token')};
  }
  function createPasswordService(auth,redirect){
    let verified=false;
    return {
      async request(email,captchaToken){
        email=email.trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Introdu adresa de email a contului.');
        if(!captchaToken)throw new Error('Finalizează verificarea de securitate.');
        const {error}=await auth.resetPasswordForEmail(email,{redirectTo:redirect+'?mode=reset',captchaToken});
        // Never expose account existence through the recovery UI.
        if(error)throw new Error(error.status===429?'Prea multe cereri. Încearcă din nou mai târziu.':'Cererea nu a putut fi trimisă. Încearcă din nou mai târziu.');
      },
      async verify(tokens){
        verified=false;
        if(tokens){const {error}=await auth.setSession(tokens);if(error)throw new Error('Linkul a expirat sau a fost deja folosit. Solicită un link nou.');}
        const {data,error}=await auth.getUser();
        if(error||!data?.user?.id)throw new Error('Sesiunea nu este validă. Autentifică-te sau solicită un link nou.');
        verified=true;
        return data.user;
      },
      async save(password,confirmation){
        if(!verified)throw new Error('Sesiune nevalidată.');
        const message=passwordError(password,confirmation);
        if(message)throw new Error(message);
        const {error}=await auth.updateUser({password});
        if(error)throw new Error(error.code==='same_password'?'Alege o parolă diferită de cea actuală.':error.code==='reauthentication_needed'?'Este necesară o autentificare recentă. Reconectează-te sau folosește „Ai uitat parola?”.':'Parola nu a putut fi salvată. Verifică regulile parolei sau solicită un link nou.');
        verified=false;
        try{
          const {error:signOutError}=await auth.signOut({scope:'global'});
          return {sessionsRevoked:!signOutError};
        }catch{return {sessionsRevoked:false};}
      },
    };
  }
  return {createPasswordService,readCallback,passwordError};
});
