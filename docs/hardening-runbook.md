# Hardening runbook

What protects the public demo, why each choice was made over the obvious
alternative, and what to check when something looks wrong.

**Scope note.** Much of the reasoning already lives next to the code, and this
file does not repeat it — it points there. What it does capture is the part
that existed nowhere but a chat window: the Cloudflare and Hetzner decisions,
which have no file in this repo to comment.

| Where | What it explains |
| --- | --- |
| `deploy/Caddyfile` | proxy trust, the `handle_path` trap, the n8n hostname |
| `deploy/docker-compose.yml` | port exposure, execution retention, the env-access tradeoff |
| `db/demo_email_canonical.sql` | the quota bypass and why the fix is a generated column |
| `db/demo_lead_ip_retention.sql` | why an IP no longer sits beside a name forever |
| `tools/build-demo-workflows.js` | per-workflow retention, error routing |
| `lib/demo-session.js` | HMAC session tokens |

---

## 1. Network perimeter — Hetzner Cloud Firewall

**In place.** The Hetzner Cloud Firewall, configured in the Hetzner console,
allowing only 22, 80 and 443 inbound.

**Why not `ufw`.** Docker does not go through `ufw`. It writes its own
iptables rules into the `DOCKER` and `DOCKER-USER` chains, which are consulted
*before* the `INPUT` chain `ufw` manages. A published container port is
therefore reachable from the internet even when `ufw status` says the port is
denied — a firewall that looks correct and enforces nothing. This is the single
most common way a Docker host ends up accidentally exposed.

**Why not `DOCKER-USER` iptables rules.** They work, and they were the first
plan. They were rejected because they are easy to get wrong in a way that locks
you out of a remote box with no console, they have to be re-applied on reboot
unless persisted, and the rules are invisible to anyone who later runs
`ufw status` and believes it.

**Why the Cloud Firewall wins.** It sits upstream of the NIC, so Docker cannot
bypass it by construction, it survives reboots and reinstalls, it cannot lock
you out of the Hetzner console itself, and it is visible to anyone who opens
the project. It is the layer whose failure mode is "traffic blocked" rather
than "traffic silently allowed".

**To verify:** Hetzner console → the server → Firewalls. Inbound should list
22, 80, 443 and nothing else. From outside, a port scan of anything else should
time out rather than refuse.

---

## 2. Cloudflare

The domain is proxied (orange cloud), so the origin IP is not public and
Cloudflare's WAF and rate limiting are in the request path.

> **Values to confirm against the dashboard.** The rule *expressions* below are
> recorded accurately; the numeric rate-limit thresholds were set in the
> Cloudflare UI and are not reproducible from this repo. Open the dashboard,
> read the current numbers, and write them in here — a runbook with a number
> nobody has checked is worse than one that admits the gap.

**Rate limiting** applies to the demo API, which is where the money is: every
request there can cost a document extraction or a model call.

```
(http.request.uri.path contains "/api/demo/")
```

The upload-status endpoint is polled by the browser while a document is being
processed, so it is treated separately — a threshold tight enough for
`request-code` would break a legitimate upload.

**Caching** covers the site but never the API:

```
(http.host eq "adaptivetech.ro" and not starts_with(http.request.uri.path, "/api/demo/"))
```

Caching an API response here would be a correctness bug, not just a
performance one: session state and quota counts are per-visitor.

**Managed robots.txt is OFF.** Cloudflare's AI Crawl Control can serve its own
`robots.txt` that *replaces* the origin's rather than appending to it. While it
was on, `website/robots.txt` was never served and every AI crawler was
disallowed — the opposite of the intended policy. If crawler behaviour ever
changes for no apparent reason, check this first:

```bash
curl https://adaptivetech.ro/robots.txt
```

If the response mentions Content-Signal or "Cloudflare Managed content", the
setting is back on and the file in this repo is inert.

**After any deploy:** purge the cache. The HTML and `/assets/site.css` are
versionless and must not be served from different generations — every page
depends on that stylesheet, and a stale pairing renders the site unstyled.

---

## 3. The origin — Caddy

Detail is in `deploy/Caddyfile`. Three things worth knowing before debugging it:

**`handle_path`, not `handle`.** Caddy runs directives inside a `handle` block
in its own fixed order, not written order, and `rewrite` sorts before `uri`. A
`uri strip_prefix` written above a `rewrite` therefore runs *after* it, the
prefix is never stripped, and n8n answers "webhook not registered" with a 500.
`handle_path` strips its matched prefix on entry, before anything inside runs.
This cost real debugging time; do not "simplify" it back.

**Three proxy hops.** `visitor → Cloudflare → Coolify's proxy → Caddy → n8n`.
`trusted_proxies private_ranges` is set because Caddy's direct peer is the
Coolify proxy on the compose network, never Cloudflare. `N8N_PROXY_HOPS: "3"`
matches. Undercount and n8n sees the wrong client IP; overcount and a client
can spoof it.

**`X-Robots-Tag` defaults to `all`**, deliberately: a silently de-indexed
production site is a worse failure than an indexed staging one. On a staging
hostname set `ROBOTS_TAG="noindex, nofollow"`.

---

## 4. n8n — the only gate

**No IP allowlist, no basic auth.** Both were removed: several people need
access from changing connections, and a shared second password is a credential
to distribute and rotate rather than a real barrier on top of n8n's own.

