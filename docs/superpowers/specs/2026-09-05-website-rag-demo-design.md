# Website RAG demo — design

Date: 2026-09-05
Scope: a new `website` branch containing adaptivetech.ro plus an n8n-backed RAG demo.
Prerequisite: promoting the generic RAG spine from `partner-prod` to `main`.

## Context

adaptivetech.ro is currently static HTML with assets. The goal is a demo on the site where a
visitor uploads a document and asks questions against it, showing off the same RAG machinery that
powers the WhatsApp support bot — without a sales call, and without one visitor ever seeing
another's document.

The technique is already built and debugged on `partner-prod`: Gemini text extraction, section-aware
chunking at 350 tokens with 75 overlap, `gemini-embedding-001` at 1536 dimensions L2-normalised
client-side, and `hybrid_search()` fusing pgvector ANN with Romanian FTS via reciprocal rank fusion.
The demo reuses that pipeline rather than inventing a second one.

### Branch layout

The repository's branch story does not currently match the intended one. `main` holds a README and
nothing else; every workflow, SQL file and test lives only on `partner-prod`; `origin/prod` is a
single stale JSON from an initial commit. The intent — general implementation on `main`, per-client
customisation on branches — has never been executed.

This design executes half of it, deliberately:

1. **`main` gets the spine.** The pieces that are generic beyond argument: `documents.sql`,
   `hybrid_search.sql`, `match_documents.sql`, `n8n_chat_histories.sql` and its cleanup trigger,
   `hybrid-search-tool.json`, `db-cleanup.json`, both `error-handling-*.json`, and `ingestion.json`
   with the technicians-sync branch removed.
2. **`website` branches from `main`.** The site's HTML/CSS and the demo are built there.
3. **`agent.json` generalisation is deferred.** Its 2251 lines interleave the sigiliu branch,
   WhatsApp-specific routing and Romanian support-desk prompts. Deciding what a *generic* support
   agent looks like — whether a phone allowlist is generic while seal-code validation is
   client-specific — is a genuine design question, and it is answerable only against a second client.
   Generalising against a sample of one produces an abstraction that fits one client with extra steps.
   It stays on `partner-prod` and gets its own spec.

The repository stays private, so `Tabel tehnicieni pentru Robotel.ods` remaining reachable in history
is accepted rather than scrubbed. This is a decision, not an oversight: if the `website` branch ever
becomes a public repository, that spreadsheet of technician details goes with it, and history must be
rewritten *before* that happens.

### Deliberately out of scope

**Streaming answers.** A typing indicator over a plain JSON response is far simpler in n8n, and
answers against a single document land in a couple of seconds. Server-sent events through a webhook
buy nothing at this size.

**Caddy per-IP rate limiting.** The `caddy-ratelimit` plugin requires a custom `xcaddy` build, and
Cloudflare now provides the same thing without one. See Abuse and cost control.

**Anything resembling accounts.** No passwords, no profiles, no returning-user state beyond the
2-hour session. The email gate exists to verify a human and capture a lead, not to build an identity
system.

## Architecture

**Cloudflare sits in front of the origin** (free plan): it proxies the site, absorbs volumetric
attacks, and hides the Hetzner IP.

This is worthless unless the second half is done: the Hetzner firewall must accept ports 80 and 443
**only from Cloudflare's published IP ranges**. An origin that still answers on its own IP is one DNS
history lookup away from being hit directly, and Cloudflare becomes decorative. The firewall rule is
the control; the proxy is only the delivery mechanism for it.

One Hetzner VPS (CX22 class), Docker Compose, three services:

- **caddy** — TLS via Let's Encrypt; serves the static site; reverse-proxies `/api/demo/*` to
  `n8n:5678/webhook/demo/*`. The n8n editor sits on a separate hostname behind basic auth and an IP
  allowlist.
- **n8n** — no published ports. Reachable only through Caddy on the compose network.
- **postgres** — n8n's own execution and credential store. Not exposed, and it holds no demo data.

Demo data lives in a **dedicated Supabase project**, provisioned for this demo alone. Client data is
in a different project entirely; a mistake in the demo cannot reach it.

Caddy fronting `/api` on the same origin as the site is load-bearing, not incidental: it lets the
session ride in an `httpOnly; Secure; SameSite=Strict` cookie. A token in `localStorage` is readable
by any injected script; this one is not.

## The isolation guarantee

The demo's entire security model reduces to one invariant:

> **`session_id` is always read from the verified session token, never from the request body, query
> string, or any other client-controlled input.**

