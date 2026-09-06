# Deploying the RAG demo

This deploys the public document-Q&A demo at `adaptivetech.ro/demo` on a single
Hetzner VPS. Three containers run on the box: **Caddy** (TLS, static site,
reverse proxy), **n8n** (the workflows), and **Postgres** (n8n's own state
only — the demo's documents, chunks and embeddings live in a separate
Supabase project, see below). Cloudflare sits in front of Caddy.

Nothing in this directory has been run. It is configuration for you to
deploy; follow the steps below on the actual VPS.

## Architecture

```
Internet -> Cloudflare (proxy, TLS, Turnstile)
              -> Coolify's proxy (:80/:443, TLS) -> Caddy (:80, no TLS)
                                                      |
                                          /                  \api/demo/*
                                  static files            reverse_proxy
                                  (baked into image)         n8n:5678
```

- The site is **baked into the Caddy image** (see caddy.Dockerfile) and served
  at `DEMO_DOMAIN`, so `website/index.html` is the marketing site at `/` and
  `website/demo/index.html` is the demo at `/demo`.
- Caddy proxies `/api/demo/*` to n8n's webhook path on the **same origin**
  (`DEMO_DOMAIN`, not a separate API subdomain). That's deliberate: it's what
  lets the session cookie be `httpOnly` and `SameSite=Strict` — a
  cross-origin API could not receive it under those settings.
- n8n publishes no ports of its own. It is reachable only via Caddy on the
  compose network, except for the editor, which Caddy exposes on the
  separate `N8N_HOST` hostname, gated by n8n's own user accounts.
- Postgres holds only n8n's workflow/execution state. It is **not** where
  demo documents, chunks, embeddings, leads or messages live — that data
  lives in a dedicated Supabase project, isolated from both this box and
  from the WhatsApp bot's own Supabase project.
- `db/demo_schema.sql` enables Row Level Security on all seven demo tables
  with zero policies, which denies every role except the table owner and
  roles with `BYPASSRLS` — including the `anon` key Supabase exposes to
  PostgREST by default. The demo's n8n workflows must connect to Supabase
  as the **service role** (or another dedicated owner-level role), never
  the anon key, or every query against these tables will fail closed.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | The three services and their volumes. |
| `Caddyfile` | Routing, security headers. TLS is Coolify's proxy, not Caddy's. |
| `caddy.Dockerfile` | Bakes the Caddyfile and the site into the Caddy image. |
| `.env.example` | The list of variables to set in Coolify. |

### Why the Caddy image is built rather than pulled

There are deliberately **no relative bind mounts** in the compose file. Coolify
rewrites them to paths under its own application directory
(`/data/coolify/applications/<uuid>/…`) and creates missing targets as
*directories*. Mounting `./Caddyfile` that way fails outright —

```
error mounting ".../Caddyfile" to rootfs at "/etc/caddy/Caddyfile":
not a directory: Are you trying to mount a directory onto a file?
```

— and `../website` would silently become an empty directory, so Caddy would
start cleanly and serve nothing, which is the worse of the two failures.

`caddy.Dockerfile` copies both into the image instead, with the build context
set to the repository root because the site lives outside `deploy/`. A useful
side effect: the served site is exactly what the deployed commit contains, so a
deploy and the content it publishes cannot drift apart.

## Order of operations

**This stack is deployed through Coolify.** Two things follow from that, and
both are load-bearing:

- **Secrets live in Coolify's Environment Variables, not in a `.env` on the
  box.** Coolify supplies them to compose at deploy time. See Secrets, below.
- **Coolify's proxy owns `:80` and `:443` and terminates TLS.** Caddy runs
  behind it with no published ports, serving plain HTTP on port 80 — point
  Coolify's domain at the `caddy` service on that port. Caddy is still here
  because it does the one thing that cannot move to proxy labels: it serves
  the site and rewrites `/api/demo/*` to n8n on the **same origin**, which is
  the only reason the session cookie can be `httpOnly` + `SameSite=Strict`.

The chain is therefore `visitor → Cloudflare → Coolify's proxy → Caddy → n8n`,
which is why `N8N_PROXY_HOPS` is `3` and why the Caddyfile trusts private
ranges rather than Cloudflare's.

1. Provision the Hetzner VPS. Coolify installs Docker and its proxy on each
   destination server it manages, so if Coolify is driving this host, expect
   its proxy to already own the public ports.
