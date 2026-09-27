# Login abuse protection deployment

The login Edge Function now fails closed until its database migration and HMAC secret are installed. Deploy the database, Edge Function, CAPTCHA provider configuration and frontend together in a maintenance window; existing sessions are unaffected, but fresh logins need all four pieces.

1. Apply `db/migrations/20260927_login_rate_limit.sql` as the database owner. It creates an RLS-protected table and a service-role-only RPC. Never expose the service role key to the browser.
2. Generate a cryptographically random secret (at least 32 characters) and set the Edge Function secret `LOGIN_RATE_LIMIT_SECRET`. Keep it stable between instances/deployments so they share counters. Rotation deliberately abandons old hashed buckets until cleanup.
3. Deploy `db/edge-functions/login-with-identifier/` with JWT verification disabled, as this is a pre-authentication endpoint. Keep its existing Supabase URL, anon and service role environment variables.
4. Create a Cloudflare Turnstile widget restricted to the actual production frontend hostname(s). Set its public site key as `turnstileSiteKey` in the frontend configuration. Store its secret **only** in Supabase Authentication → Bot and Abuse Protection, select Turnstile, and enable CAPTCHA protection. Supabase must validate the CAPTCHA, including direct public `/auth/v1/token?grant_type=password` requests; an Edge-only check does not prevent direct Auth bypass. Review and retain native Auth rate limits. See [Supabase CAPTCHA configuration](https://supabase.com/docs/guides/auth/auth-captcha) and [password sign-in options](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).
5. Serve the new `login-security.js` before `app.js`. Allow `https://challenges.cloudflare.com` in relevant CSP script/frame directives if a CSP is configured. Test a real widget on an allowed hostname; test keys must never be deployed to production.

## Trusted IP boundary

By default **all callers share one conservative bucket of 60 attempts per minute**, before nickname/profile lookup. User-supplied `X-Forwarded-For`, `X-Real-IP`, and similar headers are ignored. This default protects database lookups without assuming undocumented Supabase ingress behavior, but one noisy caller can temporarily deny login to others.

For individual IP limits, use a trusted server-side ingress that overwrites a configured IP header with a canonical single IP literal and overwrites `x-login-proxy-secret` with a random secret of at least 32 characters. Set matching Edge secrets `LOGIN_TRUSTED_IP_HEADER` and `LOGIN_TRUSTED_PROXY_SECRET`. Never include this proxy secret in frontend configuration or allow browser-supplied values to pass through. Ingress must canonicalize equivalent IPv6 spellings. Requests without the correct proxy secret continue in the shared fallback bucket, including requests directly to the Edge URL. Merely naming `x-forwarded-for` in an environment variable without an authenticated ingress is not sufficient.

Each resolved email has a second shared bucket of **10 attempts per 15 minutes**, applied before password verification. Nickname and email use the same canonical lowercase email bucket. All attempts, including successes, count. Limits use atomic PostgreSQL upserts across Edge instances; restart/redeploy does not reset them. These are fixed windows (bursts around window boundaries are possible), and intentional account denial is a residual tradeoff of account throttling. Native Auth CAPTCHA and limits also protect direct Auth requests, which do not pass through this custom limiter.

Only domain-separated HMAC-SHA256 keys, counter values and expiry timestamps are stored; no plaintext IPs, emails, nicknames, passwords or CAPTCHA tokens. Every RPC removes at most 100 expired rows using an expiry index and skip-locked rows. No per-attempt event log is retained. After traffic stops, expired rows may remain until the next request; they no longer restrict attempts. Rate limits cap new account rows admitted per trusted IP/fallback bucket. Monitor table growth and failed RPCs as part of normal operations.

## Verification before enabling traffic

- Confirm anonymous/authenticated roles cannot execute `consume_login_rate_limit` or read/write `login_rate_limits`; service-role RPC calls work.
- Confirm valid CAPTCHA and valid credentials work using both nickname and email. Missing/invalid CAPTCHA must fail both through the Edge Function and through direct Supabase Auth password requests.
- Confirm invalid credentials receive a generic message; repeated attempts yield HTTP 429 plus `Retry-After`, which the browser displays. CAPTCHA must reset after every submitted attempt, expire cleanly and show an actionable error when the provider cannot load.
- Confirm spoofing forwarding headers does not change the fallback bucket and limiter outages return HTTP 503 before authentication.

Run local behavior checks with `node --test tests/auth/*.test.mjs`. SQL tests use `@electric-sql/pglite`; set `PGLITE_MODULE_PATH` to its installed `dist/index.js` (the local default is `/tmp/tooth-pglite/package/dist/index.js`). Tests use an isolated in-memory PostgreSQL database and do not contact production. A standard Node runtime or Electron's `ELECTRON_RUN_AS_NODE=1` runtime can run them.
