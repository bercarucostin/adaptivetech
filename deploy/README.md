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

## Adopting the existing n8n and postgres data

n8n and postgres were first deployed here as a Coolify resource with an
inline compose file. Coolify cannot convert that into a Git-backed one, so
this stack **adopts its volumes** rather than migrating them:

```yaml
n8n_data:
  external: true
  name: y128uoi1ogj31ec21iecbnh4_n8n-data
postgres_data:
  external: true
  name: y128uoi1ogj31ec21iecbnh4_postgres-data
```

Note the hyphens in the real volume names — `n8n-data`, not `n8n_data`.
They were read off the running containers with:

```bash
docker inspect <container> --format \
  '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
```

No copy and no downtime window. `external: true` means Docker will not
create them, so a wrong name fails the deploy instead of starting n8n
against an empty database — which matters, because an empty n8n looks
like a working n8n until someone notices every workflow is gone.

### Order, and the one irreversible step

1. **Back up first**, off this box:

   ```bash
   docker exec postgres-y128uoi1ogj31ec21iecbnh4 \
     pg_dump -U n8n -d n8n --clean --if-exists > n8n-$(date +%F).sql
   ```

   That dump holds every workflow and *encrypted* credential. Restoring it
   needs the encryption key too, which is why both matter.

2. **Copy `N8N_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` out of the old
   resource's environment screen.** They live in Coolify, not in Git. A
   different encryption key against the adopted volume leaves every stored
   credential undecryptable.

3. **Stop the old resource — do not delete it.** Two postgres instances
   writing one data directory will corrupt it. Deleting a Coolify resource
   can remove its volumes, and that is the only irreversible action here.

4. Deploy this stack, then confirm n8n came up with its **existing**
   workflows and credentials rather than an empty instance.

5. Only then delete the old resource, after checking its volumes are the
   ones now in use.

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
