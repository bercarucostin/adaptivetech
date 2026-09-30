# Scope-aware Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a question that names a product still retrieve shared documentation, by classifying every top-level knowledge-base folder as shared or product in a `kb_folders` table and passing the user's product to the answer model instead of into the search query.

**Architecture:** Ingestion gains a branch that reads Drive folder descriptions and classifies new top-level folders with one Gemini call, writing `kb_folders`. The agent reads folder kinds at runtime, asks the query optimizer for a `scope` (the product folder) plus product-free search queries, validates the scope, and gives it to both answer prompts with a generated folder rule. Retrieval SQL and the hybrid-search tool are unchanged.

**Tech Stack:** n8n workflow JSON (Code, Postgres, HTTP Request, IF nodes), Postgres/Supabase, Node's built-in test runner (`node --test`), Anthropic Messages API (optimizer), Gemini `generateContent` (classifier).

**Spec:** `docs/superpowers/specs/2026-09-30-scope-aware-retrieval-design.md`

## Global Constraints

- Branch: `scope-aware-retrieval`, cut from `partner-prod`. The agent workflow exists only on `partner-prod`.
- No change to `db/hybrid_search.sql`, `workflows/hybrid-search-tool.json`, `lib/chunking.js`, or any stored chunk. No re-ingestion.
- No folder name appears in code. Shared/product comes only from `kb_folders`.
- Pure logic lives in `lib/*.js` between `// ---8<--- SHARED START ---8<---` and `// ---8<--- SHARED END ---8<---`, embedded verbatim into Code nodes; tests assert `code.includes(sharedBlock('lib/<file>.js'))`.
- Code-node glue starts with the line `// ---- n8n glue ----`.
- Workflow JSON is edited only by one-off splice scripts in `.superpowers/splice/` (git-ignored), run from the repo root, then deleted. Never hand-edit the JSON.
- Test command for the whole suite: `node --test tests/` (there is no `package.json`).
- Classifier model: `gemini-3.5-flash-lite`, same URL and credential as `Gemini Text Extraction`.
- Optimizer model: `claude-haiku-4-5` (unchanged), `max_tokens: 300`, `temperature: 0.3`.
- History given to the optimizer: last 6 turns, each truncated to 300 characters.
- Drive override tags: `#shared` / `#product`, case-insensitive, anywhere in the folder description.
- File names per folder sent to the classifier: at most 30.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A brand-new user's first message.** `Load Chat History` returns no rows. Expected: the chain still reaches the optimizer and the bot answers. Pinned by the `alwaysOutputData` wiring test (Task 6) and `historyFromRows` skipping the empty item (Task 5).
2. **An empty or brand-new knowledge base.** `Load KB Folders` returns no rows. Expected: the optimizer request is still valid, every scope is `null`, the bot answers. Pinned by `alwaysOutputData` on `Load KB Folders` (Task 6) and the empty-folders request test (Task 5).
3. **The classifier is down, times out, or answers badly.** Expected: the file sync still runs, the folders are retried next run. Pinned by the `onError` wiring test (Task 4) and `parseClassification` junk tests (Task 3).
4. **A folder name with an apostrophe** (e.g. `Dan's docs`). Expected: its row is written, no SQL error. Pinned by the quoting test (Task 3).
5. **The optimizer returns a shared folder, a paraphrase, or a miscased name as `scope`.** Expected: `scope` is `null` and retrieval proceeds normally. Pinned by the scope-validation tests (Task 5).

---

## File Structure

- `db/kb_folders.sql` (create) — `kb_folders` DDL for fresh installs.
- `db/migrations/2026-09-30-kb-folders.sql` (create) — same table, for the running database.
- `lib/drive-tree.js` (modify) — `buildFolderTree` also returns `topFolders`.
- `lib/folder-kinds.js` (create) — Drive tags, classification planning, classifier parsing, upsert SQL. Ingestion only.
- `lib/retrieval-scope.js` (create) — history shaping, optimizer request, optimizer parsing, answer-prompt scope text. Agent only.
- `workflows/ingestion.json` (modify) — re-embed `Build Folder Tree`; add the six-node classification branch.
- `workflows/agent.json` (modify) — new retrieval chain, new prompts.
- `tests/db-schema.test.js`, `tests/drive-tree.test.js`, `tests/ingestion-workflow.test.js`, `tests/agent-workflow.test.js` (modify); `tests/folder-kinds.test.js`, `tests/retrieval-scope.test.js` (create).

---

### Task 1: The `kb_folders` table

**Files:**
- Create: `db/kb_folders.sql`
- Create: `db/migrations/2026-09-30-kb-folders.sql`
- Test: `tests/db-schema.test.js`

**Interfaces:**
- Produces: table `public.kb_folders (folder text primary key, kind text check in ('shared','product'), decided_by text check in ('drive','llm','manual'), decided_at timestamptz default now())`, read by Tasks 4 and 6.

- [ ] **Step 1: Write the failing test** — append to `tests/db-schema.test.js`:

```js
test('kb_folders is defined with its kind and decided_by checks', () => {
  for (const rel of ['db/kb_folders.sql', 'db/migrations/2026-09-30-kb-folders.sql']) {
    const sql = read(rel);
    assert.ok(sql.includes('create table if not exists public.kb_folders ('), rel + ': table');
    assert.match(sql, /folder\s+text\s+primary key/, rel + ': folder is the key');
    assert.ok(sql.includes("check (kind in ('shared', 'product'))"), rel + ': kind check');
    assert.ok(sql.includes("check (decided_by in ('drive', 'llm', 'manual'))"), rel + ': decided_by check');
    assert.match(sql, /decided_at\s+timestamptz\s+not null\s+default now\(\)/, rel + ': decided_at');
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/db-schema.test.js`
Expected: FAIL with `ENOENT` for `db/kb_folders.sql`.

- [ ] **Step 3: Create `db/kb_folders.sql`**

```sql
-- =====================================================================
-- kb_folders -- whether each top-level knowledge base folder applies to
-- every product ('shared') or to one ('product').
--
-- Written by the ingestion workflow: a '#shared' / '#product' tag in the
-- Drive folder description wins ('drive'); otherwise a new folder is
-- classified once by an LLM ('llm'), and an LLM answer never overwrites a
-- row. 'manual' is for rows edited by hand here; ingestion never writes it.
-- Read by the agent on every message. Files at the root of the knowledge
-- base (no folder) are always shared and get no row.
-- Run after documents.sql.
-- =====================================================================

create table if not exists public.kb_folders (
  folder      text        primary key,
  kind        text        not null check (kind in ('shared', 'product')),
  decided_by  text        not null check (decided_by in ('drive', 'llm', 'manual')),
  decided_at  timestamptz not null default now()
);
```

- [ ] **Step 4: Create `db/migrations/2026-09-30-kb-folders.sql`**

```sql
-- =====================================================================
-- kb_folders: shared / product kind of each top-level knowledge base folder.
--
-- Run once against the production database before importing the updated
-- ingestion and agent workflows. Safe to re-run. The next ingestion run
-- fills the table; until then the agent treats every folder as a product
-- folder.
-- =====================================================================

create table if not exists public.kb_folders (
  folder      text        primary key,
  kind        text        not null check (kind in ('shared', 'product')),
  decided_by  text        not null check (decided_by in ('drive', 'llm', 'manual')),
  decided_at  timestamptz not null default now()
);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/db-schema.test.js`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add db/kb_folders.sql db/migrations/2026-09-30-kb-folders.sql tests/db-schema.test.js
git commit -m "feat(db): kb_folders table for shared vs product folders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `buildFolderTree` returns the top-level folders

**Files:**
- Modify: `lib/drive-tree.js`
- Modify: `workflows/ingestion.json` (node `Build Folder Tree`, via splice script)
- Test: `tests/drive-tree.test.js`, `tests/ingestion-workflow.test.js`

