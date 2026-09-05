# WhatsApp RAG Support Bot — n8n

The general implementation of an n8n-backed WhatsApp support bot with hybrid
retrieval over a document knowledge base. Per-client customisation lives on its
own branch; this branch holds only what is client-agnostic.

## Branches

| Branch | Contents |
|---|---|
| `main` | This generic spine: schema, retrieval, ingestion, error handling |
| `partner-prod` | The active client deployment — agent workflow, client-specific credential validation, technician sync |
| `website` | adaptivetech.ro and its public RAG demo |

`main` does not yet contain an agent workflow. Generalising `agent.json` needs a
second client to generalise against, so it stays on `partner-prod` for now;
`workflows/error-handling-agent.json` and `workflows/hybrid-search-tool.json`
are here ahead of it deliberately — `agent.json` is the only caller of the
retrieval tool's `executeWorkflowTrigger`, and the error handler it triggers
on failure — so the set lands together when that work happens.

## What's here

### Database (`db/`)

| File | Purpose |
|---|---|
| `documents.sql` | Chunk store — 1536-dim pgvector embeddings, generated Romanian `tsvector`, HNSW + GIN + btree indexes |
| `hybrid_search.sql` | pgvector ANN fused with Postgres FTS via reciprocal rank fusion |
| `match_documents.sql` | Pure-semantic search, kept for LangChain-node compatibility |
| `cleanup_n8n_chat_histories_after_insert.sql` | Trigger run after each insert into `n8n_chat_histories`. It is a message-type filter, not a length cap: it never looks at `session_id`, and deletes the just-inserted row unless it is a `human` message or an `ai` message with no `tool_calls`. History is bounded instead by `db-cleanup.json`'s weekly sweep |
| `n8n_chat_histories.sql` | Per-user conversation memory. Its `CREATE TRIGGER` references `cleanup_n8n_chat_histories_after_insert()`, which is resolved at creation time — apply that file first |

Apply `documents.sql` before `hybrid_search.sql` — the function depends on the
table's `vector(1536)` typmod and on the `romanian` FTS configuration.

### Workflows (`workflows/`)

| File | Purpose |
|---|---|
| `ingestion.json` | Google Drive → Gemini extraction → section-aware chunking → batch embedding → Postgres. Two branches: knowledge base and expert feedback |
| `hybrid-search-tool.json` | Sub-workflow: embeds a query and calls `hybrid_search()`, returning labelled chunks |
| `db-cleanup.json` | Weekly SQL sweep of old conversations, plus pruning of old rows from the `executions` Data Table |
| `error-handling-ingestion.json` | Error workflow for ingestion — builds a report, emails the team |
| `error-handling-agent.json` | Error workflow for an agent workflow — also replies to the original sender |

Workflow JSON carries n8n instance-specific IDs (`credentials.*.id`,
`settings.errorWorkflow`, node `id`s). Re-point credentials in the n8n UI after
importing; the files are templates, not portable deployments. A few node
*parameters* also carry deployment-specific values rather than going through a
credential — notably `error-handling-agent.json`'s `Send Error Message to
Original Sender` node, whose `phoneNumberId` is hard-coded to the exporting
deployment's Meta WhatsApp Business phone number ID (see Setup step 6).

## Retrieval design

Chunking is section-aware: text is split on `##` headings emitted by the Gemini
extraction prompt, then windowed at 350 tokens with 75 tokens of overlap. Each
chunk is prefixed with its document title and section heading before embedding,
so a retrieved chunk carries its own context.

Embeddings are `gemini-embedding-001` at `outputDimensionality: 1536`. **The API
does not normalise at that dimension** — only at 3072 — so every embedding is
L2-normalised client-side before insert and before search. `hybrid_search()`
assumes normalised vectors.

Search fuses two branches with RRF: an HNSW cosine scan and a `romanian`
`ts_rank` scan, each limited to a candidate pool before fusion. The returned
`similarity` column is an RRF score, not a cosine similarity — do not threshold
it as though it were one.

Romanian is baked into more than the FTS configuration choice: the Gemini
extraction prompts are written in Romanian, the WhatsApp error text sent to
users is Romanian, several SQL comments are Romanian, and
`error-handling-agent.json` formats timestamps as `ro-RO` / `Europe/Bucharest`.
A deployment in another language touches all four.

## Tests

```bash
node --test tests/
```

No dependencies and no `package.json`: tests use `node:test` and `node:assert`
against the workflow JSON directly. They assert graph structure — that chains are
wired in the right order and that removed nodes stay removed — which is what
catches an n8n re-export that silently drops a connection.

## Setup

1. Provision PostgreSQL 15+ with pgvector ≥ 0.7.0.
2. Apply the files in `db/` in the order given above —
   `cleanup_n8n_chat_histories_after_insert.sql` must precede
   `n8n_chat_histories.sql`. The latter's `CREATE TRIGGER` resolves the
   trigger function at creation time, so applying them in table order instead
   fails with `ERROR: function cleanup_n8n_chat_histories_after_insert() does
   not exist`.
3. Import the workflows in `workflows/` into n8n.
4. Create credentials in n8n for: Postgres, Google Drive, Google Gemini
   (HTTP query auth), WhatsApp, and SMTP. Re-point each node's credential.
   The WhatsApp credential is used by `error-handling-agent.json`'s
   `Send Error Message to Original Sender` node — without it, that node is
   left unconfigured and fails silently until an agent error fires.
5. Set each workflow's error workflow to the matching `error-handling-*`.
6. Point `Drive: Knowledge Base` and `Drive: Expert Feedback` at your
   folders, and re-point `error-handling-agent.json`'s `Send Error Message to
   Original Sender` node: its `phoneNumberId` parameter is hard-coded to the
   exporting deployment's Meta WhatsApp Business phone number ID rather than
   coming from a credential, so it is untouched by step 4. **`ingestion.json`
   ships with `"active": true`.** Combined with its schedule trigger, it can
   start importing against the exporting deployment's Drive folder IDs before
   you finish this step — deactivate it on import if you are not ready for it
   to run immediately.

### The `executions` Data Table

`db-cleanup.json` and `error-handling-agent.json` both read or write an n8n
**Data Table** named `executions`, addressed by IDs that are instance- and
project-specific — re-point them after import. Its implied columns are
`execution_id`, `workflow_id`, `phone_number`, and `createdAt`. Nothing
shipped on this branch writes to it: the client agent workflow (kept on
`partner-prod` as `agent.json`) is its only writer. On a fresh instance
without it, `db-cleanup.json`'s "Clean old execution logs" step fails, and
`error-handling-agent.json`'s row lookup fails — which also silences its
reply to the original sender, since the recipient phone number comes from
that lookup's `phone_number` column.

Both `error-handling-*` workflows email failure reports to
`service_account@adaptivetech.ro`, subject-prefixed `Partner` — that is the
vendor's own address, not a placeholder; point it elsewhere if you don't want
reports routed there.

## License

See the repository owner.