Retrieval calls `demo_hybrid_search(..., session_id => <from token>)`. There is no request a visitor
can construct that reaches another visitor's chunks, because no field of their request is consulted
when scoping the query. Tampering with a body field changes nothing; forging the token requires the
HMAC key.

This invariant is enforced mechanically by a test (see Testing), not by review discipline.

## Abuse and cost control

A public endpoint that spends money on every request needs this reasoned about explicitly, so here is
the arithmetic. Per session: chat is ten messages of roughly 9K input and 400 output tokens against
Haiku 4.5 at $1.00 / $5.00 per MTok, about **$0.11**; embeddings are negligible; Gemini extraction of
a 50-page PDF produces 25–40K output tokens and is probably the largest single line item. Call it
**$0.20–0.40 per session**.

**The email gate does not control this.** Three sessions per email per day sounds like a limit until
you notice disposable addresses are free and unlimited. A script with a temp-mail API and 1,000
addresses buys 3,000 sessions a day — $600–1,200 — and nothing else in the design stops it. The gate
raises the attacker's effort by about twenty minutes. It is a lead-capture mechanism that happens to
deter casual abuse, and treating it as a spending control would be a mistake.

Two distinct threats follow, and they need different answers: **volumetric attack** takes the site
down but costs no tokens, while **economic abuse** costs money without producing traffic anyone would
notice.

Five controls, in descending order of value:

**1. Separate provider keys with hard caps.** A dedicated Anthropic workspace key and a separate
Google Cloud project for the demo's Gemini key, each with its own spend and quota ceiling. This is
the only control that bounds the loss regardless of what fails in the application, and it extends the
isolation decision already made for Supabase: demo abuse must not be able to drain the budget serving
a paying client.

**2. Cloudflare Turnstile on the gate.** The Turnstile token is verified server-side in
`demo-request-code` before a code is issued. This is what actually defeats the attack above, because
that attack is scripted by definition.

**3. Cloudflare proxy plus origin firewall lock.** Covered under Architecture.

**4. Retrieval short-circuit** — see `demo-chat` below.

**5. Token budgets rather than message counts** — see `demo-chat` below.

### Accepted risks

**No global daily spend ceiling.** The provider caps in control 1 are the ceiling. The cost of this
choice is that the ceiling trips as a hard API failure mid-request rather than a graceful message, so
Error handling below requires quota failures to degrade to a *"demo temporarily unavailable — book a
call"* state rather than surfacing a provider error.

**Per-IP and per-subnet session caps, and a disposable-domain blocklist**, are deferred to a hardening
pass. Both are cheap and both raise an attacker's cost; neither is load-bearing once Turnstile and the
provider caps are in place.

**Caddy per-IP rate limiting** is superseded by Cloudflare, which does it without a custom `xcaddy`
build.

## Data model

New Supabase project, `demo` schema. Embeddings are `vector(1536)`, matching the existing pipeline.

### `demo_email_codes`

`email citext`, `code_hash text`, `expires_at timestamptz`, `attempts int default 0`,
`consumed_at timestamptz`, `created_at timestamptz`.

Only the salted hash of the code is stored. `demo-verify-code` looks up the newest unconsumed,
unexpired code **for the supplied email**, and `attempts` lives on that code row.

### `demo_sessions`

`id uuid primary key`, `email citext`, `created_at`, `expires_at` (created_at + 2h),
`files_uploaded int default 0`, `messages_used int default 0`, `input_tokens bigint default 0`,
`output_tokens bigint default 0`, `ip inet`.

The counters are the authoritative quota state. They are incremented server-side in the same statement
that authorises the action, so a concurrent double-submit cannot exceed the limit.

The two token columns are the real budget. A message count is a proxy for what you are billed for;
tokens are the thing itself, and ten messages each dragging fifteen chunks of context cost roughly
twice what ten lean ones do. They accumulate the `usage` figures returned by each Anthropic response.

### `demo_uploads`

`id uuid primary key`, `session_id uuid references demo_sessions on delete cascade`,
`filename text`, `status text`, `error text`, `chunk_count int`, `page_count int`, `created_at`.

`status` is one of `pending`, `extracting`, `embedding`, `ready`, `failed`. This row is what makes
asynchronous upload possible and what the progress UI renders.

### `demo_documents`

Mirrors `documents`: `id bigserial`, `content text`, `metadata jsonb`, `embedding vector(1536)`,
`fts tsvector` generated from `content`, `created_at`. Plus
`session_id uuid not null references demo_sessions on delete cascade`.

