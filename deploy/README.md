# Deployment

One Hetzner box, managed by Coolify. `coolify-proxy` (Traefik v3.6) owns
`:80` and `:443` and terminates TLS, so Caddy sits **behind** it on the
compose network and publishes no ports of its own.

```
visitor -> Traefik (coolify-proxy) -> Caddy -> n8n:5678
                                        |
                                        +-> /srv/site  flowrisedental.ro (www redirects)
                                        +-> /srv/app   app.flowrisedental.ro
```

Caddy is what turns `app.flowrisedental.ro/api/ai/*` into n8n's
`/webhook/*`, which is the only reason the browser and the AI endpoint are
same-origin. Traefik cannot do that rewrite from a Coolify domain field.

## Coolify configuration

Deployed from this branch via the GitHub integration, with
`deploy/docker-compose.yml` as the compose file.

### Environment variables

Set on the Coolify resource. `deploy/.env.example` documents each one.

| Variable | Note |
|---|---|
| `SITE_DOMAIN` | `flowrisedental.ro` — Caddy derives `www.` and `app.` from it |
| `N8N_HOST` | `n8n.flowrisedental.ro` |
| `ROBOTS_TAG` | `all` in production |
| `N8N_ENCRYPTION_KEY` | **must be the value already in use** |
| `POSTGRES_PASSWORD` | **must be the value already in use** |

Those last two are not new secrets. n8n refuses to start against an existing
database with a different encryption key, and every credential it holds
becomes undecryptable — there is no recovery path.

### Domains — the step that can break something

Coolify writes Traefik routers from the domain field, and Traefik asks
Let's Encrypt for a certificate for every hostname it is given. **A hostname
whose DNS still points at Hostico will fail validation on a loop**, which is
how a deployment ends up rate-limited by Let's Encrypt. So add each hostname
only once its DNS points here.

**Phase 1 — the platform, with the live site untouched.** On the **Caddy**
service:

```
https://app.flowrisedental.ro:80
```

Nothing else. `www` and the apex stay on Hostico and keep serving the
landing page; MX records are untouched. The only DNS change is a new `app`
A record pointing at this box — a hostname that does not exist today, so it
cannot affect mail or the live site.

**Also move the n8n hostname onto Caddy.** Today Traefik routes
`n8n.flowrisedental.ro` straight to the n8n container. Remove it from the
**n8n** service and add it to the **Caddy** service:

```
https://app.flowrisedental.ro:80,https://n8n.flowrisedental.ro:80
```

Both must not be set at once — two Traefik routers for one hostname
conflict. This matters beyond tidiness: while Traefik reaches n8n directly,
Caddy never sees those requests, and the rule that refuses `/webhook/*` on
the editor hostname does nothing. That rule is what makes
`app.flowrisedental.ro/api/ai/` the *only* way to reach a paid API.

The port is `:80` in both cases — Traefik talks to Caddy, and Caddy decides
what to do with the hostname.