2. **Point Coolify at the repository, not at `deploy/` alone.** Caddy serves
   the site from `../website`, mounted relative to this directory, so
   `deploy/` and `website/` must stay siblings in whatever Coolify checks out.
   Set the compose file path to `deploy/docker-compose.yml` and the base
   directory to the repository root. A checkout that contains only `deploy/`
   fails on the bind mount at first deploy.
3. Set every variable from `.env.example` in Coolify's Environment Variables
   (Secrets, below). Do not create a `.env` on the box.
4. Deploy, and confirm all three services come up. `postgres` must reach
   `healthy` before `n8n` starts — that dependency is declared, so if `n8n`
   sits waiting, the fault is in Postgres, not in n8n.
5. Verify `crypto` is available inside n8n's Code nodes (Why
   `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, below) — do this before building
   anything on top of it.
6. Point DNS at Cloudflare, enable the proxy, set SSL/TLS to Full (strict),
   create the Turnstile widget, and replace the Turnstile test key in
   `website/demo/index.html` (Turnstile, below).
7. Lock the origin with `ufw` and verify the lock actually blocks a direct
   connection (Cloudflare + origin lock, below).
8. Set the provider spend caps (Provider spend caps, below) **before**
   anything is publicly reachable — the demo should never be live without
   them.
9. Only now do the later tasks in this plan build the n8n workflows
   (registration, verification, ingestion, retrieval, agent, purge) inside
   this running instance and export them into `workflows/`. This README
   covers the box and the edge, not the workflow content — that is built
   and exported against the instance you just brought up, not before.

## Secrets

**Set these in Coolify's Environment Variables for this resource. Do not create
a `.env` on the box.** Coolify supplies them to compose at deploy time, so the
values live in Coolify's store rather than on disk in plaintext.
`deploy/.env.example` remains the canonical list of what must be set — and the
fallback if this is ever deployed with a plain `docker compose up`, in which
case `deploy/.env` is gitignored and the old copy-the-template flow applies.

Four of the values are locally-generated random secrets. Generate each with its
own invocation so they are independent, then paste them into Coolify:

```bash
for k in N8N_ENCRYPTION_KEY DEMO_SESSION_SECRET DEMO_CODE_PEPPER POSTGRES_PASSWORD; do
  echo "$k=$(openssl rand -base64 48 | tr -d '\n')"
done
```

> **Back up `N8N_ENCRYPTION_KEY` outside Coolify — a password manager.**
> It encrypts every credential n8n stores. If the Coolify instance is lost, or
> the variable is edited by accident, every stored API key and connection
> string becomes unrecoverable and you re-enter all of them by hand. With the
> secrets no longer on disk, Coolify is the only copy unless you make another.
> The other three cost only a session reset to regenerate.

| Variable | What it protects | Source |
|---|---|---|
| `N8N_ENCRYPTION_KEY` | Encrypts n8n's stored credentials at rest. | `openssl rand -base64 48` |
| `DEMO_SESSION_SECRET` | HMAC key for the session cookie token (`lib/demo-session.js`). | `openssl rand -base64 48` |
| `DEMO_CODE_PEPPER` | Peppers the 6-digit email-verification code before it's hashed. | `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | Postgres password for n8n's own database. | `openssl rand -base64 48` |
| `TURNSTILE_SECRET` | Server-side secret to verify Turnstile tokens. | Cloudflare Turnstile dashboard (paired with the site key — see Turnstile, below). Not locally generated. |

`DEMO_DOMAIN` and `N8N_HOST` in `.env.example` are not secrets;
they're deployment-specific values (the demo's public hostname and the n8n
editor's own hostname) that ship with
sane placeholders for you to replace.

Losing or rotating `DEMO_SESSION_SECRET` invalidates every outstanding
session cookie (visitors just re-verify their email); rotating
`N8N_ENCRYPTION_KEY` requires n8n's own credential re-encryption process —
don't rotate it casually.

## Why `NODE_FUNCTION_ALLOW_BUILTIN=crypto` is load-bearing

`lib/demo-session.js` calls `require('crypto')` inside a block marked
`SHARED START`/`SHARED END` that is copied **verbatim** into two n8n Code
nodes (`workflows/demo-verify-session.json` and
`workflows/demo-verify-code.json`, added in later tasks). n8n's Code node
sandbox blocks Node's built-in modules unless they are explicitly
allow-listed via `NODE_FUNCTION_ALLOW_BUILTIN`. Without this variable set on
the `n8n` container, `require('crypto')` throws inside the sandbox and:

- every session token sign/verify call fails,
- the 6-digit code's hash comparison fails,
- the unsubscribe link's token fails,