**No HNSW index.** This is a deliberate departure from `documents.sql`, and it follows that file's own
warning that HNSW post-filters, so a selective filter starves the candidate pool. A per-session filter
is maximally selective: one session holds one document of at most 50 pages, roughly 150–400 chunks.
An exact cosine scan over a btree-filtered subset of that size is both faster and *exactly* accurate,
where an ANN scan would have to over-fetch and discard. Dropping the index removes the recall problem
rather than tuning around it.

Indexes: btree on `session_id`, GIN on `fts`, GIN on `metadata jsonb_path_ops`.

The FTS configuration stays `romanian`, matching the existing schema. An English upload gets weaker
lexical matching; the semantic branch carries it.

### `demo_messages`

`session_id uuid references demo_sessions on delete set null`, `role text`, `content text`,
`created_at`.

`SET NULL`, not `CASCADE`. These questions are product signal — what prospects actually ask the demo —
and the purge must not eat them along with the session.

### `demo_leads`

`email citext primary key`, `first_seen_at`, `last_seen_at`, `sessions_count int`,
`documents_uploaded int`, `messages_sent int`, `consent_at timestamptz`, `last_ip inet`.

Aggregates only: no document text, no chat text. `consent_at` records when the visitor ticked the
contact checkbox at the gate.

A companion `demo_suppressions` table (`email citext primary key`, `created_at`) holds addresses that
have unsubscribed. It suppresses **marketing contact, not demo access**: `demo-verify-code` skips the
`demo_leads` upsert for a suppressed address, but the visitor still gets their session and their demo.
Someone who unsubscribes is saying "stop contacting me", not "revoke my access", and conflating the
two turns an unsubscribe link into a self-ban. The transactional code email still sends — it is the
thing they just asked for.

### Retention

Three tiers, because one cascade cannot serve three different purposes:

| Data | Retained | Why |
|---|---|---|
| `demo_documents`, `demo_uploads` | until session expiry (2h) | Someone's actual contract or manual. It should not outlive the demo. |
| `demo_messages` | 30 days | Product signal, detached from the session. |
| `demo_leads` | until unsubscribe | The thing the demo exists to collect. |

An hourly cron enforces the first two and deletes expired codes. `demo_leads` sits outside every
cascade by construction.

The gate carries a consent checkbox ("I agree to be contacted about Adaptive Technologies") and a
privacy link. Adaptive Technologies is a Romanian company collecting email addresses for follow-up;
this is a ten-minute addition now and a painful retrofit later.

"Until unsubscribe" needs a mechanism, or it is just a phrase. Every code email carries an unsubscribe
link to a `GET /api/demo/unsubscribe?t=<signed token>` route that deletes the `demo_leads` row and
records the address in a short suppression list, so a later demo session cannot silently re-add it.
The token is HMAC-signed with the same key as the session token, so the link cannot be used to
enumerate or remove other people's addresses.

## `demo_hybrid_search()`

Same return columns as `hybrid_search()` — `id`, `content`, `metadata`, `similarity` — and the same
RRF fusion of a semantic and a lexical branch. Three differences:

- **`session_id uuid` is a required parameter, and there is no `filter` jsonb at all.** The existing
  function's optional `filter` defaults to `'{}'`, meaning "search everything"; a function whose
  unsafe mode is its default is the wrong shape for this job. Dropping the parameter makes the
  dangerous call unrepresentable rather than merely discouraged.
- **Both branches are scoped**, not just the semantic one. `where session_id = $1` appears in the
  semantic subquery and in the lexical subquery. A session-scoped ANN branch fused with an unscoped
  FTS branch would leak other sessions' content through RRF, which is exactly the kind of partial fix
  that passes a casual read.
- The semantic branch is an exact scan: `where session_id = $1 order by embedding <=> $2 limit pool`,
  served by the btree index. No `hnsw.ef_search` tuning, no approximation.

## HTTP contract

All routes are `POST` under `/api/demo/`, proxied to n8n webhooks. All except `request-code` and
`verify-code` require the session cookie.

| Route | Body | Returns |
|---|---|---|
| `request-code` | `{email, consent, turnstile_token}` | `202` always |
| `verify-code` | `{email, code}` | `200` + `Set-Cookie`, or `401` |
| `upload` | multipart file | `202 {upload_id}` |
| `upload-status` | `{upload_id}` | `{status, error, chunk_count, page_count}` |
| `chat` | `{message}` | `{answer, sources[], messages_left}` |

Plus one exception to the POST rule: `GET /api/demo/unsubscribe?t=<signed token>`, which needs to be
reachable from an email client.

Errors return a typed `code` the frontend maps to a message, never a raw n8n error.

## Workflows

