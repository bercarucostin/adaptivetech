# Scope-aware retrieval — design

Date: 2026-09-30
Branch: `partner-prod` (the agent workflow lives only there)
Scope: [workflows/agent.json](../../../workflows/agent.json), a new `lib/retrieval-scope.js`, tests.
No change to `hybrid_search`, `hybrid-search-tool.json` or ingestion.

## Problem

The knowledge base mixes two kinds of folders:

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
material has it, so the fix is expressed in terms of folders, never models.

## Goal and success criteria

- A question that names a product retrieves shared-folder chunks as well as it would without the
  product name.
- The answer model knows which product the user means, prefers that product's and shared
  documents, and says so when it falls back to another product's document.
- Nothing is configured per product. Folder names are read from the data; the only per-client
  setting is the list of shared folders.
- Measured on a fixed question set (see Evaluation): for each question whose answer is only in a
  shared folder, the answer chunk's rank with the product named is no worse than without it, and is
  within the top 15 in both cases.

## Design

### 1. The optimizer returns a scope and product-free queries

`Optimize Query` today sees only the current message and returns `{ semantic, lexical }`. It now also
receives:

- **The folder list**, read at runtime by a new node, `Load KB Folders`:
  `SELECT DISTINCT metadata->>'folder' AS folder FROM documents WHERE metadata->>'source' = 'knowledge_base' AND coalesce(metadata->>'folder', '') <> '' ORDER BY 1`.
  A new folder in Drive appears here after the next ingestion run, with no configuration.
- **The last 6 turns of the conversation**, from `Load Chat History`, each truncated to 300
  characters, so a follow-up ("și cum îl resetez?") keeps the product named earlier.

It returns `{ semantic, lexical, scope }`:

- `scope` is the one **product** folder the user is asking about, copied exactly from the list, or
  `null` when no product is named or implied. It is never a shared folder.
- `semantic` and `lexical` describe the task only. Product and model names that identify the scope
  are left out of both. Error codes, menu names and other exact terms stay in.

The optimizer is told which folders are shared, so it does not pick one as the scope.

### 2. Parsing validates the scope

`Parse Optimized Query` keeps its current fallbacks for `semantic` and `lexical`, and adds:

- `scope` is kept only if it equals a folder name from `Load KB Folders` and is not in the shared
  list. Any other value — a guess, a paraphrase, a shared folder — becomes `null`.
- A parse failure yields `scope: null` and today's fallbacks. Retrieval never fails because of the
  scope.

Retrieval itself is unchanged: `Retrieve Docs` still sends `query` and `lexical` to
`hybrid-search-tool`, over the whole knowledge base, with no filter.

### 3. The answer prompts receive the scope

`Build Prompt` adds one line to the user message, ahead of the documentation:
`USER'S PRODUCT: PARTNER 200` when a scope is known, `USER'S PRODUCT: not stated` otherwise.

Rule 3 of its system prompt is rewritten, with the shared folders filled in from the setting rather
than hard-coded:

- Each document begins with its folder in square brackets.
- Documents from `<shared folders>` and from the root apply to every product.
- A document from a product folder applies to that product. When USER'S PRODUCT is known, answer
  from that product's documents and the shared documents.
- If only another product's document covers the question, you may use it, but say explicitly that
  it comes from the documentation for that other product and the steps may differ.
- When USER'S PRODUCT is not stated and the answer differs between products in the documentation,
  ask which product the user has.

The fallback agent (`Normalize For Agent` → `AI Agent1`) gets the same scope line and the same rule.
Its `Knowledge Base (Hybrid Search)` tool description changes from "include product name" to
"describe the task; leave out product names", so its own searches do not reintroduce the bias.

### 4. One setting: the shared folders

`SHARED_FOLDERS` is a constant at the top of `lib/retrieval-scope.js`:
`['DOCUMENTATIE COMUNA', 'TASTATURI VIRTUALE']`. Root-level files (empty folder) are always shared.
It is the only client-specific value, and it lives with the code that uses it.

### 5. Code layout

