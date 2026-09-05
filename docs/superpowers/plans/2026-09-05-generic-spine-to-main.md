# Generic RAG Spine to `main` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `main` the generic WhatsApp RAG spine that currently exists only on `partner-prod`, then branch `website` from it.

**Architecture:** `main` is currently a README and nothing else. This plan copies the client-agnostic files across, surgically removes the Robotel-specific technicians-sync sub-graph from `ingestion.json`, replaces the technicians-only ingestion test with one that pins the generic chains, rewrites the stale README, and cuts the `website` branch. `agent.json` and everything sigiliu-related deliberately stay on `partner-prod`.

**Tech Stack:** git, Node 20 (`node --test`, no package.json — the repo has no dependencies), n8n workflow JSON, PostgreSQL/pgvector.

**Spec:** [docs/superpowers/specs/2026-09-05-website-rag-demo-design.md](../specs/2026-09-05-website-rag-demo-design.md) — see the "Branch layout" section.

## Global Constraints

- **No package.json, no dependencies.** Tests are `node:test` + `node:assert`, run with `node --test tests/`. Do not add a package manager.
- **CommonJS only** in `lib/` — `'use strict';` at the top, `module.exports` at the bottom. Match `lib/sigiliu.js`.
- **Never commit to `main` directly.** Work happens on `chore/generic-spine`; merging to `main` is the user's call.
- **These files must NOT reach `main`:** `workflows/agent.json`, `workflows/conversations-report.json`, `lib/sigiliu.js`, `lib/sync-batch.js`, `tests/sigiliu.test.js`, `tests/sync-batch.test.js`, `tests/agent-workflow.test.js`, `db/technicians.sql`, `db/validated_numbers.sql`, `db/wa_message_links.sql`, `db/wa_reaction_links.sql`, `Tabel tehnicieni pentru Robotel.ods`.
- **Workflow JSON carries instance-specific IDs.** `credentials.*.id`, `settings.errorWorkflow`, and node `id` values point at the Robotel n8n instance. They travel as-is; whoever imports the workflow re-points credentials in the n8n UI. Do not attempt to blank them — the structural tests assert on some of them.

---

### Task 1: Branch from `main` and copy the spine files across

**Files:**
- Create (via `git checkout partner-prod --`): `db/documents.sql`, `db/hybrid_search.sql`, `db/match_documents.sql`, `db/n8n_chat_histories.sql`, `db/cleanup_n8n_chat_histories_after_insert.sql`, `workflows/ingestion.json`, `workflows/hybrid-search-tool.json`, `workflows/db-cleanup.json`, `workflows/error-handling-agent.json`, `workflows/error-handling-ingestion.json`, `.claude/settings.json`, `.vscode/settings.json`

**Interfaces:**
- Consumes: nothing
- Produces: a `chore/generic-spine` branch whose tree is `main` plus the spine files. Task 2 edits `workflows/ingestion.json` on this branch.

**Note on `error-handling-agent.json`:** it arrives ahead of the `agent.json` it serves, which is deliberate — the spec defers agent generalisation, and shipping the error handler now means the pair lands together later rather than the handler being forgotten.

- [ ] **Step 1: Confirm you are starting from a clean tree on the right base**

```bash
git status --porcelain
git switch main
git log --oneline -1
```

Expected: `git status --porcelain` prints nothing. `git log` shows `33f72e9 Create README.md with project overview and setup instructions.` — `main` holds that one commit and nothing else, and it is in sync with `origin/main`, so no pull is needed.

(Do not expect `571b4fa`. That commit is the tip of `origin/prod`, an unrelated line, and it is not an ancestor of `main`.)

If the working tree is dirty, stop and ask the user — do not stash.

- [ ] **Step 2: Create the working branch**

```bash
git switch -c chore/generic-spine
```

Expected: `Switched to a new branch 'chore/generic-spine'`

- [ ] **Step 3: Copy the SQL spine across**

```bash
git checkout partner-prod -- \
  db/documents.sql \
  db/hybrid_search.sql \
  db/match_documents.sql \
  db/n8n_chat_histories.sql \
  db/cleanup_n8n_chat_histories_after_insert.sql
```