Six webhook workflows, two sub-workflows, one cron. The sub-workflows use `executeWorkflowTrigger`,
matching the existing `hybrid-search-tool.json` pattern.

### `demo-request-code`

Verify the **Turnstile token** server-side against Cloudflare's `siteverify` endpoint before doing
anything else; reject the request if it fails. This is the control that actually stops scripted
signup, so it runs first and unconditionally.

Then validate the email's shape and require `consent`. Enforce two throttles: **3 sessions per email
per day** and **3 codes per email per hour**. The second is not redundant — without it the endpoint is a
free mail-bombing tool aimed at someone else's inbox, and the sending reputation burned is Adaptive
Technologies'.

Generate six digits from `crypto.randomBytes`, store the salted hash with a 10-minute expiry, send via
the SMTP credential the existing `error-handling-*` workflows already use. Respond `202` regardless of
outcome.

### `demo-verify-code`

Look up the newest unconsumed, unexpired code for the email. Reject if absent, expired, or
`attempts >= 5`. Compare with `timingSafeEqual`. On success: consume the code, insert `demo_sessions`
with a 2-hour TTL, upsert `demo_leads`, and respond with the `Set-Cookie` token. On failure: increment
`attempts` and return `401`.

### `verify-session` (sub-workflow)

Verify the HMAC and the expiry; return `session_id` or fail. Every route that touches session data
calls this and nothing else. One implementation, one place to audit.

### `demo-upload`

Verify session. Enforce `files_uploaded < 1`, size ≤ 10 MB, and an allowlist of PDF / DOCX / TXT
checked by **magic bytes**, not the declared MIME type. Insert `demo_uploads` as `pending` and respond
`202` immediately.

Then, asynchronously: Gemini extraction → the generic chunker → `batchEmbedContents` → L2-normalise →
insert with `session_id`, advancing `status` at each stage. Reject documents exceeding a ceiling of
600 chunks, so a dense 50-page document cannot blow the embedding budget.

Upload is asynchronous because extraction plus batch embedding on a 50-page PDF runs 30–90 seconds.
Holding an HTTP request open that long is fragile on mobile networks and shows the visitor a blank
spinner. Polling turns the same wait into a staged progress display — *extracting text*, *building the
index* — which on a demo is a feature rather than overhead.

**The extraction prompt is rewritten, not trimmed.** The existing one is framed throughout as a
Romanian technical-support extractor. The generic version keeps the structural rules — `##` section
headings, table rows rewritten as standalone sentences, verbatim fidelity for codes, passwords, key
sequences and specifications, original language, no summarising, single-request completion — and drops
the support-desk framing entirely.

**On page and chunk limits.** The 600-chunk ceiling is the enforced guard, checked after chunking;
`page_count` is recorded for display only. Page count is not a limit in its own right, because it is a
poor proxy for cost — fifty sparse slides and fifty dense specification pages differ by an order of
magnitude in tokens, and the chunk count measures the thing actually being paid for.

### `demo-search` (sub-workflow)

Embed the query with `RETRIEVAL_QUERY` at 1536 dimensions, L2-normalise, call `demo_hybrid_search`
with the `session_id` passed in by the caller, and format the results into labelled blocks. This is
the demo's counterpart to `hybrid-search-tool.json` and follows its node structure closely.

Keeping retrieval in its own sub-workflow means the `session_id` scoping lives at exactly one call
site, which is what makes the isolation test in Testing a cheap structural assertion rather than a
whole-graph analysis.

### `demo-upload-status`

Verify session, return the `demo_uploads` row scoped to that session. Polled every 5 seconds.

### `demo-chat`

Verify session. Enforce `messages_used < 10` **and the per-session token budget**. Load history from
`demo_messages`, call `demo-search` with the verified `session_id`, prompt Haiku 4.5 over `httpRequest`
as `agent.json` does, persist both turns, add the response's `usage` to the session's token counters,
respond.

**Retrieval short-circuits before Claude is called.** If `demo-search` returns nothing above a score
floor, `demo-chat` returns the canned "that isn't in your document" refusal **without making an
Anthropic request at all**.

This is the control that answers "someone using our tokens for something other than the demo". An
off-document query costs one embedding call and never reaches Haiku. Anyone hoping to use the endpoint
as a general-purpose LLM must first upload a document and then phrase every query so it retrieves
against that document — at which point the retrieved context is prepended and constrains the output
anyway. It costs one `IF` node and it removes almost all of the endpoint's value as a proxy.

Two supporting caps: `max_tokens` is set to ~800, and retrieval is cut to the top 8 chunks rather than
15. The demo answers questions about one document; it does not need the context budget the WhatsApp
agent uses against a whole knowledge base.

