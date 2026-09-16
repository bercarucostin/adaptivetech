# adaptivetech.ro — website and public RAG demo

This branch holds the Adaptive Technologies website and the n8n-backed RAG
demo behind it: a visitor gives an email address, uploads one document, and
asks questions answered only from that document.

It is a **separate product** from the WhatsApp support bot on `main` and
`partner-prod`. They share no deployment, no database and no n8n instance, and
they do not merge back into each other. `tests/branch-contract.test.js` fails
if the bot's files reappear here.

## Branches

| Branch | Contents |
|---|---|
| `main` | The generic WhatsApp bot spine: schema, retrieval, ingestion, error handling |
| `partner-prod` | The active client deployment |
| `website` | **This branch** — adaptivetech.ro and its public RAG demo |

## The demo, end to end

```
visitor → Cloudflare → Coolify's proxy → Caddy ─┬─ /*           → static site
                                                └─ /api/demo/*  → n8n webhooks
```

Caddy rewrites `/api/demo/*` to `/webhook/demo/*` on the **same origin**, which
is the only reason the session cookie can be `httpOnly; Secure; SameSite=Strict`.

1. **Email gate.** Turnstile, then a 6-digit code stored only as an HMAC.
   Redeeming it mints a signed session token — the one and only origin of a
   `session_id`. No route ever reads one from a request body.
2. **Upload.** One document per session, ≤10 MB, type detected from the bytes.
   Answered `202` immediately; extraction and embedding continue behind the
   response while the browser polls.
3. **Chat.** Hybrid RRF retrieval scoped to the session, then a grounded
   answer. Ten messages per session.

Every limit is enforced by a single SQL statement that both checks and
increments, so parallel requests cannot outrun it.

## What's here

### Database (`db/`)

| File | Purpose |
|---|---|
| `demo_schema.sql` | Seven tables. Session-scoped chunk store, three retention tiers, RLS enabled with zero policies |
| `demo_hybrid_search.sql` | Session-scoped RRF search. `p_session_id` is required and scopes **both** branches |
| `demo_email_canonical.sql` | The quota identity: a generated `email_canonical` column on three tables, so `you+1@gmail.com` and `y.o.u@gmail.com` cannot buy a second quota |
| `demo_lead_ip_retention.sql` | Drops `demo_leads.last_ip`. The session-scoped copy in `demo_sessions.ip` stays; a second one kept until unsubscribe did not |
| `site_contact.sql` | `contact_messages`: one row per contact-form submission, no IP, `handled_at` as the inbox. RLS on, zero policies, like the rest |
| `demo_verify.sql` | Nine checks proving retention, cross-session isolation and the similarity signal. Paste into Supabase's SQL editor and read the `verdict` column |

Apply in that order — `demo_email_canonical.sql` after `demo_schema.sql`, since it
alters the tables that file creates. Each sets `search_path = public, extensions`, because
Supabase installs pgvector into `extensions` — without it the `vector` type
does not resolve and the schema fails on its first vector column.

There is deliberately **no HNSW index**. A per-session filter is maximally
selective, so an exact scan over a btree-filtered subset is both faster and
exact.

### Workflows (`workflows/`)

| File | Purpose |
|---|---|
| `demo-request-code.json` | Turnstile, quota, mints and emails a 6-digit code. Answers `202` on every path |
| `demo-verify-code.json` | Redeems the code and issues the session cookie. The only place a session is created |
| `demo-verify-session.json` | Sub-workflow. Verifies the cookie and returns the session row — called by every other route |
| `demo-upload.json` | Accepts and validates the file, claims the slot, then extracts, chunks, embeds and stores it |
| `demo-upload-status.json` | Polled by the progress UI |
| `demo-chat.json` | Retrieval and the grounded answer |
| `demo-cleanup.json` | Hourly purge. The workflow that makes the privacy policy true |
| `demo-unsubscribe.json` | The signed link at the bottom of every code email |
| `site-contact.json` | The homepage contact form at `/api/demo/contact`: Turnstile, validation, one row in `contact_messages`, one email to the team. Not a demo route, but on the same prefix so Caddy, the cache bypass and the rate limit already cover it |
| `error-handling-demo.json` | Set as the error workflow on all of the above |
| `demo-verify-session-test.json` | Harness. Seeds its own session, so there is nothing to paste by hand |