**Interfaces:**
- Produces: `buildFolderTree(listing, rootId)` → `{ query, folders, topFolders }`, where `topFolders: Array<{ id: string, name: string, description: string }>` holds the root's direct child folders sorted by name. The `Build Folder Tree` node outputs `{ query, folders, topFolders }`.

- [ ] **Step 1: Write the failing tests** — append to `tests/drive-tree.test.js`:

```js
test('topFolders lists the root\'s direct children with descriptions, sorted by name', () => {
  const { topFolders } = buildFolderTree([
    { id: 'p600', name: 'PARTNER 600', parents: [ROOT], mimeType: FOLDER_MIME, description: '#product' },
    { id: 'svc', name: 'Service', parents: ['p600'], mimeType: FOLDER_MIME, description: '#shared' },
    { id: 'common', name: 'DOCUMENTATIE COMUNA', parents: [ROOT], mimeType: FOLDER_MIME, description: 'toate #shared' },
    { id: 'p200', name: 'PARTNER 200', parents: [ROOT], mimeType: FOLDER_MIME },
  ], ROOT);
  assert.deepStrictEqual(topFolders, [
    { id: 'common', name: 'DOCUMENTATIE COMUNA', description: 'toate #shared' },
    { id: 'p200', name: 'PARTNER 200', description: '' },
    { id: 'p600', name: 'PARTNER 600', description: '#product' },
  ]);
});

test('topFolders is empty when the root has no folders', () => {
  assert.deepStrictEqual(buildFolderTree([], ROOT).topFolders, []);
});
```

And in `tests/ingestion-workflow.test.js`, extend the existing `Build Folder Tree embeds lib/drive-tree.js and roots at the new folder` test with one more assertion before its closing `});`:

```js
  assert.ok(code.includes('return [{ json: { query, folders, topFolders } }];'),
    'Build Folder Tree must pass topFolders on to the classification branch');
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/drive-tree.test.js tests/ingestion-workflow.test.js`
Expected: FAIL — `topFolders` is `undefined`; the node does not return `topFolders`.

- [ ] **Step 3: Implement in `lib/drive-tree.js`**

Replace the final line of `buildFolderTree`:

```js
  return { query, folders };
```

with:

```js
  // The root's direct children, for the shared/product classification. Their
  // Drive description can carry a #shared / #product tag.
  const topFolders = [];
  const seenTop = new Set();
  for (const f of children.get(rootId) || []) {
    if (seenTop.has(f.id)) continue;
    seenTop.add(f.id);
    topFolders.push({ id: f.id, name: f.name, description: f.description || '' });
  }
  topFolders.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { query, folders, topFolders };
```

Also update the doc comment above `buildFolderTree`, after the `query:` bullet:

```js
//   topFolders: [{ id, name, description }] for the root's direct child
//            folders, sorted by name.
```

- [ ] **Step 4: Re-embed into `Build Folder Tree`** — create `.superpowers/splice/folder-tree.js`:

```js
'use strict';
// One-off: re-embed lib/drive-tree.js into Build Folder Tree and return
// topFolders. Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const wfPath = path.join(root, 'workflows/ingestion.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const node = wf.nodes.find((n) => n.name === 'Build Folder Tree');
if (!node) throw new Error('Build Folder Tree not found');

const START = '// ---8<--- SHARED START ---8<---';
const END = '// ---8<--- SHARED END ---8<---';
const lib = fs.readFileSync(path.join(root, 'lib/drive-tree.js'), 'utf8').replace(/\r\n/g, '\n');
const shared = lib.slice(lib.indexOf(START), lib.indexOf(END));

const GLUE = '\n// ---- n8n glue ----';
let code = node.parameters.jsCode;
const g = code.indexOf(GLUE);
if (code.indexOf(START) !== 0 || g < 0) throw new Error('unexpected Build Folder Tree layout');
code = shared + code.slice(g);

const swaps = [
  ['const { query, folders } = buildFolderTree(listing, KB_ROOT_ID);',
   'const { query, folders, topFolders } = buildFolderTree(listing, KB_ROOT_ID);'],
  ['return [{ json: { query, folders } }];',
   'return [{ json: { query, folders, topFolders } }];'],
];
for (const [from, to] of swaps) {
  if (code.split(from).length !== 2) throw new Error('expected exactly one: ' + from);
  code = code.replace(from, to);
}
node.parameters.jsCode = code;
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('Build Folder Tree re-embedded');
```

Run: `node .superpowers/splice/folder-tree.js`
Expected: prints `Build Folder Tree re-embedded`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/`
Expected: PASS, all tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
rm .superpowers/splice/folder-tree.js
git add lib/drive-tree.js workflows/ingestion.json tests/drive-tree.test.js tests/ingestion-workflow.test.js
git commit -m "feat(lib): folder tree reports the top-level folders and their descriptions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/folder-kinds.js`

**Files:**
- Create: `lib/folder-kinds.js`
- Test: `tests/folder-kinds.test.js`

**Interfaces:**
- Consumes: `topFolders` shape from Task 2: `{ id, name, description }`.
- Produces (exported, and inside the SHARED block):
  - `driveTag(description: string|undefined) → 'shared' | 'product' | null`
  - `planClassification(topFolders, existingRows: Array<{folder, kind, decided_by}>, filesByFolder: {[folder]: string[]}) → { overrides: Array<{folder, kind}>, toClassify: string[], request: object | null }`
  - `parseClassification(rawText: string, toClassify: string[]) → { [folder]: 'shared' | 'product' }`
  - `upsertSql(overrides, classified) → string` (empty string when nothing to write)
  - constants `FOLDER_KINDS`, `MAX_FILES_PER_FOLDER` (30)