all silently from the outside — requests just start 500-ing. It looks like
an unused/leftover env var to anyone auditing the compose file later
because nothing in the compose file itself uses `crypto`; it is consumed
entirely inside Code node bodies copied from `lib/demo-session.js`. **Do
not remove it as dead configuration.**

Verify it actually took, once the stack is up, before building anything
that depends on it: in the n8n editor, add a scratch Code node with

```javascript
const crypto = require('crypto');
return [{ json: { ok: crypto.createHmac('sha256', 'k').update('x').digest('hex').slice(0, 8) } }];
```

Expected: an 8-character hex string. A failure here means the env var did
not take, and no amount of workflow debugging downstream will fix it.

## Cloudflare + the n8n editor, the `ufw` origin lock, and `trusted_proxies`

Cloudflare's proxy is not, by itself, a security boundary: the origin's
real IP is discoverable from historical DNS records (any A record the
domain ever pointed at before the orange cloud was turned on), from SPF/MX
records, from TLS certificate transparency logs, and from plenty of other
places. If the origin firewall accepts connections from any IP, anyone who
finds that IP bypasses Cloudflare, Turnstile, and every edge rule entirely.
**The firewall rule is what makes the proxy real; without it the proxy
protects nothing.**

Being behind proxies also means Caddy's `remote_ip` matcher — used by the n8n
editor's IP allowlist — never sees the real visitor. Behind Coolify it does not
even see Cloudflare: Caddy's direct peer is Coolify's proxy, on the compose
network. So the Caddyfile uses `client_ip` and trusts `private_ranges`, which
is what that peer is.

**There is deliberately no IP allowlist on the editor.** Several people need to
reach it from different connections, and an allowlist across three proxies
locks out whoever's address moved rather than whoever should not be there. The
editor is guarded by HTTP basic auth in Caddy, with n8n's own user accounts
behind that as a second layer. `client_ip` and `private_ranges` therefore
affect only what shows up in the access logs, not who gets in.

1. DNS: point `DEMO_DOMAIN` and `N8N_HOST` at Cloudflare with the proxy
   (orange cloud) on.
2. SSL/TLS mode: **Full (strict)**. Coolify's proxy provisions the origin
   certificate, so Cloudflare validates a real one rather than trusting an
   unverified origin. Caddy itself terminates no TLS — it runs `auto_https off`
   behind Coolify, which is why both site blocks are `http://`.
3. **Nothing to fill in for `trusted_proxies` any more.** It reads
   `private_ranges`, which covers Coolify's proxy on the compose network.
   Cloudflare's ranges are deliberately *not* listed: Caddy never sees
   Cloudflare directly, so listing them would match nothing. You still need
   Cloudflare's ranges for the firewall step below — that one is about the
   host, not about Caddy.
4. **Complete n8n's own setup immediately, then enable MFA.** Caddy adds no
   authentication of its own — n8n's user management is the only gate on the
   editor, and everyone gets their own account.

   The window that matters: a fresh n8n serves an **unauthenticated setup
   screen** until an owner account exists, so whoever reaches it first claims
   the instance — and that instance will hold the Anthropic key, the Gemini
   key and the Supabase connection string. Create the owner account in the
   same sitting as the first deploy, never later, and turn on MFA for it.
5. Lock the origin to Cloudflare's published IP ranges plus your own admin
   IP for SSH, on the box itself:

```bash
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow proto tcp from "$ip" to any port 80,443
done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do
  ufw allow proto tcp from "$ip" to any port 80,443
done
ufw allow proto tcp from <YOUR_ADMIN_IP> to any port 22
ufw --force enable
ufw status numbered
```

   Replace `<YOUR_ADMIN_IP>` with your own address, and **add a second rule
   for Coolify's own IP** or it can no longer deploy to this box:

```bash
ufw allow proto tcp from <COOLIFY_IP> to any port 22
```

   `ufw allow 22/tcp` (no `from`) opens SSH to the entire internet, not just
   your own admin IP — the `from` form above is what actually restricts it.

Cloudflare's IP ranges change occasionally — re-run step 3 after any
Cloudflare network change, and periodically re-diff against
`https://www.cloudflare.com/ips-v4` / `-v6`.

6. **Verify the lock actually blocks a direct connection**, from a machine
   that is not Cloudflare:

```bash
curl -sv --connect-timeout 5 https://<HETZNER_IP>/ 2>&1 | tail -5
```

Expected: connection refused or a timeout. **Any response here means
Cloudflare is decorative** — this is the single most commonly skipped step
in this kind of deployment, precisely because everything looks fine without
it: the site works, TLS works, Turnstile works, and none of that tells you
whether the origin is reachable directly. Re-run this check after every
firewall change.