**These files are generated. Do not hand-edit them.**

```bash
node tools/build-demo-workflows.js
```

`tools/build-demo-workflows.js` is the source of truth. It exists because the
Code nodes must contain the `---8<--- SHARED` blocks from `lib/` byte for
byte, and a hand-copied block drifts the first time either side is edited.
Generating them makes drift impossible rather than merely tested.

It also pins, in `N8N_IDS`, the workflow and credential ids read back from the
live instance — so a rebuild produces the files that are already deployed
instead of a set that has to be re-wired by hand. Two consecutive builds are
byte-identical; re-importing updates a workflow in place rather than creating
a duplicate that collides on its webhook path.

Node types and `typeVersion`s were taken from real exports off the target
instance (n8n 2.28.3), not from memory. The Gemini call shapes came from the
bot's own working `ingestion.json` on `main`.

### Shared code (`lib/`)

Each of these carries a `---8<--- SHARED` block copied verbatim into a Code
node by the generator, and is unit-tested here where a workflow cannot be:

| File | Purpose |
|---|---|
| `demo-session.js` | HMAC session tokens — sign, verify, constant-time compare |
| `demo-filetype.js` | Type detection from magic bytes, never the declared Content-Type |
| `demo-chunker.js` | Section-aware 350/75 windowing with a 600-chunk ceiling |
| `demo-extraction-prompt.js` | The extraction prompt, whose `##` heading rule the chunker depends on |

## Retrieval design

Chunking is section-aware: text is split on `##` headings emitted by the
extraction prompt, then windowed at 350 tokens with 75 tokens of overlap. Each
chunk is prefixed with its document title and section heading before
embedding, so a retrieved chunk carries its own context.

Embeddings are `gemini-embedding-001` at `outputDimensionality: 1536`. **The
API does not normalise at that dimension** — only at 3072 — so every embedding
is L2-normalised client-side before insert and before search.
`demo_hybrid_search()` assumes unit vectors.

Search fuses a cosine scan and a `romanian` `ts_rank` scan with RRF. The
returned `similarity` is an RRF score, not a cosine similarity — **do not
threshold it as one.** It always ranks something first however unrelated the
question. `best_similarity`, returned alongside it, is a real cosine value, and
that is what `demo-chat` thresholds to decide whether to call the model at all.

## Tests

```bash
node --test tests/
```

No dependencies and no `package.json` — `node:test` and `node:assert` only.

The tests read the **generated workflow JSON**, not the generator, so they
fail on what would actually be imported. `branch-contract.test.js` carries the
isolation guarantees: no query may take an identifier from the request body
without also scoping by `session_id`, no read of per-visitor data may go
unscoped, and no route may read a `session_id` from a body at all.

## Setup

1. Create a Supabase project and apply `db/` in the order above.
2. Deploy the stack — see [`deploy/README.md`](deploy/README.md).
3. Import every file in `workflows/` and activate all but
   `error-handling-demo.json` (invoked by n8n directly) and
   `demo-verify-session-test.json`.
4. Create the credentials the generator pins: Postgres (Supabase), SMTP, and
   the **predefined** Google Gemini (PaLM) credential. If their ids differ from
   `N8N_IDS`, update that table and rebuild rather than re-wiring by hand.
5. Create a Cloudflare Turnstile widget, list every hostname the demo is served
   from, put the site key in `website/demo/index.html` and the secret in
   `TURNSTILE_SECRET`.

## License

See the repository owner.