**Phase 2 — the landing page.** Add the remaining two, only once their DNS
points here. The full order is in [Moving the landing page off
Hostico](#moving-the-landing-page-off-hostico) below:

```
https://app.flowrisedental.ro:80,https://n8n.flowrisedental.ro:80,https://flowrisedental.ro:80,https://www.flowrisedental.ro:80
```

`N8N_PROXY_HOPS` is **not** part of this change. Only the `app` and `n8n`
hostnames route to n8n, so the value follows those two records: `2` (the
default) while they point here directly, `3` only if they are proxied through
Cloudflare. Moving `www` and the apex changes nothing n8n sees.

## Moving data between Coolify resources

n8n and postgres were first deployed here as a Coolify resource with an
inline compose file. Coolify cannot convert that into a Git-backed one, so
the data has to move to the new resource.

**Pinning the old volumes with `external: true` does not work.** Coolify
rewrites the volumes block when it deploys a compose file from Git: both
`external: true` and the explicit `name:` are discarded, and it creates its
own empty pair.

The failure mode is the dangerous kind. `external: true` exists precisely so
Docker refuses to create a missing volume — with it stripped, the stack
starts cleanly against an empty database instead. An empty n8n looks
completely healthy until someone notices every workflow is gone.

So copy the data, with both stacks stopped.

### Order

1. **Back up first**, off this box:

   ```bash
   docker exec <old-postgres-container> \
     pg_dump -U n8n -d n8n --clean --if-exists > n8n-$(date +%F).sql
   ```

2. **Copy `N8N_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` out of the old
   resource.** They live in Coolify, not in Git.

   If the key does not match, n8n still shows every workflow — definitions
   are not encrypted — but no credential will decrypt. That is why
   "the workflows are there" is not sufficient proof the move worked. The
   original key is inside the volume at `/home/node/.n8n/config` if it is
   ever needed:

   ```bash
   docker run --rm -v <id>_n8n-data:/v alpine cat /v/config
   ```

3. **Stop both resources.** Two postgres instances writing one data
   directory will corrupt it.

4. **Copy each volume**, with the source mounted read-only so the original
   remains a rollback:

   ```bash
   docker run --rm \
     -v <old-id>_postgres-data:/from:ro \
     -v <new-id>_postgres-data:/to \
     alpine sh -c 'rm -rf /to/* /to/.[!.]* 2>/dev/null; cp -a /from/. /to/; du -sh /to'
   ```

   Repeat for `n8n-data`. `cp -a` preserves ownership numerically, which
   postgres requires — it refuses to start on a data directory it does not
   own. Compare the reported sizes against the originals before starting.

5. Start the new resource. Confirm the workflows are present **and that a
   credential decrypts** — the first does not imply the second.

6. Only then delete the old resource, and keep its volumes for a while
   after that.

## Verifying before DNS exists

Traefik routes by `Host`, so the whole stack can be exercised from the box
before a single DNS record changes:

```bash
curl -sI -H 'Host: app.flowrisedental.ro' http://localhost/     # 200
curl -sI -H 'Host: flowrisedental.ro' http://localhost/         # 200
curl -sI -H 'Host: www.flowrisedental.ro' http://localhost/     # 308 to the apex
curl -s  -H 'Host: app.flowrisedental.ro' http://localhost/ | grep -o '<title>[^<]*'
```

A Caddyfile syntax error stops the container rather than serving a broken
site, so `docker compose logs caddy` showing a running server means the
config parsed.

## The check that matters most

The AI endpoint costs money per request. Confirm it refuses an
unauthenticated caller **before** announcing the platform:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://app.flowrisedental.ro/api/ai/dental-lab-ai \
  -H 'Content-Type: application/json' -d '{"text":"test"}'
```

**401 is the pass.** A 200 means the gate is not in the path and OpenAI is
being billed for that request. A 500 means it failed for some other reason —
worth reading the execution in n8n before assuming it is safe.

## Moving the landing page off Hostico

**Done on 2026-10-01.** DNS is on Cloudflare (all records DNS only, so
`N8N_PROXY_HOPS` stays 2) and `flowrisedental.ro` points at this box. Kept
below as the record of what was done and how to roll back.

Hostico serves `flowrisedental.ro` and `www` from cPanel. The Caddy image on
this box already contains the landing page (`/srv/site`) and answers for both
hostnames; no DNS record points at it yet.
The move is two DNS records and one Coolify field. The page's canonical URL
is the apex, so Caddy serves the apex and redirects `www` to it.

What it does **not** touch: mail (MX, SPF, DKIM, DMARC), the `app` and `n8n`
records, and the domain registration, which stays with Hostico as the `.ro`
registrar. Keep it that way: change the two web records where the zone is
hosted today, and treat a nameserver move to Cloudflare as a separate job.
A nameserver move re-hosts every record, MX included; an A-record change
re-hosts only the website.

### A day before

1. **Snapshot the zone.** Export every record from wherever the zone is
   hosted (cPanel → Zone Editor, or Hostico's DNS panel) and keep the copy.
   Write down the current Hostico IP for `@` and `www`: it is the rollback.
2. **Lower the TTL** on the `@` and `www` records to 300 seconds, so the
   switch and any rollback take minutes rather than hours.
3. **Check the zone for three things that break certificate issuance:**
   - **AAAA records on `@` or `www`.** Delete them at cutover unless this
     box answers on IPv6. Otherwise IPv6 visitors keep reaching Hostico, and
     Let's Encrypt may validate over IPv6 and fail.
   - **A CAA record.** If one exists it must allow `letsencrypt.org`, or
     Traefik's certificate request is refused.
   - **`www` as a CNAME** to the apex. That is fine; it follows the apex.
4. **Confirm the price list is live in Supabase.** From the moment DNS
   moves, visitors get the repository's `index.html`, which fetches prices
   from `public.public_price_lists`. With no current row, the page shows
   only the phone-number line. Run the check from step 3 of
   [Publishing the landing page before the cutover](#publishing-the-landing-page-before-the-cutover);
   exactly one row must be current.
5. **Diff the live page against the repository**, as described in the same
   section. Outside the price section they should be identical. Anything
   else is a direct edit on Hostico that would be lost.
6. **Verify on the box** with the `Host:` header checks in
   [Verifying before DNS exists](#verifying-before-dns-exists). The apex must
   return 200 with the landing page title and `www` must return 308.

### The cutover

1. Change the `@` and `www` A records to this box's IP. If the zone is on
   Cloudflare, leave both **DNS only** (grey cloud) for now, so Traefik's
   HTTP challenge reaches the box directly.
2. Wait until a public resolver returns the new IP:

   ```bash
   dig +short flowrisedental.ro @1.1.1.1
   dig +short www.flowrisedental.ro @8.8.8.8
   ```

3. In Coolify, add both hostnames to the **Caddy** service, as listed under
   Phase 2 above, and redeploy. Traefik requests both certificates now.
   Until it has them, visitors on the new IP see a certificate warning.
   This usually lasts under a minute.
4. Check from outside:

   ```bash
   curl -sI https://flowrisedental.ro/        # 200, valid certificate
   curl -sI https://www.flowrisedental.ro/    # 308 -> https://flowrisedental.ro/
   curl -sI http://flowrisedental.ro/         # redirect to https
   ```

   Then open the page in a browser and confirm the price list renders.

### Rollback

Point `@` and `www` back at the Hostico IP from the snapshot. With a
300-second TTL most visitors are back within minutes. Leave the hostnames in
Coolify; Traefik only retries their certificates, which is harmless for a
short window.

### After a week without problems

- Raise the TTL back to 3600 or more.
- Cancel Hostico **hosting** only after confirming in the zone snapshot that
  no MX, `mail`, `webmail` or `autodiscover` record still points at a
  Hostico server. Keep the domain registration.
- `Strict-Transport-Security` on the apex includes `includeSubDomains`, so
  browsers will force HTTPS on every subdomain. Any subdomain that still
  needs plain HTTP stops working in browsers once they have seen the header.
- The [Publishing the landing page before the cutover](#publishing-the-landing-page-before-the-cutover)
  section stops applying. The page is baked into the Caddy image and
  publishes with a redeploy.

## Publishing the landing page before the cutover

**No longer applies** since the move on 2026-10-01: the page publishes with a
Coolify redeploy. Kept for the price-list seed checks, which still hold.

Until the move above, `www` and the apex are served by Hostico from cPanel, so a change to
`website/site/index.html` reaches visitors only when the file is uploaded there.
The prices are no longer part of that: they live in Supabase and are published
from https://app.flowrisedental.ro/public-prices/ without touching this file.

When the page itself changes, upload three files to the cPanel document root:

    index.html
    price-list.js          (from website/shared/)
    price-list-source.js   (from website/shared/)

**Seed the price list before you upload that page.** This is the step that
can take the whole price list off the public site, and nothing in the repo
performs it for you — there is no migration runner here, and
`db/schema/apply.sql` does **not** include `db/migrations/`. Applying the
schema creates an empty `public.public_price_lists`; the page that fetches
from it then finds no current version and renders one line —
"Lista de prețuri se încarcă — dacă nu apare, sună la 0766 494 063." — in
place of the entire price list. In that order:

1. Apply the schema:

       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/apply.sql

2. Then run the seed, which inserts version 1 — the list transcribed from
   the page as it stands:

       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
         -f db/migrations/20260925_public_price_list_seed.sql

   It is idempotent: it inserts only when the lab has no price list at all,
   so re-running it against a database that already has history changes
   nothing and is safe.

3. Then confirm that exactly one version is published and current:

       select count(*), bool_or(is_current) from public.public_price_lists;

   On a fresh database expect exactly `1 | t`. On one that already has
   published history the count is however many versions exist — the seed
   inserted nothing, as intended — and `bool_or` must still be true. The
   property that matters either way is that **exactly one row is current**,
   which this reports directly:

       select count(*) from public.public_price_lists where is_current;

   A count of 0 from the first query means the seed found no lab — check that
   `public.get_flowrise_lab_id()` resolves — and a `bool_or` of `f` means
   nothing is published, which the page renders as the phone-number line.

4. **Only then upload `index.html`**, after the diff below. That upload is the
   moment visitors start depending on the database, so everything above it has
   to be true first. The two `price-list*.js` files can go up at any point;
   they do nothing until the page references them, and having them in place
   early means the page works the instant it lands.

**Diff before you overwrite.** The repository copy and the live page are no
longer expected to match: this branch removed the hand-written price rows, so
the price section is *supposed* to differ. Everything else should not, and a
difference elsewhere means somebody edited the live page directly:

    curl -s https://www.flowrisedental.ro/ > /tmp/live.html
    diff /tmp/live.html website/site/index.html

Reconcile any difference outside the price section before uploading. Once the
upload is done the two are identical again, and stay that way. After the DNS
cutover this section stops applying: the page is then baked into the Caddy
image and publishes with a redeploy.

### Before touching a database that ran an earlier version of this work

The schema in `db/schema/apply.sql` adds a `CHECK` constraint on the stored
document, and `ALTER TABLE ... ADD CONSTRAINT ... CHECK` validates every
existing row against it. If any row already in `public.public_price_lists`
fails the validator, `apply.sql` aborts partway through. Before applying the
schema to a database that ran an earlier version of this work, confirm there
is nothing to abort on:

    select count(*) from public.public_price_lists
    where not public.public_price_document_is_valid(document);

This must return 0. If it does not, fix or remove the offending row before
running `apply.sql`.

### The publish RPCs' locking and privileges are unverified against a real database

The advisory lock that serializes two managers publishing the same lab's
price list at once, and the `revoke all ... from public, anon` /
`grant execute ... to authenticated` privilege pairs on the publish RPCs, were
reasoned from Postgres semantics on paper only — there is no `psql`, no
`DATABASE_URL` and no Docker in the environment this work was built in, so
none of it has actually been executed. Before this is trusted in production,
ideally before the Task 9 acceptance pass, run a real two-session test against
a disposable Supabase instance: two managers publishing at the same time, and
a publish against a stale version, and confirm the lock and the grants behave
the way the schema comments claim.

### The generated Supabase SQL has not been re-verified by the real tool

`tools/build-supabase-editor-sql.py` cannot run on the machine this was built
on — its `python` is a Windows Store stub that exits "Permission denied" on
invocation. `db/schema/apply.supabase.sql` was instead regenerated with a
node port of the tool kept in this run's scratch directory, and the output
was verified byte-identical against the committed python-generated file
before any schema change went in. Anyone with a working Python should still
run the real `tools/build-supabase-editor-sql.py` once and confirm it
produces a zero diff against the committed file, so the node port is never
the only thing that has checked this.
