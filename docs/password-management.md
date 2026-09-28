# Parole și invitații — activare

Implementare locală: login cu nickname păstrat; recuperare prin email cu Turnstile; schimbare din cont; creare cu invitație (implicit în UI) sau parolă inițială. Nu necesită migrare SQL și nici schimbarea workflow-urilor n8n.

## 1. SMTP în Supabase Auth

În Authentication → Email/SMTP settings activează Custom SMTP. Credentialele Gmail OAuth din n8n nu pot fi reutilizate ca parolă SMTP.

Pentru contul Workspace existent, dacă politica organizației permite parole de aplicație:

- Host: `smtp.gmail.com`
- Port: `587` (TLS/STARTTLS)
- Username: `contact@flowrisedental.ro` (contul real, nu aliasul)
- Password: parola de aplicație generată în contul Google cu verificare în doi pași; nu parola obișnuită și nu un token OAuth n8n.
- Sender email: `app@flowrisedental.ro`
- Sender name: `Flowrise Dental Studio`

Verifică aliasul și dreptul de expediere din contul contact. Dacă politica Workspace blochează parolele de aplicație, configurează SMTP relay autorizat cu administratorul sau un furnizor SMTP; nu dezactiva protecțiile contului. Testează expeditorul efectiv primit și livrarea la o adresă din afara echipei Supabase.

Referințe: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Google Workspace SMTP](https://support.google.com/a/answer/176600).

## 2. URL-urile de autentificare

Authentication → URL Configuration:

- Site URL: `https://app.flowrisedental.ro/`
- Redirect URLs: `https://app.flowrisedental.ro/password.html?mode=reset`
- Redirect URLs: `https://app.flowrisedental.ro/password.html?mode=invite`

Fără wildcard global. Linkurile folosesc fluxul implicit Supabase, cu sesiune extrasă din fragment și verificată prin `getUser`. Pagina elimină fragmentul din adresă imediat la inițializare. Nu înlocui `ConfirmationURL` cu URL-ul paginii în șabloane: linkul trebuie mai întâi verificat de Supabase.

## 3. Setări de securitate

Păstrează CAPTCHA Turnstile activ în Supabase Auth. Verifică domeniul aplicației în widget. Configurează minimum 12 caractere pentru parole și limitele email/recovery în Auth; validarea HTML singură nu impune politica API. Nu activa înregistrarea publică dacă accesul rămâne pe bază de invitație. Setează o expirare rezonabilă a linkurilor (de exemplu 1 oră) în setările Auth disponibile.

La schimbare reușită cerem deconectarea globală; tokenurile de acces deja emise pot rămâne valide până la expirarea lor. Dacă revocarea nu poate fi confirmată, utilizatorul vede explicit situația. Dacă proiectul impune reautentificare și sesiunea este prea veche, pagina cere reconectare sau recuperare prin email.

## 4. Deploy Edge Function

În Edge Functions → Secrets setează:

```
APP_PASSWORD_REDIRECT_URL=https://app.flowrisedental.ro/password.html
```

Redeploy `admin-users` folosind doar `db/edge-functions/admin-users/index.ts`. Codul invitațiilor este inclus în acest fișier, fără importuri locale și fără fișiere `.mjs` suplimentare. În editorul Dashboard înlocuiește conținutul `index.ts`; dacă ai adăugat anterior `invitations.mjs`, elimină acel fișier auxiliar. Păstrează verificarea identității și rolului din funcție.

Redirectul este configurație server, nu este acceptat din payload-ul browserului. Invitațiile sunt permise doar administratorilor verificați. Dacă provisionarea profilului/asignării eșuează după trimiterea invitației, codul existent încearcă ștergerea contului nou; verifică logul și starea contului înainte de reluare. Emailul deja expediat nu poate fi retras.

## 5. Șabloane email și web

În Authentication → Email Templates:

- Invite user: `db/auth-email-templates/invite.html`, subiect „Invitație · Flowrise Dental Studio”.
- Reset password: `db/auth-email-templates/recovery.html`, subiect „Resetarea parolei · Flowrise Dental Studio”.

Publică fișierele web și configurația Caddy după SMTP, redirecturi și Edge. Push-ul declanșează Coolify în acest proiect; implementarea locală nu înseamnă că pașii Supabase sunt aplicați. Pagina de parole este separată de bootstrap-ul dashboardului; sesiunea din link nu reutilizează contul deschis în aplicație.

## 6. Test de acceptare

1. Cont de test existent: „Ai uitat parola?”, CAPTCHA, email, link, două parole identice de minimum 12 caractere. Confirmă login cu nickname și noua parolă; cea veche trebuie respinsă.
2. Din cont: „Schimbă parola”; confirmă salvarea și reconectarea.
3. Cont nou cu email real: creează cu „Trimite invitație pe email”, deschide linkul într-un browser nou, setează parola, verifică rolul/asignările în aplicație.
4. Refolosește linkul, apoi testează unul expirat: formularul de setare nu trebuie activat fără sesiune verificată; opțiunea de recuperare rămâne disponibilă.
5. Deschide invitația altui cont într-un browser cu un cont deja conectat: pagina trebuie să afișeze emailul din invitație, nu contul anterior.
6. Email necunoscut: mesaj generic; CAPTCHA lipsă și cereri repetate: respingere/limitare. Nu testa cu rafale în producție.
7. Invitație pierdută: utilizatorul poate solicita un link de resetare la emailul contului deja creat. Nu crea un cont duplicat.

Testele automate folosesc mock-uri pentru Auth/SMTP; expedierea și politica reală a proiectului trebuie confirmate prin acest test de acceptare. Nu trimite parole, chei sau linkuri de resetare în chat/loguri.
