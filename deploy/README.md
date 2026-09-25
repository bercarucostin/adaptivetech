# Deployment

One Hetzner box, managed by Coolify. `coolify-proxy` (Traefik v3.6) owns
`:80` and `:443` and terminates TLS, so Caddy sits **behind** it on the
compose network and publishes no ports of its own.

```
visitor -> Traefik (coolify-proxy) -> Caddy -> n8n:5678
                                        |
                                        +-> /srv/site  www.flowrisedental.ro
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

**Phase 2 — after Cloudflare and Google Workspace.** Add the remaining two,
once their DNS points here:

```
https://www.flowrisedental.ro:80,https://flowrisedental.ro:80
```

and set `N8N_PROXY_HOPS=3` in the same change, because Cloudflare adds a hop.

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
curl -sI -H 'Host: www.flowrisedental.ro' http://localhost/     # 200
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

## The DNS cutover, when you get to it

The landing page in `website/site/index.html` is byte-identical to what
Hostico serves today, so the move is like-for-like — visitors see the same
page.

Order matters, and MX comes first:

1. Add the domain to Cloudflare, and **copy every existing record** from
   Hostico before changing nameservers — MX above all. Mail breaks the
   moment nameservers move if MX is missing, and it fails silently for the
   sender.
2. Put the Google Workspace MX records in and verify mail delivery **while
   still on Hostico's nameservers**, if Workspace is replacing the current
   mailboxes.
3. Only then repoint `www` and the apex at this box, add both hostnames in
   Coolify, and set `N8N_PROXY_HOPS=3`.

## Publishing the landing page before the cutover

`www` and the apex are still served by Hostico from cPanel, so a change to
`website/site/index.html` reaches visitors only when the file is uploaded there.
The prices are no longer part of that: they live in Supabase and are published
from https://app.flowrisedental.ro/public-prices/ without touching this file.

When the page itself changes, upload three files to the cPanel document root:

    index.html
    price-list.js          (from website/shared/)
    price-list-source.js   (from website/shared/)

**Diff before you overwrite.** The repository copy is supposed to be
byte-identical to what Hostico serves, but nothing enforces that, and a
difference means somebody edited the live page directly:

    curl -s https://www.flowrisedental.ro/ > /tmp/live.html
    diff /tmp/live.html website/site/index.html

Reconcile any difference before uploading. After the DNS cutover this section
stops applying: the page is then baked into the Caddy image and publishes with a
redeploy.

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