Pure functions go in `lib/retrieval-scope.js`, between `SHARED START` / `SHARED END` markers, and are
embedded into Code nodes the same way `lib/chunking.js` is embedded into ingestion:

- `buildOptimizerRequest(question, historyMessages, folders)` → the Anthropic request body.
- `parseOptimizedQuery(rawText, question, folders)` → `{ query, lexical, scope }`.
- `scopeRule(scope)` → the rule-3 text and the `USER'S PRODUCT` line, used by both answer prompts.

### 6. Wiring

Today `Unified Input` fans out to `Load Chat History` and `Optimize Query` in parallel, and
`Merge History + RAG` joins history with the retrieved docs. The optimizer now needs history, so the
chain becomes sequential:

`Unified Input → Load Chat History → Load KB Folders → Build Optimizer Request → Optimize Query → Parse Optimized Query → Retrieve Docs → Build Prompt`

- `Merge History + RAG` is removed. `Build Prompt` and `Normalize For Agent` already read history
  and docs by node name.
- `Load Chat History` gets `alwaysOutputData: true`. A new user has no history rows, and without it
  the chain would stop there. The empty item it emits is already skipped by the history loops.
- `Load KB Folders` gets `executeOnce: true`. It receives up to 10 history items, and a Postgres
  node runs its query once per input item.
- `Optimize Query` becomes an HTTP call whose body is the ready-made request from
  `Build Optimizer Request`. It keeps `retryOnFail`.

The added latency is one small `SELECT DISTINCT` and the history load moving onto the critical
path, both a few tens of milliseconds.

## Error handling

- `Load KB Folders` returns no rows → the folder list is empty, every scope is invalid and becomes
  `null`, and the bot behaves as today minus the product name in the queries.
- `Load KB Folders` errors (database down) → the execution fails and goes to the error workflow,
  exactly as `Load Chat History` failing does today. Retrieval would fail on the same database
  anyway.
- Optimizer returns malformed JSON → today's fallback (the raw question as both queries),
  `scope: null`.
- The raw-question fallback still contains the product name. That is today's behaviour, accepted
  for a path that only runs when the optimizer fails.

## Testing

- `tests/retrieval-scope.test.js` (unit): scope accepted only when it is a listed, non-shared
  folder; shared folder, unknown name, wrong case and `null` all yield `null`; malformed JSON and
  code fences handled as today; history truncated to 6 turns of 300 characters; the request body
  lists the folders and marks the shared ones; `scopeRule` output for known and unknown scope.
- `tests/agent-workflow.test.js` (wiring): the chain above, in order; `Merge History + RAG` gone;
  `alwaysOutputData` on `Load Chat History`; `executeOnce` on `Load KB Folders`; each Code node's
  embedded block equals the lib's `SHARED` block; the KB tool description no longer asks for
  product names.

## Evaluation

Before merging, run a fixed set of questions through `hybrid-search-tool` in n8n and record the
rank of the chunk that holds the answer, with the current queries and with the new ones.

Questions whose answer is only in a shared folder, each asked once without and once with a product:

1. cum adaug sertar (+ la partner 200)
2. cum inlocuiesc certificatul digital (+ la partner 600)
3. cum activez cartela SIM vodafone (+ pe partner 300)
4. cum fac update de firmware de pe stick (+ la partner 200)
5. cum pun CIF-ul clientului pe bon (+ la partner 600)
6. cum conectez tastatura virtuala de pe telefon (+ la partner 300)

Plus two product-only questions, to check nothing regresses: "ce acumulator are partner 300" and
"procedura de reset partner touch evo".

Pass: every shared-answer question has its answer chunk in the top 15 in both variants, and the
product-only questions still retrieve their product's chunk in the top 5. If shared chunks still
drop out, the next step is two filtered searches (product folder + shared folders), which this design
does not include.

## Out of scope

- Filtering or boosting in `hybrid_search`.
- Changing chunk labels or embedding titles at ingestion.
- Multi-product comparisons ("diferenta dintre P200 si P600"): scope is `null` for them, and the
  fallback agent can still search per product.
- The agent reliability items (retries, reply-before-save), specified separately on the unmerged
  branch `docs/agent-reliability-spec`.