Expected: no output. `git status --short` now lists five staged `A` entries under `db/`.

- [ ] **Step 4: Copy the workflow spine and editor settings across**

```bash
git checkout partner-prod -- \
  workflows/ingestion.json \
  workflows/hybrid-search-tool.json \
  workflows/db-cleanup.json \
  workflows/error-handling-agent.json \
  workflows/error-handling-ingestion.json \
  .claude/settings.json \
  .vscode/settings.json
```

Expected: no output.

- [ ] **Step 5: Verify nothing forbidden came across**

```bash
git status --short
ls workflows/ db/ 2>/dev/null
test -e "Tabel tehnicieni pentru Robotel.ods" && echo "FORBIDDEN FILE PRESENT" || echo "ods absent - good"
test -e lib && echo "FORBIDDEN lib/ PRESENT" || echo "lib absent - good"
test -e tests && echo "tests/ present" || echo "tests absent - expected, Task 2 creates it"
```

Expected: `workflows/` holds exactly the five JSON files listed above; `db/` holds exactly the five SQL files; the `.ods` is absent; `lib/` is absent; `tests/` is absent.

If any forbidden file is present, remove it with `git rm --cached <path> && rm <path>` before continuing.

- [ ] **Step 6: Commit**

```bash
git add db workflows .claude .vscode
git commit -m "chore: promote the generic RAG spine to main

Copies the client-agnostic SQL and workflows from partner-prod. The
technicians sync inside ingestion.json is removed in the next commit."
```

---

### Task 2: Strip the technicians sync from `ingestion.json` and pin the generic chains

**Files:**
- Modify: `workflows/ingestion.json` (remove 5 nodes and 5 connection entries)
- Create: `tests/ingestion-workflow.test.js`

**Interfaces:**
- Consumes: `workflows/ingestion.json` from Task 1
- Produces: an `ingestion.json` on `main` containing exactly two ingestion chains — knowledge base and expert feedback — with no Robotel-specific nodes. Task 3 documents it.

**Context.** The technicians sub-graph is `Drive: Technicians → Get Technicians Sheet → Count Mirror → Build Sync Batch → Sync Technicians`. It is fully isolated: no other node connects into it and it connects into no other node, so removal is surgical. The `partner-prod` version of `tests/ingestion-workflow.test.js` tests *only* this sub-graph and the validated-numbers chain it replaced, so it does not travel — it is replaced by a test covering the chains that remain.

- [ ] **Step 1: Write the failing test**