**Therefore n8n's own account system is the entire perimeter** in front of
every credential the demo stores — Postgres, SMTP, Gemini — plus
`N8N_ENCRYPTION_KEY`.

- **MFA on the owner account is required.** Without it, one reused password is
  the whole compromise.
- **A fresh n8n serves an unauthenticated setup screen until an owner account
  exists.** Whoever reaches it first claims the instance. Never expose a
  newly-provisioned n8n on the public hostname before completing setup.

**Code nodes can read the container's environment** —
`N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"`, because three secrets are used in raw
JS rather than by a credential-carrying node. The tradeoff is stated in the
compose file: anyone who can author a Code node already has the editor, and
from there can use every stored credential and exfiltrate through an HTTP node
regardless. **The editor being a trusted surface is the assumption the whole
design rests on.** If that stops being true, those secrets need a different
home, and this is the paragraph that should send you looking.

---

## 5. Data

**Quota bypass — fixed in the database, not a workflow.** Every cost control
counts by email address, and `citext` only makes that case-insensitive.
`you+1@gmail.com`, `you+2@gmail.com` and `y.o.u@gmail.com` all reach one inbox,
so one free mailbox yielded unlimited sessions — each an extraction plus ten
grounded answers — while passing Turnstile and the emailed code legitimately
every time. The canonical form is a **generated column**, computed by Postgres.
A workflow can forget; a generated column cannot, and no future route can
bypass it by inserting a row directly. See `db/demo_email_canonical.sql`.

**IP retention.** `demo_leads` deliberately outlives the purge — it is what the
demo exists to collect — but it carried `last_ip`, an IP address beside a named
person kept indefinitely, which the privacy policy did not cover.
`demo_sessions.ip` still records an IP for the two hours a session lives, which
is the window where it is useful for investigating abuse. See
`db/demo_lead_ip_retention.sql`.

**Execution data.** `EXECUTIONS_DATA_MAX_AGE: 72` hours with pruning on, and
the routes that handle document and chat content
(`demo-upload`, `demo-upload-status`, `demo-verify-session`) set
`saveDataSuccessExecution: 'none'` — a successful run of those stores nothing,
because the payload is the visitor's document. Errors are still saved, because
an error you cannot see is one you cannot fix.

---

## 6. Application

- **Session tokens** are HMAC-signed, compared with `timingSafeEqual`, and
  carried in an `httpOnly; Secure; SameSite=Strict` cookie. Same-origin is what
  makes `SameSite=Strict` possible — hence the API living under
  `/api/demo/` on the site's own hostname rather than on the n8n hostname.
- **Turnstile** gates code requests.
- **Unsubscribing takes two steps, and the GET is not one of them.** Mail
  scanners and link prefetchers follow GET links, so an unsubscribe that acts
  on GET removes people who never clicked. `GET /api/demo/unsubscribe` only
  renders a confirmation page; `POST /api/demo/unsubscribe-confirm` is what
  actually unsubscribes. The POST handler reads the token from the query *or*
  the body, because an RFC 8058 one-click client may put it in either.
- **Alerting fires on real failures.** `onError: continueErrorOutput` marks an
  execution *successful*, so `settings.errorWorkflow` never runs — a route can
  fail every request while the dashboard stays green. `Raise For Alert` nodes
  downstream of the responders re-throw so the error workflow is actually
  invoked. Business rejections are kept separate from infrastructure failures,
  so a wrong code does not page anyone.

---

## 7. Host

**Swap: 2 GiB file, `vm.swappiness=10`, `vm.vfs_cache_pressure=50`.**

The box has 3.7 GiB RAM and had no swap, which means a memory spike had exactly
one outcome: the OOM killer terminating the largest process, usually n8n
mid-execution. 2 GiB is enough to absorb a spike and leave room to intervene;
more would only lengthen the thrash before failure. `swappiness=10` keeps swap
as an emergency buffer rather than something the kernel reaches for while RAM
is still available.

```bash
swapon --show                  # /swapfile, 2G
grep swapfile /etc/fstab       # /swapfile none swap sw 0 0
sysctl vm.swappiness           # 10
```

Note that `/etc/sysctl.d/99-sysctl.conf` and `/etc/sysctl.conf` load *after*
`99-swap.conf`. Neither sets swappiness today, but if it ever reverts to 60,
that is where to look.

**Not yet tested across a reboot.** Swap present now is not the same as swap
that comes back, and that difference only surfaces during an incident.

---

## 8. Periodic checks

| Check | Command or place | Looking for |
| --- | --- | --- |
| Firewall | Hetzner console → Firewalls | only 22, 80, 443 inbound |
| robots.txt owner | `curl https://adaptivetech.ro/robots.txt` | no "Cloudflare Managed content" |
| n8n MFA | n8n → Settings → owner account | enabled |
| Swap | `swapon --show` | 2G present |
| OOM kills | `dmesg -T \| grep -iE 'out of memory\|oom.kill'` | empty |
| Cert / origin reachability | `curl -sSI https://adaptivetech.ro/` | 200, HSTS present |
| Stale build | `node tools/build-site.js --check` | "up to date" |

---

## 9. Known gaps

- **n8n MFA** — not confirmed enabled at the time of writing. This is the
  highest-value item on the list, because it is the only gate described in §4.
- **Cloudflare rate-limit thresholds** are not recorded here (see §2).
- **Swap is untested across a reboot** (§7).
- The editor-is-trusted assumption in §4 is load-bearing and undefended by
  anything except n8n's login.
