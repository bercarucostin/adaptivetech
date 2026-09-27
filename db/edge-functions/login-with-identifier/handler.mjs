const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...cors, ...headers } });
const invalid = () => json({ message: 'Nickname/email sau parolă incorectă.' }, 401);
const unavailable = () => json({ message: 'Autentificarea nu este disponibilă momentan.' }, 503);
const throttled = (seconds = 60) => json({ message: 'Prea multe încercări. Încearcă din nou mai târziu.' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil(seconds))) });

async function readBody(req) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createLoginHandler({ getEnv, createClient, fetchImpl = fetch }) {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);
    let body;
    try { body = await readBody(req); } catch { return json({ message: 'Cerere invalidă.' }, 400); }
    if (body === null) return json({ message: 'Cerere prea mare.' }, 413);
    const { identifier, password, captchaToken } = body || {};
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 320 ||
        typeof password !== 'string' || !password || password.length > 1024 ||
        typeof captchaToken !== 'string' || !captchaToken.trim() || captchaToken.length > 4096) {
      return json({ message: 'Completează datele și verificarea de securitate.' }, 400);
    }
    try {
      const url = getEnv('SUPABASE_URL'), anon = getEnv('SUPABASE_ANON_KEY'), service = getEnv('SUPABASE_SERVICE_ROLE_KEY');
      const secret = getEnv('LOGIN_RATE_LIMIT_SECRET');
      if (!url || !anon || !service || !secret || secret.length < 32) return unavailable();
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
      const options = { auth: { persistSession: false, autoRefreshToken: false } };
      const admin = createClient(url, service, options);
      let providerRetryAfter = null;
      const auth = createClient(url, anon, { ...options, global: { fetch: async (...args) => {
        const response = await fetchImpl(...args);
        if (response.status === 429) providerRetryAfter = response.headers.get('Retry-After');
        return response;
      } } });
      // Never trust arbitrary forwarding headers. An authenticated ingress must overwrite both headers.
      const header = getEnv('LOGIN_TRUSTED_IP_HEADER');
      const proxySecret = getEnv('LOGIN_TRUSTED_PROXY_SECRET');
      let ip = 'shared-no-trusted-ip';
      if (header && proxySecret && proxySecret.length >= 32 && req.headers.get('x-login-proxy-secret') === proxySecret) {
        const candidate = req.headers.get(header)?.trim().toLowerCase();
        // Only a single IP literal, never an X-Forwarded-For list. Ingress must canonicalize IPv6.
        if (candidate && candidate.length <= 45 && /^[0-9a-f:.]+$/.test(candidate)) ip = candidate;
      }
      const consume = async (scope, value) => {
        const { data, error } = await admin.rpc('consume_login_rate_limit', { p_scope: scope, p_key: await hash(`${scope}:${value}`) });
        const result = Array.isArray(data) ? data[0] : data;
        if (error || !result || typeof result.allowed !== 'boolean' || !Number.isFinite(result.retry_after)) return unavailable();
        return result.allowed ? null : throttled(result.retry_after);
      };
      const ipDenied = await consume('ip', ip);
      if (ipDenied) return ipDenied;
      let email = identifier.trim().toLowerCase();
      let profile = null;
      if (!email.includes('@')) {
        const { data, error } = await admin.from('profiles').select('id,username,display_name,legacy_user_id,active').eq('username', email).maybeSingle();
        if (error || !data?.id || !data.active) return invalid();
        profile = data;
        const { data: userData, error: userError } = await admin.auth.admin.getUserById(data.id);
        if (userError || !userData?.user?.email) return invalid();
        email = userData.user.email.trim().toLowerCase();
      }
      const accountDenied = await consume('account', email);
      if (accountDenied) return accountDenied;
      const { data: signIn, error } = await auth.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (error?.status === 429) {
        if (providerRetryAfter && (/^\d+$/.test(providerRetryAfter) || Number.isFinite(Date.parse(providerRetryAfter)))) {
          return json({ message: 'Prea multe încercări. Încearcă din nou mai târziu.' }, 429, { 'Retry-After': providerRetryAfter });
        }
        return throttled();
      }
      if (error || !signIn?.session || !signIn?.user) return invalid();
      if (!profile) {
        const { data, error: profileError } = await admin.from('profiles').select('id,username,display_name,legacy_user_id,active').eq('id', signIn.user.id).maybeSingle();
        if (profileError || !data?.id || !data.active) return invalid();
        profile = data;
      }
      const { access_token, refresh_token, expires_at, expires_in, token_type } = signIn.session;
      return json({ ok: true, session: { access_token, refresh_token, expires_at, expires_in, token_type }, profile: { id: profile.id, username: profile.username, display_name: profile.display_name, legacy_user_id: profile.legacy_user_id, email: signIn.user.email } });
    } catch {
      // Never log request bodies, identifiers, CAPTCHA tokens, passwords, or provider errors.
      return unavailable();
    }
  };
}