Create `tests/ingestion-workflow.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/ingestion.json'), 'utf8'));
const byName = (name) => wf.nodes.find((n) => n.name === name);
const targets = (name) => ((wf.connections[name] || {}).main || [])
  .map((out) => (out || []).map((c) => c.node));

const TECHNICIANS_NODES = [
  'Drive: Technicians',
  'Get Technicians Sheet',
  'Count Mirror',
  'Build Sync Batch',
  'Sync Technicians',
];

test('the Robotel technicians sync is absent from the generic ingestion', () => {
  for (const gone of TECHNICIANS_NODES) {
    assert.strictEqual(byName(gone), undefined, `${gone} should not exist on main`);
    assert.strictEqual(wf.connections[gone], undefined, `${gone} should have no connections`);
  }
});

test('no node references the technicians sync by name', () => {
  const json = JSON.stringify(wf);
  for (const gone of TECHNICIANS_NODES) {
    assert.ok(!json.includes(gone), `dangling reference to ${gone}`);
  }
});

test('nothing client-specific survives in the workflow body', () => {
  const json = JSON.stringify(wf).toLowerCase();
  for (const term of ['sigiliu', 'technician', 'tehnicien', 'robotel']) {
    assert.ok(!json.includes(term), `client-specific term "${term}" still present`);
  }
});

test('the knowledge-base chain is wired end to end', () => {
  assert.deepStrictEqual(targets('Sync Trigger'), [['Drive: Knowledge Base']]);
  assert.deepStrictEqual(targets('Drive: Knowledge Base'), [['Build Drive Manifest']]);
  assert.deepStrictEqual(targets('Build Drive Manifest'), [['Sync Check']]);
  assert.deepStrictEqual(targets('Sync Check'), [['Process One File']]);
  assert.deepStrictEqual(targets('Process One File'), [[], ['Download Knowledge Base File']]);
  assert.deepStrictEqual(targets('Download Knowledge Base File'), [['Prepare Gemini Request']]);
  assert.deepStrictEqual(targets('Prepare Gemini Request'), [['Gemini Text Extraction']]);
  assert.deepStrictEqual(targets('Gemini Text Extraction'), [['Format Gemini Result']]);
  assert.deepStrictEqual(targets('Format Gemini Result'), [['Preparing Chunks']]);
  assert.deepStrictEqual(targets('Preparing Chunks'), [['Generate Embeddings']]);
  assert.deepStrictEqual(targets('Generate Embeddings'), [['Format for Insert']]);
  assert.deepStrictEqual(targets('Format for Insert'), [['Insert Into Postgres Knowledge Base']]);
  assert.deepStrictEqual(targets('Insert Into Postgres Knowledge Base'), [['Process One File']]);
});

test('the expert-feedback chain is wired end to end', () => {
  assert.deepStrictEqual(targets('Drive: Expert Feedback'), [['Process One File1']]);
  assert.deepStrictEqual(targets('Process One File1'), [[], ['Download File1']]);
  assert.deepStrictEqual(targets('Download File1'), [['Prepare Gemini Request1']]);
  assert.deepStrictEqual(targets('Prepare Gemini Request1'), [['Gemini Text Extraction1']]);
  assert.deepStrictEqual(targets('Gemini Text Extraction1'), [['Format Gemini Result1']]);
  assert.deepStrictEqual(targets('Format Gemini Result1'), [['Preparing Chunks1']]);
  assert.deepStrictEqual(targets('Preparing Chunks1'), [['Generate Embeddings1']]);
  assert.deepStrictEqual(targets('Generate Embeddings1'), [['Format for Insert1']]);
  assert.deepStrictEqual(targets('Format for Insert1'), [['Insert into Postgres Expert Feedback']]);
  assert.deepStrictEqual(targets('Insert into Postgres Expert Feedback'), [['Process One File1']]);
});

test('the two branches write to the documents table under distinct sources', () => {
  const kb = byName('Format for Insert');
  const ef = byName('Format for Insert1');
  assert.ok(kb.parameters.jsCode.includes("source: 'knowledge_base'"));
  assert.ok(ef.parameters.jsCode.includes("source: 'expert_feedback'"));
});

test('embeddings are requested at 1536 dimensions on both branches', () => {
  for (const name of ['Generate Embeddings', 'Generate Embeddings1']) {
    const node = byName(name);
    assert.match(node.parameters.url, /batchEmbedContents/,
      `${name} should call the batch embedding endpoint`);
  }
  for (const name of ['Preparing Chunks', 'Preparing Chunks1']) {
    assert.match(byName(name).parameters.jsCode, /outputDimensionality["']?\s*:\s*1536/,
      `${name} should request 1536 dimensions`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/
```

Expected: FAIL. The first two tests fail with `Drive: Technicians should not exist on main`, and the third fails on `technician`. The chain tests pass already — they describe nodes Task 1 brought across unchanged.

If `embeddings are requested at 1536 dimensions` also fails, read the actual `Preparing Chunks` code and adjust the regex to match what is really there — do not change the workflow to satisfy the test.

- [ ] **Step 3: Remove the technicians sub-graph**

```bash
node -e '
const fs = require("fs");
const p = "workflows/ingestion.json";
const wf = JSON.parse(fs.readFileSync(p, "utf8"));
const gone = new Set([
  "Drive: Technicians",
  "Get Technicians Sheet",
  "Count Mirror",
  "Build Sync Batch",
  "Sync Technicians",
]);

const before = wf.nodes.length;
wf.nodes = wf.nodes.filter((n) => !gone.has(n.name));
for (const name of gone) delete wf.connections[name];

// Defensive: drop any edge pointing at a removed node, in case the graph
// is less isolated than inspection suggested.
for (const [src, conn] of Object.entries(wf.connections)) {
  if (!conn.main) continue;
  conn.main = conn.main.map((out) => (out || []).filter((c) => !gone.has(c.node)));
}

fs.writeFileSync(p, JSON.stringify(wf, null, 2) + "\n");
console.log("removed " + (before - wf.nodes.length) + " nodes, " + wf.nodes.length + " remain");
'
```

