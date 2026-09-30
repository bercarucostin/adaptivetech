# Scope-aware retrieval — design

Date: 2026-09-30
Branch: `partner-prod` (the agent workflow lives only there)
Touches: [workflows/agent.json](../../../workflows/agent.json),
[workflows/ingestion.json](../../../workflows/ingestion.json), `lib/drive-tree.js`, two new libs
(`lib/folder-kinds.js`, `lib/retrieval-scope.js`), one new table (`kb_folders`), tests.
No change to `hybrid_search`, `hybrid-search-tool.json`, chunking, or any stored chunk.
No re-ingestion.

## Problem

The knowledge base mixes two kinds of top-level folders:

- **Product folders**, whose documents apply to one product (`PARTNER 200`, `PARTNER 600`, …).
- **Shared folders**, whose documents apply to every product (`DOCUMENTATIE COMUNA`,
  `TASTATURI VIRTUALE`, and files at the root of the knowledge base).

When a question names a product — "cum adaug sertar la partner200" — retrieval leans toward that
product's folder and can push the shared document that actually holds the answer out of the top 15:

1. **Lexical branch.** `websearch_to_tsquery` ANDs every term. The optimizer's lexical query
   carries the product name (`sertar partner 200`), so a shared chunk that never says "200" is
   dropped from the lexical branch entirely. Every product chunk matches it, because the
   `[PARTNER 200]` label is part of the chunk's text.
2. **Semantic branch.** Each chunk's embedding includes its title (`PARTNER 200 — Manual — …`), so
   a query that names the product sits closer to every chunk of that product, including weakly
   related ones.

The same effect makes cross-product answers likely when the named product's folder lacks the
section: P200 questions answered from the P600 manual, with no signal to the answer model.

The problem is not specific to this client. Any knowledge base with per-product folders plus shared
material has it, so the fix is expressed in terms of folders, never models, and nothing in it is
configured per client or per product.

## Goal and success criteria

- A question that names a product retrieves shared-folder chunks as well as it would without the
  product name.
- The answer model knows which product the user means, prefers that product's and shared
  documents, and says so when it falls back to another product's document.
- Whether a folder is shared or product-specific is decided automatically when the folder first
  appears in Drive, recorded in the database, and can be overridden from Drive. No list of folders
  lives in code.
- Measured on a fixed question set (see Evaluation): for each question whose answer is only in a
  shared folder, the answer chunk is in the top 15 both with and without the product named.

## Design

### 1. Folder kinds: the `kb_folders` table

```sql
create table public.kb_folders (
  folder      text        primary key,   -- top-level folder name, = documents.metadata->>'folder'
  kind        text        not null check (kind in ('shared', 'product')),
  decided_by  text        not null check (decided_by in ('drive', 'llm', 'manual')),
  decided_at  timestamptz not null default now()
);
```

One row per **top-level** folder of the knowledge base. Subfolders inherit their top-level folder's
kind, as they already inherit its label. Files at the root (empty folder) are always shared and get
no row.

The table is separate from `documents` on purpose: classifying or correcting a folder is a one-row
change, and no chunk is rewritten.

### 2. Ingestion classifies new folders

On every scheduled run, after the Drive listing, ingestion:

1. **Reads Drive overrides.** A top-level folder whose Drive description contains `#shared` or
   `#product` (case-insensitive) is written to `kb_folders` with `decided_by = 'drive'`, replacing
   whatever row was there. This is how a person corrects a classification without touching SQL.
2. **Finds unclassified folders:** top-level folders with no row in `kb_folders`.
3. **Classifies them in one LLM call,** only when there is at least one. The call gets every
   top-level folder name (so the model sees "PARTNER 200, PARTNER 300, …, DOCUMENTATIE COMUNA"
   side by side), and for each unclassified folder up to 30 of its file names. It returns
   `{ "<folder>": "shared" | "product" }`. Model: `gemini-3.5-flash-lite`, the one ingestion
   already uses, with the same credential.
4. **Inserts** the answers with `decided_by = 'llm'`. An LLM answer never overwrites an existing
   row, so `drive` and `manual` decisions are permanent until a person changes them.

Rules for who wins:

| Existing row      | Drive tag present      | LLM result      | Outcome                          |
|-------------------|------------------------|-----------------|----------------------------------|
| none              | yes                    | —               | row from Drive (LLM not called)  |
| none              | no                     | shared/product  | row from LLM                     |
| any               | yes                    | —               | Drive replaces the row           |
| llm / manual      | no                     | —               | unchanged (no LLM call)          |

Removing a Drive tag later leaves the row as it is. `decided_by = 'manual'` is for rows edited
directly in SQL; ingestion never writes it.