The system prompt is narrow: answer only from the supplied excerpts, name the section used, and say
plainly when the document does not cover the question. Answers carry source chips built from the
`original_file_name` / `section_heading` labels the existing `Format Results` node already produces.

That refusal behaviour is the demo's most persuasive moment. A prospect who asks something
off-document and is told *"that isn't in your document"* — instead of receiving a confident
fabrication — learns more about why they would buy this than any correct answer demonstrates.

### `demo-cleanup` (cron, hourly)

Delete expired sessions, cascading documents and uploads; delete `demo_messages` older than 30 days;
delete expired codes. `demo_leads` is untouched.

## Frontend

One page, vanilla JavaScript, no build step — matching the site as it exists. Three states swapped in
place: **email gate → upload with progress → chat**. Same-origin `fetch`, so the cookie rides
automatically.

The gate embeds the Turnstile widget and sends its token with `request-code`. Turnstile is invisible
for most visitors, so it costs the funnel almost nothing.

The chat shows a typing indicator, source chips beneath each answer, and a visible *"7 questions
left"* counter, so the limit reads as a demo boundary rather than a malfunction.

The site's HTML and CSS do not exist in this repository yet; they arrive on the `website` branch, and
the demo page is styled to match them.

## Error handling

The visitor-facing rule: **every failure produces a state the UI can render, never a dead spinner.**
Extraction failure, a hit quota, an expired session, a scanned PDF with no text layer — each either
sets `demo_uploads.status = 'failed'` with a plain-language `error`, or returns a typed error code.

**Provider quota exhaustion is a named case, not a generic one.** Because there is no global soft cap
(see Accepted risks), the spend ceiling trips as a hard failure from Anthropic or Gemini in the middle
of a real visitor's request. Both `demo-upload` and `demo-chat` catch quota and rate-limit responses
specifically and degrade to *"the demo is temporarily unavailable — book a call"*, with an alert to
the team. Without this the worst case is a prospect watching the product fail with a raw API error.

The scanned-PDF case deserves naming because it is the most likely real failure:
*"this PDF has no text layer — try a text-based document"* is a far better demo moment than a generic
error, and it is a one-branch check on extracted character count.

Internally, every demo workflow sets `error-handling-demo` as its error workflow, following the
pattern of the existing two: build a report, email the team. A demo that breaks silently on a Saturday
is worse than no demo.

## Secrets

The HMAC signing key, the code-hash pepper, the Supabase connection string, the Turnstile secret, and
the Gemini and Anthropic keys are all n8n credentials. None appear in workflow JSON. The workflow files
are committed to this repository, so this is a hard line rather than a preference.

**The demo's Anthropic and Gemini keys are distinct from the ones the WhatsApp bot uses** — a separate
Anthropic workspace key and a separate Google Cloud project, each carrying its own spend and quota
ceiling. Sharing a key would mean a scripted attack on a public marketing demo could exhaust the quota
that answers a paying client's support messages.

## Testing

Following the repository's existing pattern — unit tests for extracted `lib/` logic, structural
assertions against workflow JSON.

- **`lib/demo-session.js`** — token signing, verification, expiry, and tamper rejection, as pure
  functions. This is the security core; it does not belong buried in a Code node where it cannot be
  tested directly.
- **`lib/demo-chunker.js`** — the generic chunker, tested at the 600-chunk ceiling and on edge cases:
  empty document, no headings, one oversized section.
- **`tests/demo-workflow.test.js`** — structural assertions: every webhook touching session data calls
  `verify-session`; no workflow reads `session_id` from a request body; no plaintext secrets appear in
  any workflow file.

The last of these is the one that matters. It enforces the isolation invariant mechanically, so a
future edit cannot quietly break it.

## Verification

Before this is called done:

- Upload a real PDF end to end and get a grounded answer with correct source attribution.
- Confirm a second session cannot retrieve the first session's chunks by any constructible request.
- Confirm an off-document question produces a refusal, not a fabrication.
- Confirm the hourly purge removes documents and uploads, and spares `demo_messages` and `demo_leads`.
- Confirm a scanned PDF fails with the specific message rather than a generic error.
- Confirm `request-code` rejects a request with a missing or replayed Turnstile token.
- Confirm an off-document question returns the refusal **without an Anthropic request being billed** —
  check the workflow execution, not just the reply text. This is the control that fails silently if it
  is wired in the wrong order.
- Confirm the origin refuses a direct connection to the Hetzner IP on 80/443 from outside Cloudflare's
  ranges. A Cloudflare proxy without this firewall rule provides no protection at all.