- [ ] **Step 1: Write the failing tests** — create `tests/folder-kinds.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  driveTag, planClassification, parseClassification, upsertSql, MAX_FILES_PER_FOLDER,
} = require('../lib/folder-kinds.js');

const top = (name, description = '') => ({ id: 'id-' + name, name, description });

test('driveTag reads #shared and #product in any case, anywhere', () => {
  assert.strictEqual(driveTag('Documentatie comuna #shared'), 'shared');
  assert.strictEqual(driveTag('#PRODUCT'), 'product');
  assert.strictEqual(driveTag('linia 1\n#Shared\nlinia 3'), 'shared');
});

test('driveTag ignores untagged, partial and conflicting descriptions', () => {
  for (const d of ['', undefined, null, 'shared', 'product', '#sharedfolder', '#shared #product']) {
    assert.strictEqual(driveTag(d), null, String(d));
  }
});

test('planClassification asks only about folders with no row and no tag', () => {
  const plan = planClassification(
    [top('A'), top('B', '#shared'), top('C')],
    [{ folder: 'C', kind: 'product', decided_by: 'llm' }],
    { A: ['a.pdf'] },
  );
  assert.deepStrictEqual(plan.toClassify, ['A']);
  assert.deepStrictEqual(plan.overrides, [{ folder: 'B', kind: 'shared' }]);
  assert.ok(plan.request, 'a request is built for A');
});

test('planClassification rewrites a Drive tag only when the stored row differs', () => {
  const tagged = [top('B', '#shared')];
  assert.deepStrictEqual(
    planClassification(tagged, [{ folder: 'B', kind: 'shared', decided_by: 'drive' }], {}).overrides, []);
  assert.deepStrictEqual(
    planClassification(tagged, [{ folder: 'B', kind: 'product', decided_by: 'llm' }], {}).overrides,
    [{ folder: 'B', kind: 'shared' }]);
  assert.deepStrictEqual(
    planClassification(tagged, [{ folder: 'B', kind: 'shared', decided_by: 'manual' }], {}).overrides,
    [{ folder: 'B', kind: 'shared' }]);
});

test('planClassification has no request when nothing is new', () => {
  const plan = planClassification([top('A')], [{ folder: 'A', kind: 'product', decided_by: 'llm' }], {});
  assert.deepStrictEqual(plan, { overrides: [], toClassify: [], request: null });
});

test('the classifier request lists every folder and caps file names per folder', () => {
  const files = Array.from({ length: 40 }, (_, i) => 'file' + i + '.pdf');
  const plan = planClassification([top('A'), top('B'), top('C')],
    [{ folder: 'C', kind: 'shared', decided_by: 'llm' }], { A: files });
  const text = plan.request.contents[0].parts[0].text;
  assert.ok(text.includes('ALL TOP-LEVEL FOLDERS:\n- A\n- B\n- C'), 'all folders listed for context');
  assert.ok(text.includes('## A') && text.includes('## B') && !text.includes('## C'));
  const aSection = text.slice(text.indexOf('## A'), text.indexOf('## B'));
  assert.strictEqual(aSection.split('\n').filter((l) => l.startsWith('- file')).length, MAX_FILES_PER_FOLDER);
  assert.ok(text.includes('## B\n(no files yet)'), 'a folder with no files is still sent');
  assert.strictEqual(plan.request.generationConfig.responseMimeType, 'application/json');
  assert.ok(plan.request.systemInstruction.parts[0].text.includes('"shared"'));
});

test('parseClassification keeps valid kinds for listed folders only', () => {
  const raw = JSON.stringify({ A: 'shared', B: 'Product ', C: 'maybe', Z: 'shared' });
  assert.deepStrictEqual(parseClassification(raw, ['A', 'B', 'C']), { A: 'shared', B: 'product' });
});

test('parseClassification tolerates code fences and returns {} on junk', () => {
  assert.deepStrictEqual(parseClassification('```json\n{"A":"shared"}\n```', ['A']), { A: 'shared' });
  for (const raw of ['', 'not json', '[1]', 'null', undefined]) {
    assert.deepStrictEqual(parseClassification(raw, ['A']), {}, String(raw));
  }
});

test('upsertSql is empty when there is nothing to write', () => {
  assert.strictEqual(upsertSql([], {}), '');
});

test('upsertSql lets a Drive tag overwrite and never lets the LLM overwrite', () => {
  const sql = upsertSql([{ folder: 'B', kind: 'shared' }], { A: 'product' });
  assert.ok(sql.startsWith('INSERT INTO kb_folders (folder, kind, decided_by) VALUES '));
  assert.ok(sql.includes("('B', 'shared', 'drive')"));
  assert.ok(sql.includes("('A', 'product', 'llm')"));
  assert.ok(sql.includes('ON CONFLICT (folder) DO UPDATE SET kind = EXCLUDED.kind, decided_by = EXCLUDED.decided_by, decided_at = now()'));
  assert.ok(sql.endsWith("WHERE EXCLUDED.decided_by = 'drive'"));
});

test('upsertSql quotes folder names', () => {
  assert.ok(upsertSql([], { "Dan's docs": 'shared' }).includes("('Dan''s docs', 'shared', 'llm')"));
});

test('upsertSql writes a folder once, preferring the Drive decision', () => {
  const sql = upsertSql([{ folder: 'A', kind: 'shared' }], { A: 'product' });
  assert.strictEqual(sql.split("'A'").length - 1, 1);
  assert.ok(sql.includes("('A', 'shared', 'drive')"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/folder-kinds.test.js`
Expected: FAIL with `Cannot find module '../lib/folder-kinds.js'`.

- [ ] **Step 3: Create `lib/folder-kinds.js`**

```js
'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Plan Folder Classification" and "Build Folder
// Kinds SQL" Code nodes in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if they drift apart.

const FOLDER_KINDS = ['shared', 'product'];
// File names shown to the classifier per folder: enough to show what the
// folder holds without letting one large folder grow the prompt.
const MAX_FILES_PER_FOLDER = 30;

const CLASSIFIER_SYSTEM = [
  'You classify the top-level folders of a technical-support knowledge base that covers a family of products.',
  'A folder is "product" when its documents apply to one specific product or model, for example a folder named after a model.',
  'A folder is "shared" when its documents apply to every product: common procedures, general documentation, and accessories or software used with all products.',
  'Use the folder name, its file names, and the list of all top-level folders for context.',
  'Return ONLY a JSON object that maps each folder to classify, by its exact name, to "shared" or "product".',
].join('\n');

// '#shared' or '#product' anywhere in a Drive folder description, any case.
// Both tags, or neither, is no decision.
function driveTag(description) {
  const s = String(description || '').toLowerCase();
  const shared = /#shared\b/.test(s);
  const product = /#product\b/.test(s);
  if (shared === product) return null;
  return shared ? 'shared' : 'product';
}

function classifierRequest(allNames, toClassify, filesByFolder) {
  const lines = ['ALL TOP-LEVEL FOLDERS:'];
  for (const name of allNames) lines.push('- ' + name);
  lines.push('', 'FOLDERS TO CLASSIFY, with some of their file names:');
  for (const name of toClassify) {
    lines.push('', '## ' + name);
    const files = (filesByFolder[name] || []).slice(0, MAX_FILES_PER_FOLDER);
    if (!files.length) lines.push('(no files yet)');
    for (const file of files) lines.push('- ' + file);
  }
  return {
    systemInstruction: { parts: [{ text: CLASSIFIER_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: lines.join('\n') }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
}

// What this run must write, and what it must ask the classifier.
//   topFolders:    [{ id, name, description }], the root's direct children
//   existingRows:  [{ folder, kind, decided_by }] from kb_folders
//   filesByFolder: { <folder name>: [file names] }
// Returns { overrides, toClassify, request }:
//   overrides:  [{ folder, kind }], Drive tags that differ from the stored row
//   toClassify: folder names with no tag and no row, sorted
//   request:    the Gemini generateContent body, or null when toClassify is empty
function planClassification(topFolders, existingRows, filesByFolder) {
  const rows = new Map();
  for (const row of existingRows || []) if (row && row.folder) rows.set(row.folder, row);
  const tags = new Map();
  for (const f of topFolders || []) {
    if (!f || !f.name || tags.has(f.name)) continue;
    const tag = driveTag(f.description);
    if (tag) tags.set(f.name, tag);
  }
  const names = [...new Set((topFolders || []).map((f) => f && f.name).filter(Boolean))].sort();

  const overrides = [];
  const toClassify = [];
  for (const name of names) {
    const tag = tags.get(name);
    const row = rows.get(name);
    if (tag) {
      if (!row || row.kind !== tag || row.decided_by !== 'drive') overrides.push({ folder: name, kind: tag });
    } else if (!row) {
      toClassify.push(name);
    }
  }
  const request = toClassify.length ? classifierRequest(names, toClassify, filesByFolder || {}) : null;
  return { overrides, toClassify, request };
}

// The classifier's JSON answer, reduced to listed folders with a valid kind.
// Anything unreadable yields {}: those folders stay unclassified until the
// next run.
function parseClassification(rawText, toClassify) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawText || '')
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, ''));
  } catch (e) {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const name of toClassify || []) {
    const kind = typeof parsed[name] === 'string' ? parsed[name].trim().toLowerCase() : '';
    if (FOLDER_KINDS.includes(kind)) out[name] = kind;
  }
  return out;
}

function sqlString(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// One statement. Drive rows replace whatever is stored; LLM rows only fill
// gaps, so they never overwrite a Drive, manual or earlier LLM decision.
function upsertSql(overrides, classified) {
  const values = [];
  const seen = new Set();
  for (const o of overrides || []) {
    if (seen.has(o.folder)) continue;
    seen.add(o.folder);
    values.push('(' + sqlString(o.folder) + ', ' + sqlString(o.kind) + ", 'drive')");
  }
  for (const [folder, kind] of Object.entries(classified || {})) {
    if (seen.has(folder)) continue;
    seen.add(folder);
    values.push('(' + sqlString(folder) + ', ' + sqlString(kind) + ", 'llm')");
  }
  if (!values.length) return '';
  return 'INSERT INTO kb_folders (folder, kind, decided_by) VALUES ' + values.join(', ') +
    ' ON CONFLICT (folder) DO UPDATE SET kind = EXCLUDED.kind, decided_by = EXCLUDED.decided_by, decided_at = now()' +
    " WHERE EXCLUDED.decided_by = 'drive'";
}
// ---8<--- SHARED END ---8<---

module.exports = {
  driveTag, planClassification, parseClassification, upsertSql, FOLDER_KINDS, MAX_FILES_PER_FOLDER,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/folder-kinds.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/folder-kinds.js tests/folder-kinds.test.js
git commit -m "feat(lib): plan, parse and store shared/product folder classifications

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ingestion classification branch

**Files:**
- Modify: `workflows/ingestion.json` (via splice script)
- Test: `tests/ingestion-workflow.test.js`

**Interfaces:**
- Consumes: `Build Folder Tree` output `{ query, folders, topFolders }` (Task 2); `planClassification`, `parseClassification`, `upsertSql` (Task 3); table `kb_folders` (Task 1).
- Produces: nodes `Load Folder Kinds` → `Plan Folder Classification` → `Needs Classification?` → (true) `Classify Folders` → `Build Folder Kinds SQL` / (false) `Build Folder Kinds SQL` → `Save Folder Kinds`, branching off `Build Drive Manifest`.

- [ ] **Step 1: Write the failing tests** — append to `tests/ingestion-workflow.test.js`:

```js
test('the folder classification branch hangs off Build Drive Manifest, in order', () => {
  const fromManifest = targets('Build Drive Manifest')[0];
  assert.ok(fromManifest.includes('Sync Check'), 'the file sync is still connected');
  assert.ok(fromManifest.includes('Load Folder Kinds'));
  assert.deepStrictEqual(targets('Load Folder Kinds'), [['Plan Folder Classification']]);
  assert.deepStrictEqual(targets('Plan Folder Classification'), [['Needs Classification?']]);
  assert.deepStrictEqual(targets('Needs Classification?'), [['Classify Folders'], ['Build Folder Kinds SQL']]);
  assert.deepStrictEqual(targets('Classify Folders'), [['Build Folder Kinds SQL']]);
  assert.deepStrictEqual(targets('Build Folder Kinds SQL'), [['Save Folder Kinds']]);
});