Expected: `removed 5 nodes, 23 remain`

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/
```

Expected: PASS, 7 tests, 0 failures.

- [ ] **Step 5: Verify the JSON is still importable by n8n**

```bash
node -e '
const wf = require("./workflows/ingestion.json");
const names = new Set(wf.nodes.map((n) => n.name));
let dangling = 0;
for (const [src, conn] of Object.entries(wf.connections)) {
  if (!names.has(src)) { console.log("connection from missing node: " + src); dangling++; }
  for (const out of conn.main || []) for (const c of out || []) {
    if (!names.has(c.node)) { console.log("edge to missing node: " + c.node); dangling++; }
  }
}
console.log(dangling === 0 ? "graph is consistent" : dangling + " dangling references");
'
```

Expected: `graph is consistent`

- [ ] **Step 6: Commit**

```bash
git add workflows/ingestion.json tests/ingestion-workflow.test.js
git commit -m "chore: remove the technicians sync from the generic ingestion

The Drive: Technicians -> Sync Technicians sub-graph is Robotel-specific
and stays on partner-prod. Replaces the technicians-only ingestion test
with one that pins the knowledge-base and expert-feedback chains."
```

---

### Task 3: Rewrite `README.md` to describe what `main` now holds

**Files:**
- Modify: `README.md` (full replacement — the existing 260 lines describe a different, older implementation)

**Interfaces:**
- Consumes: the tree produced by Tasks 1 and 2
- Produces: nothing other tasks depend on

**Context.** `main`'s README documents an implementation that no longer exists: GPT-4o vision, the Supabase Vector Store node, a `Build Prompt (Python)` step. The spine that just landed uses Gemini for extraction and embeddings, Anthropic for answers, and a hand-rolled `hybrid_search()`. Leaving it would make `main` actively misleading to the next person who reads it — including whoever forks it for a second client.

- [ ] **Step 1: Replace the README**

Write `README.md`:

````markdown
# WhatsApp RAG Support Bot — n8n

The general implementation of an n8n-backed WhatsApp support bot with hybrid
retrieval over a document knowledge base. Per-client customisation lives on its
own branch; this branch holds only what is client-agnostic.

## Branches

| Branch | Contents |
|---|---|
| `main` | This generic spine: schema, retrieval, ingestion, error handling |
| `partner-prod` | The Robotel deployment — agent workflow, sigiliu validation, technician sync |
| `website` | adaptivetech.ro and its public RAG demo |

`main` does not yet contain an agent workflow. Generalising `agent.json` needs a
second client to generalise against, so it stays on `partner-prod` for now;
`workflows/error-handling-agent.json` is here ahead of it deliberately, so the
pair lands together when that work happens.

## What's here

### Database (`db/`)

| File | Purpose |
|---|---|
| `documents.sql` | Chunk store — 1536-dim pgvector embeddings, generated Romanian `tsvector`, HNSW + GIN + btree indexes |
| `hybrid_search.sql` | pgvector ANN fused with Postgres FTS via reciprocal rank fusion |
| `match_documents.sql` | Pure-semantic search, kept for LangChain-node compatibility |
| `n8n_chat_histories.sql` | Per-user conversation memory |
| `cleanup_n8n_chat_histories_after_insert.sql` | Trigger capping history length per session |

Apply `documents.sql` before `hybrid_search.sql` — the function depends on the
table's `vector(1536)` typmod and on the `romanian` FTS configuration.

### Workflows (`workflows/`)

| File | Purpose |
|---|---|
| `ingestion.json` | Google Drive → Gemini extraction → section-aware chunking → batch embedding → Postgres. Two branches: knowledge base and expert feedback |
| `hybrid-search-tool.json` | Sub-workflow: embeds a query and calls `hybrid_search()`, returning labelled chunks |
| `db-cleanup.json` | Weekly pruning of old conversations and execution logs |
| `error-handling-ingestion.json` | Error workflow for ingestion — builds a report, emails the team |
| `error-handling-agent.json` | Error workflow for an agent workflow — also replies to the original sender |

Workflow JSON carries n8n instance-specific IDs (`credentials.*.id`,
`settings.errorWorkflow`, node `id`s). Re-point credentials in the n8n UI after
importing; the files are templates, not portable deployments.

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
2. Apply the files in `db/` in the order given above.
3. Import the workflows in `workflows/` into n8n.
4. Create credentials in n8n for: Postgres, Google Drive, Google Gemini
   (HTTP query auth), Anthropic, and SMTP. Re-point each node's credential.
5. Set each workflow's error workflow to the matching `error-handling-*`.
6. Point `Drive: Knowledge Base` and `Drive: Expert Feedback` at your folders.

## License

See the repository owner.
````

- [ ] **Step 2: Verify the README makes no claim the tree contradicts**

```bash
ls db/ workflows/
grep -c "" README.md
```

Expected: `db/` and `workflows/` contain exactly the files the README's two tables list — five each, no more.

- [ ] **Step 3: Run the full suite once more**

```bash
node --test tests/
```

Expected: PASS, 7 tests, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite the README for the generic spine

The previous README described an older implementation - GPT-4o vision,
the Supabase Vector Store node, a Python prompt builder - none of which
is what this branch contains."
```

