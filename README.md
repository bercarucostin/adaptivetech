# flowrisedental.ro — web platform

This branch holds the FlowRise Dental web platform: an HTML/JS frontend with an
n8n backend and Supabase for storage.

**Status: scaffolding.** The directories below are in place; the application
files have not landed yet.

## Branches

Each client deployment is its own independent line of history in this
repository. They share no deployment, no database and no n8n instance, and they
do not merge into one another.

| Branch | Contents |
|---|---|
| `main` | The generic WhatsApp bot spine: schema, retrieval, ingestion, error handling |
| `partner-prod` | A client WhatsApp bot deployment — no frontend |
| `website` | adaptivetech.ro and its public RAG demo |
| `flowrisedental-prod` | **This branch** — the FlowRise Dental platform |

`website` is the closest reference for this build: same shape — static frontend
served by Caddy, n8n reached same-origin under a path prefix, SQL migrations
checked in, deployment by compose on a Hetzner box.

## Layout

| Directory | Holds |
|---|---|
| `deploy/` | `Caddyfile`, `docker-compose.yml`, `caddy.Dockerfile`, `.env.example` |
| `db/` | Supabase SQL — schema and migrations, each safe to re-run |
| `workflows/` | n8n workflow JSON |
| `website/` | The frontend Caddy serves |
| `tests/` | `node:test` suites — run with `node --test tests/` |
| `docs/` | Design notes and, eventually, the deployment runbook |

`lib/` and `tools/` are deliberately absent. On `website` they exist because
workflows are *generated* — a build script emits the JSON and inlines shared JS
into Code nodes. Whether this project adopts that pipeline or keeps
hand-authored workflow JSON is still open, and the folders arrive with their
first occupant rather than ahead of the decision.

## Deployment

Target: an existing Hetzner box that already runs n8n. Caddy is new there.

Three things carried over from `website`, recorded here because each cost real
debugging time and none is obvious from the config alone:

- **The site is baked into the Caddy image**, not bind-mounted. Coolify rewrites
  relative bind mounts to paths under its own application directory and creates
  a missing target as a *directory* — which turns a mounted site into an empty
  folder that Caddy serves as nothing, with no error.
- **`handle_path`, not `handle`,** for the API prefix. Caddy runs the directives
  inside a `handle` block in its own fixed order rather than written order, and
  `rewrite` sorts before `uri`. A `uri strip_prefix` written above a `rewrite`
  therefore runs after it, the prefix is never stripped, and n8n answers
  "webhook not registered".
- **The API lives on the site's own hostname** under a path prefix, not on the
  n8n hostname. Same-origin is what makes `SameSite=Strict` session cookies
  possible.

### DNS

`flowrisedental.ro` is registered through hostico.ro and currently serves a
static page from cPanel. Moving it to the Hetzner box is a cutover, not a
deploy: plan it deliberately, with the new host verified and answering on its
own address before any record changes.