test('the classification branch runs before the file sync', () => {
  // n8n v1 runs sibling branches top to bottom on the canvas. Check Failures
  // throws when any file failed, so classification must come first or a
  // single bad file would stop new folders from ever being classified.
  assert.strictEqual(wf.settings.executionOrder, 'v1');
  assert.ok(byName('Load Folder Kinds').position[1] < byName('Sync Check').position[1]);
});

test('Load Folder Kinds survives an empty table and runs once', () => {
  const node = byName('Load Folder Kinds');
  assert.strictEqual(node.parameters.operation, 'executeQuery');
  assert.match(node.parameters.query, /SELECT folder, kind, decided_by FROM kb_folders/);
  assert.strictEqual(node.alwaysOutputData, true, 'an empty kb_folders must not stop the branch');
  assert.strictEqual(node.executeOnce, true);
  assert.deepStrictEqual(node.credentials, byName('Sync Check').credentials);
});

test('a failed classifier call cannot stop the sync', () => {
  const node = byName('Classify Folders');
  assert.strictEqual(node.onError, 'continueRegularOutput');
  assert.strictEqual(node.retryOnFail, true);
  assert.strictEqual(node.parameters.url, byName('Gemini Text Extraction').parameters.url);
  assert.strictEqual(node.parameters.jsonBody, '={{ JSON.stringify($json.request) }}');
  assert.deepStrictEqual(node.credentials, byName('Gemini Text Extraction').credentials);
});

test('Needs Classification? only calls the classifier when there is a request', () => {
  const cond = byName('Needs Classification?').parameters.conditions.conditions[0];
  assert.strictEqual(cond.leftValue, '={{ !!$json.request }}');
  assert.deepStrictEqual(cond.operator, { type: 'boolean', operation: 'true', singleValue: true });
});

test('Save Folder Kinds runs the built statement once', () => {
  const node = byName('Save Folder Kinds');
  assert.strictEqual(node.parameters.query, byName('Sync Check').parameters.query);
  assert.strictEqual(node.executeOnce, true);
  assert.deepStrictEqual(node.credentials, byName('Sync Check').credentials);
});

test('both classification Code nodes embed lib/folder-kinds.js', () => {
  const plan = byName('Plan Folder Classification').parameters.jsCode;
  const sql = byName('Build Folder Kinds SQL').parameters.jsCode;
  for (const code of [plan, sql]) {
    assert.ok(code.includes(sharedBlock('lib/folder-kinds.js')), 'Code node has drifted from lib/folder-kinds.js');
  }
  assert.ok(plan.includes('planClassification(tree.topFolders || [], existing, filesByFolder)'));
  assert.ok(sql.includes('parseClassification(raw, plan.toClassify)'));
  assert.ok(sql.includes('upsertSql(plan.overrides, classified)'));
  assert.ok(sql.includes('return sql ? [{ json: { query: sql } }] : [];'),
    'nothing to write must end the branch, not run an empty query');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/ingestion-workflow.test.js`
Expected: FAIL — `Load Folder Kinds` and the other new nodes do not exist.

- [ ] **Step 3: Write the splice script** — create `.superpowers/splice/ingestion-folder-kinds.js`:

```js
'use strict';
// One-off: add the folder classification branch to workflows/ingestion.json.
// Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const wfPath = path.join(root, 'workflows/ingestion.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (name) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('node not found: ' + name);
  return node;
};
const START = '// ---8<--- SHARED START ---8<---';
const END = '// ---8<--- SHARED END ---8<---';
function shared(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  return src.slice(src.indexOf(START), src.indexOf(END));
}

const NEW = ['Load Folder Kinds', 'Plan Folder Classification', 'Needs Classification?',
  'Classify Folders', 'Build Folder Kinds SQL', 'Save Folder Kinds'];
for (const name of NEW) {
  if (wf.nodes.some((n) => n.name === name)) throw new Error('already spliced: ' + name);
}

const syncCheck = byName('Sync Check');
const gemini = byName('Gemini Text Extraction');
const block = shared('lib/folder-kinds.js');

const planGlue = [
  '',
  '// ---- n8n glue ----',
  '// Runs before the file sync (it sits above Sync Check on the canvas). Nothing',
  '// here throws on bad data: a folder that cannot be classified now is left for',
  '// the next run, and the sync must not stop because of it.',
  "const tree = $('Build Folder Tree').first().json || {};",
  'const folders = tree.folders || {};',
  "const existing = $('Load Folder Kinds').all().map((item) => item.json).filter((row) => row && row.folder);",
  'const filesByFolder = {};',
  "for (const item of $('Drive: Knowledge Base').all()) {",
  '  const file = item.json || {};',
  '  const parent = (file.parents || []).find((p) => folders[p]);',
  '  if (!parent || !file.name) continue;',
  '  const label = folders[parent].label;',
  '  (filesByFolder[label] = filesByFolder[label] || []).push(file.name);',
  '}',
  'const plan = planClassification(tree.topFolders || [], existing, filesByFolder);',
  "for (const o of plan.overrides) console.log('folder \"' + o.folder + '\" set to ' + o.kind + ' by drive');",
  "if (plan.toClassify.length) console.log('classifying new folder(s): ' + plan.toClassify.join(', '));",
  'return [{ json: plan }];',
  '',
].join('\n');

const sqlGlue = [
  '',
  '// ---- n8n glue ----',
  '// Input is the classifier response (true branch) or the plan itself (false',
  '// branch, nothing to classify). A failed classifier call arrives here as an',
  '// item with an error field and yields no classifications.',
  "const plan = $('Plan Folder Classification').first().json;",
  'const input = $input.first().json || {};',
  "const raw = (input.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');",
  'const classified = plan.request ? parseClassification(raw, plan.toClassify) : {};',
  'for (const [folder, kind] of Object.entries(classified)) {',
  "  console.log('folder \"' + folder + '\" classified as ' + kind + ' by llm');",
  '}',
  'const missing = plan.toClassify.filter((f) => !classified[f]);',
  "if (missing.length) console.log('left unclassified, retried on the next run: ' + missing.join(', '));",
  'const sql = upsertSql(plan.overrides, classified);',
  'return sql ? [{ json: { query: sql } }] : [];',
  '',
].join('\n');

const Y = -1600;
wf.nodes.push(
  {
    parameters: { operation: 'executeQuery', query: 'SELECT folder, kind, decided_by FROM kb_folders', options: {} },
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [4496, Y],
    id: 'd4f0a000-0000-4000-8000-000000000001', name: 'Load Folder Kinds',
    alwaysOutputData: true, executeOnce: true, credentials: syncCheck.credentials,
  },
  {
    parameters: { jsCode: block + planGlue },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [4720, Y],
    id: 'd4f0a000-0000-4000-8000-000000000002', name: 'Plan Folder Classification',
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        combinator: 'and',
        conditions: [{
          id: 'd4f0a000-0000-4000-8000-000000000003-c1',
          leftValue: '={{ !!$json.request }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
      },
      options: {},
    },
    type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [4944, Y],
    id: 'd4f0a000-0000-4000-8000-000000000003', name: 'Needs Classification?',
  },
  {
    parameters: {
      method: 'POST', url: gemini.parameters.url,
      authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.request) }}',
      options: { timeout: 60000 },
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [5168, Y - 96],
    id: 'd4f0a000-0000-4000-8000-000000000004', name: 'Classify Folders',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput',
    credentials: gemini.credentials,
  },
  {
    parameters: { jsCode: block + sqlGlue },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [5392, Y],
    id: 'd4f0a000-0000-4000-8000-000000000005', name: 'Build Folder Kinds SQL',
  },
  {
    parameters: { operation: 'executeQuery', query: syncCheck.parameters.query, options: {} },
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [5616, Y],
    id: 'd4f0a000-0000-4000-8000-000000000006', name: 'Save Folder Kinds',
    executeOnce: true, credentials: syncCheck.credentials,
  },
);