Each classification is logged in the execution (`console.log`: `folder "X" classified as shared by
llm`), so a new folder's kind is visible in the n8n execution and in the table.

**Failure handling.** The classification branch must never stop the file sync. The LLM node uses
`onError: continueRegularOutput`; a failed or unparsable answer leaves those folders unclassified,
and the next run retries them. Unknown folder names and answers other than `shared`/`product` are
dropped. Postgres errors fail the run as they do today — the file sync would fail on the same
database.

**First run after deploy** classifies the 7 existing folders in one call. No document is
re-extracted or re-embedded.

### 3. The agent reads the folder kinds

A new agent node, `Load KB Folders`, reads every folder that has documents, with its kind:

```sql
select d.folder, coalesce(k.kind, 'product') as kind
from (select distinct metadata->>'folder' as folder
      from documents
      where metadata->>'source' = 'knowledge_base'
        and coalesce(metadata->>'folder', '') <> '') d
left join kb_folders k using (folder)
order by 1
```

A folder with documents but no row yet (ingested before it could be classified) counts as a
product folder until it is classified. Rows for folders that no longer have documents are ignored.

### 4. The optimizer returns a scope and product-free queries

`Optimize Query` today sees only the current message and returns `{ semantic, lexical }`. It now
also receives:

- the folder list from `Load KB Folders`, marked shared or product;
- the last 6 turns of the conversation from `Load Chat History`, each truncated to 300
  characters, so a follow-up ("și cum îl resetez?") keeps the product named earlier.

It returns `{ semantic, lexical, scope }`:

- `scope` is the one **product** folder the user is asking about, copied exactly from the list, or
  `null` when no product is named or implied. Never a shared folder.
- `semantic` and `lexical` describe the task only. Product and model names that identify the scope
  are left out of both. Error codes, menu names and other exact terms stay in.

### 5. Parsing validates the scope

`Parse Optimized Query` keeps its current fallbacks for `semantic` and `lexical`, and adds:
`scope` is kept only if it equals a product folder from `Load KB Folders`; anything else — a guess,
a paraphrase, a shared folder, wrong case — becomes `null`. A parse failure yields `scope: null`.
Retrieval never fails because of the scope.

Retrieval itself is unchanged: `Retrieve Docs` sends `query` and `lexical` to
`hybrid-search-tool`, over the whole knowledge base, with no filter.

### 6. The answer prompts receive the scope

`Build Prompt` adds one line to the user message, ahead of the documentation:
`USER'S PRODUCT: PARTNER 200`, or `USER'S PRODUCT: not stated`.

Rule 3 of its system prompt is generated from `Load KB Folders` instead of naming folders:

- Each document begins with its folder in square brackets.
- Documents from `<shared folders, listed>` or with no folder apply to every product.
- A document from any other folder applies to that product. When USER'S PRODUCT is known, answer
  from that product's documents and the shared documents.
- If only another product's document covers the question, you may use it, but say explicitly that
  it comes from the documentation for that other product and the steps may differ.
- When USER'S PRODUCT is not stated and the documentation gives different answers for different
  products, ask which product the user has.

The fallback agent (`Normalize For Agent` → `AI Agent1`) gets the same scope line and the same
rule. Its `Knowledge Base (Hybrid Search)` tool description changes from "include product name" to
"describe the task; leave out product names", so its own searches do not reintroduce the bias.

### 7. Code layout

Pure functions, each file between `SHARED START` / `SHARED END` markers and embedded into Code nodes
the way `lib/chunking.js` is today:

- `lib/drive-tree.js`: `buildFolderTree` also returns `topFolders: [{ id, name, description }]`
  for the root's direct children.
- `lib/folder-kinds.js` (ingestion):
  - `driveTag(description)` → `'shared' | 'product' | null`
  - `planClassification(topFolders, existingRows, filesByFolder)` → `{ overrides, toClassify, request }`
    — `request` is the Gemini body, or `null` when nothing needs classifying
  - `parseClassification(rawText, toClassify)` → `{ <folder>: kind }`, only listed folders and
    valid kinds
  - `upsertSql(overrides, classified)` → one statement: Drive rows upsert, LLM rows
    `on conflict do nothing`
- `lib/retrieval-scope.js` (agent):
  - `buildOptimizerRequest(question, historyMessages, folders)` → the Anthropic request body
  - `parseOptimizedQuery(rawText, question, folders)` → `{ query, lexical, scope }`
  - `scopePrompt(scope, folders)` → `{ productLine, rule }` for both answer prompts

### 8. Wiring

**Ingestion.** `Build Drive Manifest` gains a second branch, placed above `Sync Check` on the canvas
so n8n runs it first:

`Build Drive Manifest → Load Folder Kinds → Plan Folder Classification → Classify Folders (Gemini, only if request) → Save Folder Kinds`

`Load Folder Kinds` and `Save Folder Kinds` are Postgres nodes with `executeOnce: true`.

**Agent.** Today `Unified Input` fans out to `Load Chat History` and `Optimize Query` in parallel,
and `Merge History + RAG` joins history with the retrieved docs. The optimizer now needs history
and folders, so the chain becomes:

`Unified Input → Load Chat History → Load KB Folders → Build Optimizer Request → Optimize Query → Parse Optimized Query → Retrieve Docs → Build Prompt`

- `Merge History + RAG` is removed; `Build Prompt` and `Normalize For Agent` already read history
  and docs by node name.
- `Load Chat History` gets `alwaysOutputData: true`: a new user has no history rows, and without it
  the chain would stop. The empty item it emits is already skipped by the history loops.
- `Load KB Folders` gets `executeOnce: true`: it receives up to 10 history items, and a Postgres
  node runs its query once per input item.
- `Optimize Query` sends the body built by `Build Optimizer Request` and keeps `retryOnFail`.

The added latency per message is one small query plus moving the history load onto the critical
path, a few tens of milliseconds.

## Error handling

| Situation                                    | Behaviour                                                        |
|----------------------------------------------|------------------------------------------------------------------|
| Classifier call fails or returns junk        | Folders stay unclassified, retried next run; file sync continues |
| Folder has documents but no `kb_folders` row | Treated as product                                               |
| `Load KB Folders` returns no rows            | Every scope becomes `null`; behaves as today minus product names |
| Agent Postgres error                         | Execution fails to the error workflow, as today                  |
| Optimizer returns malformed JSON             | Today's fallback (raw question as both queries), `scope: null`   |

The raw-question fallback still contains the product name. That is today's behaviour, accepted for
a path that only runs when the optimizer fails.

## Testing

- `tests/folder-kinds.test.js`: `driveTag` recognises `#shared`/`#product` anywhere, any case, and
  nothing else; `planClassification` skips folders that have a row or a Drive tag, returns
  `request: null` when none remain, caps file names at 30; `parseClassification` drops unknown
  folders and invalid kinds, tolerates code fences, returns `{}` on malformed JSON; `upsertSql`
  quotes names safely, upserts Drive rows and inserts LLM rows with `on conflict do nothing`.
- `tests/drive-tree.test.js`: `topFolders` lists only the root's direct children, with
  descriptions.
- `tests/retrieval-scope.test.js`: scope accepted only for a listed product folder; shared folder,
  unknown name, wrong case and `null` yield `null`; malformed JSON and code fences handled; history
  capped at 6 turns of 300 characters; the request lists folders with their kinds; `scopePrompt`
  names the shared folders and handles unknown scope.
- `tests/db-schema.test.js`: `kb_folders` DDL present with its checks.
- Workflow wiring tests for both chains above, the node flags (`alwaysOutputData`, `executeOnce`,
  `onError`), each Code node's embedded block equal to its lib's `SHARED` block, and the KB tool
  description no longer asking for product names.

## Evaluation

Before merging, run a fixed question set through `hybrid-search-tool` in n8n and record the rank
of the chunk holding the answer, with the current optimizer and the new one.

Questions whose answer is only in a shared folder, each asked without and with a product:

1. cum adaug sertar (+ la partner 200)
2. cum inlocuiesc certificatul digital (+ la partner 600)
3. cum activez cartela SIM vodafone (+ pe partner 300)
4. cum fac update de firmware de pe stick (+ la partner 200)
5. cum pun CIF-ul clientului pe bon (+ la partner 600)
6. cum conectez tastatura virtuala de pe telefon (+ la partner 300)

Plus two product-only questions, to check nothing regresses: "ce acumulator are partner 300" and
"procedura de reset partner touch evo".

Pass: every shared-answer question has its answer chunk in the top 15 in both variants, and the
product-only questions still retrieve their product's chunk in the top 5. Also check the first
ingestion run classifies the 7 existing folders as expected (5 product, 2 shared). If shared chunks
still drop out, the next step is two filtered searches (product folder + shared folders), which this
design does not include.

## Out of scope

- Filtering or boosting in `hybrid_search`.
- Changing chunk labels or embedding titles at ingestion.
- Notifying anyone by email when a folder is classified; the execution log and the table are the
  record.
- Multi-product comparisons ("diferenta dintre P200 si P600"): scope is `null` for them, and the
  fallback agent can still search per product.
- The agent reliability items (retries, reply-before-save), specified separately on the unmerged
  branch `docs/agent-reliability-spec`.