## Turnstile: replace the test site key before going live

`website/demo/index.html` currently ships Cloudflare's public **test** site
key, `1x00000000000000000000AA`. That key always passes verification for
anyone, regardless of whether they solved anything — it exists so the page
renders and the button click still works before the real widget is wired
up. Leaving it in production means the human-verification gate on
`request-code` checks nothing at all.

Before the demo is public:

1. Create a Turnstile widget for `DEMO_DOMAIN` in the Cloudflare dashboard.
2. Replace `data-sitekey="1x00000000000000000000AA"` in
   `website/demo/index.html` with the real, public **site key**.
3. Put the paired **secret** in `deploy/.env` as `TURNSTILE_SECRET` (the
   secret is never embedded in the page — only the site key is public).

The site key and secret are a pair; mismatching them (e.g. a leftover test
secret against a real site key, or vice versa) fails every verification.

## Provider spend caps

There is deliberately **no application-level spend ceiling** in this demo
(a recorded, accepted decision — see the spec). That means the provider
account's own cap is the *only* ceiling standing between a scripted attack
on a public page and an unbounded bill. Do not treat this step as optional
or as a formality:

1. **Anthropic**: create a **separate workspace** for the demo (not the
   WhatsApp bot's workspace) with its own API key, and set that workspace's
   spend limit / rate limits in the Anthropic Console. A public page under
   attack must never be able to draw down the bot's quota or budget — that
   quota belongs to a paying client.
2. **Google Cloud (Gemini)**: create a **separate GCP project** for the
   demo's Gemini key (again, not the WhatsApp bot's project), with a
   billing budget and alert, and an API quota cap on the Generative
   Language / Vertex API.
3. Set each cap to the monthly number you would be genuinely unhappy to
   lose — because there is no other backstop, that number *is* the
   ceiling, not a soft warning threshold.

Do this **before** the domain is reachable publicly. Never reuse the
WhatsApp bot's Anthropic or Google keys here, even temporarily during
setup — a "temporary" shared key is exactly how a public demo ends up
drawing on a paying client's quota.

## Restore

Everything this stack can lose on its own is in three places:

- **`n8n_data` volume**: workflows, credentials (encrypted with
  `N8N_ENCRYPTION_KEY`), and execution history. Back up the volume; restore
  by stopping the stack, restoring the volume contents, and bringing it
  back up with the same `.env` (the same `N8N_ENCRYPTION_KEY` — a restored
  volume with a different key can't decrypt its own stored credentials).
- **`pg_data` volume**: n8n's own Postgres data (queue/state), not demo
  content. Back up and restore the volume the same way, or use
  `pg_dump`/`pg_restore` against the `n8n` database if you want logical
  backups instead of raw volume snapshots.
- **The demo's Supabase project**: documents, chunks, embeddings, leads and
  messages live there, not on this box. Use Supabase's own backup/restore
  (point-in-time recovery or scheduled backups, depending on plan) — this
  compose stack has no copy of that data and cannot restore it.

There is no single "restore everything" command: restoring the box gets you
back a working n8n install with its workflows and credentials; restoring
Supabase separately gets you back the demo's data. Do both if you need a
full recovery.

## End-to-end verification (after the stack, Cloudflare and caps are live)

```bash
node --test tests/
```

Then, against the live site:

- Upload a real PDF and get a grounded answer with correct source
  attribution.
- Confirm a second session cannot retrieve the first's chunks by any
  request you can construct.
- Confirm an off-document question produces a refusal, **and that
  `Answer (Haiku 4.5)` did not execute** — check the n8n execution, not
  just the reply text.
- Confirm the hourly purge removes documents and uploads and spares
  `demo_messages` and `demo_leads`.
- Confirm a scanned PDF fails with `NO_TEXT_LAYER`, not a generic error.
- Confirm `request-code` rejects a missing or replayed Turnstile token.
- Confirm the origin refuses a direct connection on its IP (repeat the
  `curl` check above).

## Two failures that will not announce themselves

1. **A retrieval short-circuit wired after the Anthropic call instead of
   before it.** Every reply still looks right and every off-document
   question still gets billed to the Anthropic/Gemini keys above. The
   structural workflow tests and the execution-log check in the
   verification list both exist to catch exactly this — run both, don't
   skip to "the answers look right."
2. **Cloudflare running without the `ufw` origin lock.** Everything about
   the site works normally; the edge just protects nothing. The direct-`curl`
   check above is the only thing that proves the lock is real.