const link = (node) => ({ node, type: 'main', index: 0 });
wf.connections['Build Drive Manifest'].main[0].push(link('Load Folder Kinds'));
wf.connections['Load Folder Kinds'] = { main: [[link('Plan Folder Classification')]] };
wf.connections['Plan Folder Classification'] = { main: [[link('Needs Classification?')]] };
wf.connections['Needs Classification?'] = { main: [[link('Classify Folders')], [link('Build Folder Kinds SQL')]] };
wf.connections['Classify Folders'] = { main: [[link('Build Folder Kinds SQL')]] };
wf.connections['Build Folder Kinds SQL'] = { main: [[link('Save Folder Kinds')]] };

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('ingestion.json: folder classification branch added');
```

- [ ] **Step 4: Run the splice**

Run: `node .superpowers/splice/ingestion-folder-kinds.js`
Expected: prints `ingestion.json: folder classification branch added`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/`
Expected: PASS, all tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
rm .superpowers/splice/ingestion-folder-kinds.js
git add workflows/ingestion.json tests/ingestion-workflow.test.js
git commit -m "feat(ingestion): classify new top-level folders as shared or product

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `lib/retrieval-scope.js`

**Files:**
- Create: `lib/retrieval-scope.js`
- Test: `tests/retrieval-scope.test.js`

**Interfaces:**
- Consumes: folder rows as the agent's `Load KB Folders` returns them: `Array<{ folder: string, kind: 'shared' | 'product' }>`; `n8n_chat_histories` rows `{ message: object | string }`, newest first.
- Produces (exported, and inside the SHARED block):
  - `historyFromRows(rows) → Array<{ role: 'user' | 'assistant', content: string }>` oldest first
  - `buildOptimizerRequest(question: string, history, folders) → object` (Anthropic Messages body)
  - `parseOptimizedQuery(rawText: string, question: string, folders) → { query: string, lexical: string, scope: string | null }`
  - `scopePrompt(scope: string | null, folders) → { productLine: string, rule: string }`
  - constants `OPTIMIZER_MODEL`, `HISTORY_TURNS` (6), `HISTORY_CHARS` (300)

- [ ] **Step 1: Write the failing tests** — create `tests/retrieval-scope.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  historyFromRows, buildOptimizerRequest, parseOptimizedQuery, scopePrompt,
  OPTIMIZER_MODEL, HISTORY_CHARS,
} = require('../lib/retrieval-scope.js');

const FOLDERS = [
  { folder: 'DOCUMENTATIE COMUNA', kind: 'shared' },
  { folder: 'PARTNER 200', kind: 'product' },
  { folder: 'PARTNER 600', kind: 'product' },
  { folder: 'TASTATURI VIRTUALE', kind: 'shared' },
];
const Q = 'cum adaug sertar la partner200';
const raw = (obj) => JSON.stringify(obj);

test('historyFromRows turns newest-first rows into oldest-first turns', () => {
  const rows = [
    { message: { type: 'ai', content: 'a2' } },
    { message: JSON.stringify({ type: 'human', content: 'q2' }) },
    { message: { type: 'ai', content: 'a1' } },
    { message: { type: 'human', content: 'q1' } },
  ];
  assert.deepStrictEqual(historyFromRows(rows), [
    { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' },
  ]);
});

test('historyFromRows skips the empty item a new user gets, and unusable rows', () => {
  const rows = [{}, { message: 'not json' }, { message: { type: 'system', content: 'x' } },
    { message: { type: 'human', content: '' } }];
  assert.deepStrictEqual(historyFromRows(rows), []);
  assert.deepStrictEqual(historyFromRows(undefined), []);
});

test('the optimizer request lists folders by kind, then the question', () => {
  const req = buildOptimizerRequest(Q, [], FOLDERS);
  assert.strictEqual(req.model, OPTIMIZER_MODEL);
  assert.strictEqual(req.max_tokens, 300);
  assert.strictEqual(req.temperature, 0.3);
  const content = req.messages[0].content;
  assert.ok(content.includes('PRODUCT FOLDERS: ["PARTNER 200","PARTNER 600"]'));
  assert.ok(content.includes('SHARED FOLDERS: ["DOCUMENTATIE COMUNA","TASTATURI VIRTUALE"]'));
  assert.ok(content.includes('RECENT CONVERSATION:\n(none)'));
  assert.ok(content.endsWith('QUESTION:\n' + Q));
  assert.ok(req.system.includes('"scope"') && req.system.includes('"semantic"') && req.system.includes('"lexical"'));
});

test('the optimizer sees at most 6 turns of 300 characters each', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user', content: 't' + i + ' ' + 'x'.repeat(400),
  }));
  const content = buildOptimizerRequest(Q, history, FOLDERS).messages[0].content;
  assert.ok(!content.includes('t0 ') && !content.includes('t1 '), 'the two oldest turns are dropped');
  for (let i = 2; i < 8; i++) assert.ok(content.includes('t' + i + ' '), 'turn ' + i + ' kept');
  for (const line of content.split('\n').filter((l) => /^(User|Assistant): /.test(l))) {
    assert.ok(line.length <= 'Assistant: '.length + HISTORY_CHARS, 'turn truncated');
  }
});

test('an empty folder list still makes a valid request', () => {
  const content = buildOptimizerRequest(Q, [], []).messages[0].content;
  assert.ok(content.includes('PRODUCT FOLDERS: []') && content.includes('SHARED FOLDERS: []'));
});

test('parse keeps a scope that is a listed product folder', () => {
  const out = parseOptimizedQuery(raw({ semantic: 'adaugare sertar', lexical: 'sertar adaugare', scope: 'PARTNER 200' }), Q, FOLDERS);
  assert.deepStrictEqual(out, { query: 'adaugare sertar', lexical: 'sertar adaugare', scope: 'PARTNER 200' });
});

test('parse drops a scope that is shared, unknown, miscased or not a string', () => {
  for (const scope of ['DOCUMENTATIE COMUNA', 'PARTNER 300', 'partner 200', 'Partner 200 ', 7, null, undefined]) {
    const out = parseOptimizedQuery(raw({ semantic: 's', lexical: 'l', scope }), Q, FOLDERS);
    assert.strictEqual(out.scope, null, String(scope));
  }
});

test('parse drops every scope when the folder list is empty', () => {
  assert.strictEqual(parseOptimizedQuery(raw({ semantic: 's', scope: 'PARTNER 200' }), Q, []).scope, null);
});

test('parse falls back to the question on malformed JSON', () => {
  for (const text of ['not json', '', undefined]) {
    assert.deepStrictEqual(parseOptimizedQuery(text, Q, FOLDERS), { query: Q, lexical: Q, scope: null });
  }
});

test('parse strips code fences and falls back from lexical to semantic', () => {
  const out = parseOptimizedQuery('```json\n' + raw({ semantic: 'adaugare sertar' }) + '\n```', Q, FOLDERS);
  assert.deepStrictEqual(out, { query: 'adaugare sertar', lexical: 'adaugare sertar', scope: null });
});

test('scopePrompt names the product and the shared folders', () => {
  const { productLine, rule } = scopePrompt('PARTNER 200', FOLDERS);
  assert.strictEqual(productLine, "USER'S PRODUCT: PARTNER 200");
  assert.ok(rule.includes('Documents from [DOCUMENTATIE COMUNA], [TASTATURI VIRTUALE], and documents with no folder label, apply to every product.'));
  assert.ok(rule.includes("say explicitly that it comes from the documentation for that other product"));
  assert.ok(rule.includes('ask which product the user has'));
});

test('scopePrompt without a scope says the product is not stated', () => {
  assert.strictEqual(scopePrompt(null, FOLDERS).productLine, "USER'S PRODUCT: not stated");
});

test('scopePrompt with no shared folders only mentions unlabelled documents', () => {
  const { rule } = scopePrompt(null, [{ folder: 'PARTNER 200', kind: 'product' }]);
  assert.ok(rule.includes('Documents with no folder label apply to every product.'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/retrieval-scope.test.js`