---

### Task 4: Merge to `main` and cut the `website` branch

**Files:** none — this task is branch topology only.

**Interfaces:**
- Consumes: the completed `chore/generic-spine` branch
- Produces: a `website` branch that Plan B (`2026-09-05-website-rag-demo.md`) builds on

- [ ] **Step 1: Show the user what is about to land on `main`**

```bash
git switch chore/generic-spine
git log --oneline main..chore/generic-spine
git diff --stat main chore/generic-spine
```

Expected: three commits; the diffstat lists only `db/` (5 files), `workflows/` (5 files), `tests/ingestion-workflow.test.js`, `README.md`, `.claude/settings.json`, `.vscode/settings.json`.

**Stop here and get the user's confirmation before merging.** Merging to `main` is their call, not yours.

- [ ] **Step 2: Merge to `main`**

```bash
git switch main
git merge --no-ff chore/generic-spine -m "chore: promote the generic RAG spine to main"
git log --oneline -1
```

Expected: a merge commit on `main`.

- [ ] **Step 3: Verify `main` is clean and green**

```bash
node --test tests/
test -e "Tabel tehnicieni pentru Robotel.ods" && echo "FAIL: ods on main" || echo "ok: no ods"
test -e workflows/agent.json && echo "FAIL: agent.json on main" || echo "ok: no agent.json"
test -e lib && echo "FAIL: lib on main" || echo "ok: no lib"
```

Expected: 7 tests pass; all three checks print `ok:`.

- [ ] **Step 4: Cut the `website` branch**

```bash
git switch -c website main
git log --oneline -1
git branch -vv
```

Expected: `website` exists at the same commit as `main`.

- [ ] **Step 5: Push both branches**

```bash
git push -u origin main
git push -u origin website
```

Expected: both branches tracked on `origin`. If the user has not asked for a push, skip this step and tell them the branches are ready locally.

- [ ] **Step 6: Hand off**

Tell the user:

> `main` now holds the generic spine and `website` is branched from it. Add the adaptivetech.ro HTML and CSS to the `website` branch — Plan B's frontend task styles the demo page to match them, and is blocked until they exist.

---

## Notes for the executor

**If Task 2's removal script reports a different node count**, stop. `23 remain` is derived from the current `partner-prod` `ingestion.json` having 28 nodes. A different number means the source workflow changed since this plan was written; re-inspect the graph before proceeding.

**Do not "fix" credential IDs.** They look like leftovers and are not — `tests/ingestion-workflow.test.js` on `partner-prod` asserts that two nodes share a credential ID, and the same style of assertion is likely to be wanted here later. They are re-pointed at import time, in the n8n UI.

**The `.ods` stays in `partner-prod`'s history.** This is a recorded, accepted risk in the spec, conditional on the repository staying private. If it ever goes public, the history must be rewritten first.