Expected: FAIL with `Cannot find module '../lib/retrieval-scope.js'`.

- [ ] **Step 3: Create `lib/retrieval-scope.js`**

```js
'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Optimizer Request", "Parse Optimized Query",
// "Build Prompt" and "Normalize For Agent" Code nodes in workflows/agent.json.
// tests/agent-workflow.test.js fails if they drift apart.

const OPTIMIZER_MODEL = 'claude-haiku-4-5';
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 300;

const OPTIMIZER_SYSTEM = [
  'You are a search query optimizer for a technical support knowledge base.',
  'The knowledge base is organised in folders. Each PRODUCT FOLDER holds documentation for one product; SHARED FOLDERS hold documentation that applies to every product.',
  '',
  'Given the QUESTION, and the RECENT CONVERSATION for context, return a JSON object with three fields:',
  '- "scope": the product folder the user is asking about, copied exactly from PRODUCT FOLDERS, or null when no product is named or implied in the question or the recent conversation. Never a shared folder.',
  '- "semantic": a natural-language sentence that captures the intent (optimized for embedding similarity search).',
  '- "lexical": a concise keyword query with exact technical terms, error codes, menu names and action words (optimized for full-text search).',
  '',
  'Leave product and model names out of "semantic" and "lexical": "scope" carries them. Keep every other exact term.',
  'When the question is a follow-up ("and how do I reset it?"), use the conversation to make the queries self-contained.',
  'Return ONLY valid JSON. No markdown, no explanation. "semantic" and "lexical" must be in the same language as the QUESTION.',
].join('\n');

// n8n_chat_histories rows, newest first as Load Chat History returns them, to
// [{ role, content }] oldest first. Rows that are not a human or ai message --
// including the empty item alwaysOutputData emits for a new user -- are skipped.
function historyFromRows(rows) {
  const out = [];
  for (const row of [...(rows || [])].reverse()) {
    let msg = row && row.message;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch (e) { continue; }
    }
    if (!msg || typeof msg.content !== 'string' || !msg.content) continue;
    if (msg.type === 'human') out.push({ role: 'user', content: msg.content });
    else if (msg.type === 'ai') out.push({ role: 'assistant', content: msg.content });
  }
  return out;
}

function foldersOfKind(folders, kind) {
  return (folders || []).filter((f) => f && f.folder && f.kind === kind).map((f) => f.folder);
}

// The Anthropic Messages body for Optimize Query.
function buildOptimizerRequest(question, history, folders) {
  const recent = (history || []).slice(-HISTORY_TURNS).map((m) =>
    (m.role === 'user' ? 'User: ' : 'Assistant: ') + String(m.content).slice(0, HISTORY_CHARS));
  const content = [
    'PRODUCT FOLDERS: ' + JSON.stringify(foldersOfKind(folders, 'product')),
    'SHARED FOLDERS: ' + JSON.stringify(foldersOfKind(folders, 'shared')),
    '',
    'RECENT CONVERSATION:',
    recent.length ? recent.join('\n') : '(none)',
    '',
    'QUESTION:',
    String(question || ''),
  ].join('\n');
  return {
    model: OPTIMIZER_MODEL,
    max_tokens: 300,
    temperature: 0.3,
    system: OPTIMIZER_SYSTEM,
    messages: [{ role: 'user', content }],
  };
}

// The optimizer's answer as { query, lexical, scope } for Retrieve Docs.
// scope survives only if it is exactly a listed product folder; retrieval never
// fails because of it.
function parseOptimizedQuery(rawText, question, folders) {
  let semantic = '';
  let lexical = '';
  let scope = null;
  try {
    const parsed = JSON.parse(String(rawText || '')
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, ''));
    if (parsed && typeof parsed === 'object') {
      semantic = typeof parsed.semantic === 'string' ? parsed.semantic : '';
      lexical = typeof parsed.lexical === 'string' ? parsed.lexical : '';
      scope = parsed.scope;
    }
  } catch (e) { /* fall back to the question below */ }
  const products = foldersOfKind(folders, 'product');
  const fallback = String(question || '');
  return {
    query: semantic || fallback,
    lexical: lexical || semantic || fallback,
    scope: typeof scope === 'string' && products.includes(scope) ? scope : null,
  };
}

// The product line and the folder rule both answer prompts use.
function scopePrompt(scope, folders) {
  const shared = foldersOfKind(folders, 'shared').map((f) => '[' + f + ']');
  const sharedSentence = shared.length
    ? 'Documents from ' + shared.join(', ') + ', and documents with no folder label, apply to every product.'
    : 'Documents with no folder label apply to every product.';
  const rule = [
    'Each document begins with the folder it came from in square brackets, e.g. [FOLDER NAME].',
    sharedSentence,
    'A document from any other folder applies only to the product that folder is named after.',
    "When USER'S PRODUCT is known, answer from that product's documents and the shared documents.",
    "If only another product's document covers the question, you may use it, but say explicitly that it comes from the documentation for that other product and that the steps may differ.",
    "When USER'S PRODUCT is not stated and the documentation gives different answers for different products, ask which product the user has. When it gives the same answer for every product, answer directly.",
  ].join(' ');
  return { productLine: "USER'S PRODUCT: " + (scope || 'not stated'), rule };
}
// ---8<--- SHARED END ---8<---

module.exports = {
  historyFromRows, buildOptimizerRequest, parseOptimizedQuery, scopePrompt,
  OPTIMIZER_MODEL, HISTORY_TURNS, HISTORY_CHARS,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/retrieval-scope.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/retrieval-scope.js tests/retrieval-scope.test.js
git commit -m "feat(lib): optimizer request, scope validation and folder rule for retrieval

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Agent retrieval chain

**Files:**
- Modify: `workflows/agent.json` (via splice script)
- Test: `tests/agent-workflow.test.js`

**Interfaces:**
- Consumes: `historyFromRows`, `buildOptimizerRequest`, `parseOptimizedQuery` (Task 5); table `kb_folders` (Task 1).
- Produces: node `Load KB Folders` (rows `{ folder, kind }`), node `Build Optimizer Request` (`{ request }`), `Parse Optimized Query` output `{ query, lexical, scope }`, read by Task 7.

- [ ] **Step 1: Write the failing tests** — append to `tests/agent-workflow.test.js`:

```js
test('the retrieval chain runs history, folders, optimizer, search, prompt in order', () => {
  assert.deepStrictEqual(targets('Unified Input'), [['Load Chat History']]);
  assert.deepStrictEqual(targets('Load Chat History'), [['Load KB Folders']]);
  assert.deepStrictEqual(targets('Load KB Folders'), [['Build Optimizer Request']]);
  assert.deepStrictEqual(targets('Build Optimizer Request'), [['Optimize Query']]);
  assert.deepStrictEqual(targets('Optimize Query'), [['Parse Optimized Query']]);
  assert.deepStrictEqual(targets('Parse Optimized Query'), [['Retrieve Docs']]);
  assert.deepStrictEqual(targets('Retrieve Docs'), [['Build Prompt']]);
});

test('Merge History + RAG is gone without a trace', () => {
  assert.strictEqual(byName('Merge History + RAG'), undefined);
  assert.ok(!JSON.stringify(wf).includes('Merge History + RAG'));
});

test('a new user with no history or an empty knowledge base still reaches the optimizer', () => {
  assert.strictEqual(byName('Load Chat History').alwaysOutputData, true);
  assert.strictEqual(byName('Load KB Folders').alwaysOutputData, true);
});

test('Load KB Folders runs once and reads kinds from kb_folders', () => {
  const node = byName('Load KB Folders');
  assert.strictEqual(node.executeOnce, true, 'it receives one item per history row');
  const q = node.parameters.query;
  assert.ok(q.includes('left join kb_folders k using (folder)'));
  assert.ok(q.includes("coalesce(k.kind, 'product') as kind"));
  assert.ok(q.includes("metadata->>'source' = 'knowledge_base'"));
  assert.deepStrictEqual(node.credentials, byName('Load Chat History').credentials);
});

test('the optimizer sends the request built from lib/retrieval-scope.js', () => {
  const build = byName('Build Optimizer Request').parameters.jsCode;
  assert.ok(build.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(build.includes('buildOptimizerRequest(question, history, folders)'));
  const oq = byName('Optimize Query');
  assert.strictEqual(oq.parameters.jsonBody, '={{ JSON.stringify($json.request) }}');
  assert.strictEqual(oq.retryOnFail, true);
});

test('Parse Optimized Query validates the scope with lib/retrieval-scope.js', () => {
  const code = byName('Parse Optimized Query').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(code.includes('parseOptimizedQuery(raw, question, folders)'));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/agent-workflow.test.js`
Expected: FAIL — `Unified Input` still targets `Optimize Query`; `Load KB Folders` does not exist.

- [ ] **Step 3: Write the splice script** — create `.superpowers/splice/agent-retrieval-chain.js`:

```js
'use strict';
// One-off: the sequential retrieval chain in workflows/agent.json.
// Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const wfPath = path.join(root, 'workflows/agent.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (name) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('node not found: ' + name);
  return node;
};
const START = '// ---8<--- SHARED START ---8<---';
const END = '// ---8<--- SHARED END ---8<---';
function shared(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  return src.slice(src.indexOf(START), src.indexOf(END));
}
const block = shared('lib/retrieval-scope.js');
const link = (node) => ({ node, type: 'main', index: 0 });

// 1. Remove Merge History + RAG.
byName('Merge History + RAG');
wf.nodes = wf.nodes.filter((n) => n.name !== 'Merge History + RAG');
delete wf.connections['Merge History + RAG'];

// 2. History first, and it must survive a new user with no rows.
const history = byName('Load Chat History');
history.alwaysOutputData = true;
history.position = [448, 432];

// 3. Load KB Folders and Build Optimizer Request.
const FOLDERS_SQL = [
  'select d.folder, coalesce(k.kind, \'product\') as kind',
  'from (select distinct metadata->>\'folder\' as folder',
  '      from documents',
  '      where metadata->>\'source\' = \'knowledge_base\'',
  '        and coalesce(metadata->>\'folder\', \'\') <> \'\') d',
  'left join kb_folders k using (folder)',
  'order by 1',
].join('\n');

const buildGlue = [
  '',
  '// ---- n8n glue ----',
  "const question = $('Unified Input').first().json.question || '';",
  "const history = historyFromRows($('Load Chat History').all().map((item) => item.json));",
  "const folders = $('Load KB Folders').all().map((item) => item.json).filter((f) => f && f.folder);",
  'return [{ json: { request: buildOptimizerRequest(question, history, folders) } }];',
  '',
].join('\n');

wf.nodes.push(
  {
    parameters: { operation: 'executeQuery', query: FOLDERS_SQL, options: {} },
    type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [672, 432],
    id: 'e5a0b000-0000-4000-8000-000000000001', name: 'Load KB Folders',
    alwaysOutputData: true, executeOnce: true, credentials: history.credentials,
  },
  {
    parameters: { jsCode: block + buildGlue },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [896, 432],
    id: 'e5a0b000-0000-4000-8000-000000000002', name: 'Build Optimizer Request',
  },
);

// 4. Optimize Query sends the prepared body.
byName('Optimize Query').parameters.jsonBody = '={{ JSON.stringify($json.request) }}';

// 5. Parse Optimized Query validates the scope.
byName('Parse Optimized Query').parameters.jsCode = block + [
  '',
  '// ---- n8n glue ----',
  '// { query, lexical, scope } for Retrieve Docs; Build Prompt and Normalize For',
  '// Agent read scope from here.',
  "const raw = $json.content?.[0]?.text || '';",
  "const question = $('Unified Input').first().json.question || '';",
  "const folders = $('Load KB Folders').all().map((item) => item.json).filter((f) => f && f.folder);",
  'return [{ json: parseOptimizedQuery(raw, question, folders) }];',
  '',
].join('\n');

// 6. Wiring.
wf.connections['Unified Input'] = { main: [[link('Load Chat History')]] };
wf.connections['Load Chat History'] = { main: [[link('Load KB Folders')]] };
wf.connections['Load KB Folders'] = { main: [[link('Build Optimizer Request')]] };
wf.connections['Build Optimizer Request'] = { main: [[link('Optimize Query')]] };
wf.connections['Retrieve Docs'] = { main: [[link('Build Prompt')]] };

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('agent.json: sequential retrieval chain');
```

- [ ] **Step 4: Run the splice**

Run: `node .superpowers/splice/agent-retrieval-chain.js`
Expected: prints `agent.json: sequential retrieval chain`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/`
Expected: PASS, all tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
rm .superpowers/splice/agent-retrieval-chain.js
git add workflows/agent.json tests/agent-workflow.test.js
git commit -m "feat(agent): the optimizer sees history and folders and returns a scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Answer prompts use the scope

**Files:**
- Modify: `workflows/agent.json` (via splice script)
- Test: `tests/agent-workflow.test.js`

**Interfaces:**
- Consumes: `scopePrompt` (Task 5); `Parse Optimized Query` output `.scope` and `Load KB Folders` rows (Task 6).
- Produces: `Build Prompt` user message prefixed with the product line and rule 3 replaced by the folder rule; `Normalize For Agent` output gains `productLine` and `folderRule`; `AI Agent1` text and system message use them; the KB tool no longer asks for product names.

- [ ] **Step 1: Write the failing tests** — append to `tests/agent-workflow.test.js`:

```js
test('Build Prompt gives the answer model the product and the generated folder rule', () => {
  const code = byName('Build Prompt').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(code.includes('const scope = scopePrompt(optimized.scope, kbFolders);'));
  assert.ok(code.includes("content: scope.productLine + '\\n\\nRELEVANT DOCUMENTATION:\\n' + chunks"));
  assert.ok(code.includes("'3. ' + scope.rule,"));
  assert.ok(!code.includes('never apply it to another machine'), 'the old hard-coded folder rule is gone');
  assert.ok(!code.includes('DOCUMENTATIE COMUNA'), 'no folder name in the prompt code');
});

test('the fallback agent gets the same product line and folder rule', () => {
  const norm = byName('Normalize For Agent').parameters.jsCode;
  assert.ok(norm.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(norm.includes('productLine: scope.productLine,'));
  assert.ok(norm.includes('folderRule: scope.rule'));
  const agent = byName('AI Agent1').parameters;
  assert.ok(agent.text.includes('$json.productLine'));
  assert.ok(agent.text.includes("'\\n\\nFOLDER RULE:\\n' + $json.folderRule"));
  assert.ok(agent.options.systemMessage.includes('4. Follow the FOLDER RULE given with the question'));
  assert.ok(!agent.options.systemMessage.includes('DOCUMENTATIE COMUNA'));
});

test('the knowledge base tool no longer asks for product names', () => {
  const p = byName('Knowledge Base (Hybrid Search)').parameters;
  assert.ok(!/include product name/i.test(p.description));
  assert.ok(!/once PER product/i.test(p.description));
  assert.ok(p.workflowInputs.value.query.includes('Leave out product and model names'));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/agent-workflow.test.js`
Expected: FAIL — `Build Prompt` has no `scopePrompt` call.

- [ ] **Step 3: Write the splice script** — create `.superpowers/splice/agent-prompts.js`:

```js
'use strict';
// One-off: product line and generated folder rule in both answer prompts.
// Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const wfPath = path.join(root, 'workflows/agent.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (name) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('node not found: ' + name);
  return node;
};
const START = '// ---8<--- SHARED START ---8<---';
const END = '// ---8<--- SHARED END ---8<---';
function shared(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  return src.slice(src.indexOf(START), src.indexOf(END));
}
const block = shared('lib/retrieval-scope.js');
function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(label + ': expected 1 match, found ' + count);
  return text.replace(from, to);
}
const SCOPE_LINES = [
  "const optimized = $('Parse Optimized Query').first().json || {};",
  "const kbFolders = $('Load KB Folders').all().map((item) => item.json).filter((f) => f && f.folder);",
  'const scope = scopePrompt(optimized.scope, kbFolders);',
].join('\n');

// 1. Build Prompt. Its code is JavaScript source: a line break inside a
// string literal is the two characters \n, written '\\n' here.
const bp = byName('Build Prompt');
let code = bp.parameters.jsCode;
code = replaceOnce(code,
  "const unified = $('Unified Input').first().json;",
  "const unified = $('Unified Input').first().json;\n" + SCOPE_LINES,
  'Build Prompt scope');
code = replaceOnce(code,
  "content: 'RELEVANT DOCUMENTATION:\\n' + chunks",
  "content: scope.productLine + '\\n\\nRELEVANT DOCUMENTATION:\\n' + chunks",
  'Build Prompt product line');
const rule3 = code.match(/^  '3\. When the documentation contains product-specific info[^\n]*\n/m);
if (!rule3) throw new Error('Build Prompt rule 3 not found');
code = code.replace(rule3[0], "  '3. ' + scope.rule,\n");
bp.parameters.jsCode = block + '\n// ---- n8n glue ----\n' + code;

// 2. Normalize For Agent.
const norm = byName('Normalize For Agent');
let nc = norm.parameters.jsCode;
nc = replaceOnce(nc,
  "const ragContext = $('Retrieve Docs').first().json.response || 'No relevant documentation found.';",
  "const ragContext = $('Retrieve Docs').first().json.response || 'No relevant documentation found.';\n\n" + SCOPE_LINES,
  'Normalize scope');
nc = replaceOnce(nc,
  "      from: unified.from || ''\n    }",
  "      from: unified.from || '',\n      productLine: scope.productLine,\n      folderRule: scope.rule\n    }",
  'Normalize output');
norm.parameters.jsCode = block + '\n// ---- n8n glue ----\n' + nc;

// 3. AI Agent1: the text expression and rule 4 of its system message.
const agent = byName('AI Agent1').parameters;
agent.text = replaceOnce(agent.text,
  ".trim()\n}}",
  ".trim() +\n'\\n\\n' + $json.productLine +\n'\\n\\nFOLDER RULE:\\n' + $json.folderRule\n}}",
  'AI Agent1 text');
const rule4 = agent.options.systemMessage.match(/4\. When the documentation contains product-specific info[^\n]*/);
if (!rule4) throw new Error('AI Agent1 rule 4 not found');
agent.options.systemMessage = agent.options.systemMessage.replace(rule4[0],
  "4. Follow the FOLDER RULE given with the question: it says which documents apply to which product, and USER'S PRODUCT says which product the user has.");

// 4. The knowledge base tool: searches cover every product.
const tool = byName('Knowledge Base (Hybrid Search)').parameters;
tool.description = "Technical documentation search (debugging guides, error codes, configuration, troubleshooting, setup, known issues). Call this whenever the pre-retrieved docs do not fully cover the user's question. Results cover every product; each document begins with its folder in square brackets.";
tool.workflowInputs.value.query = "={{ $fromAI('query', 'The technical search query: describe the task and include any exact error codes or menu names. Leave out product and model names.', 'string') }}";

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('agent.json: prompts use the scope');
```

- [ ] **Step 4: Run the splice**

Run: `node .superpowers/splice/agent-prompts.js`
Expected: prints `agent.json: prompts use the scope`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/`
Expected: PASS, all tests, 0 failures.

- [ ] **Step 6: Syntax-check the edited Code nodes**

Run:
```bash
node -e "
const wf=require('./workflows/agent.json');
for (const n of ['Build Optimizer Request','Parse Optimized Query','Build Prompt','Normalize For Agent']) {
  const code = wf.nodes.find((x) => x.name === n).parameters.jsCode;
  new Function('\$', '\$json', '\$input', '\$node', code);
  console.log('ok', n);
}"
```
Expected: `ok` for all four names (a `SyntaxError` means a splice broke the code).

- [ ] **Step 7: Commit**

```bash
rm .superpowers/splice/agent-prompts.js
git add workflows/agent.json tests/agent-workflow.test.js
git commit -m "feat(agent): answer prompts get the user's product and a generated folder rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Hand-off: deploy and evaluate (done by the human partner, not the executor)

1. Run `db/migrations/2026-09-30-kb-folders.sql` against the production database.
2. Import `workflows/ingestion.json` and `workflows/agent.json` into n8n.
3. Run ingestion once manually. In the execution, `Build Folder Kinds SQL` logs each classification; then check `select * from kb_folders order by folder;` shows the 7 folders as 5 `product` and 2 `shared` (`DOCUMENTATIE COMUNA`, `TASTATURI VIRTUALE`). Fix any wrong one with a `#shared` / `#product` tag in its Drive description and re-run.
4. Run the question set from the spec's Evaluation section and record the results against its pass criteria.
