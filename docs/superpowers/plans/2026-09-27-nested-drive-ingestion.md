# Nested-Folder Knowledge-Base Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the knowledge base from a Drive folder tree, where every chunk is labelled with the subfolder (machine) it came from, and chunking keeps procedures whole and readable.

**Architecture:**
- **Listing:** the ingestion sync lists every folder once, builds the tree in code, and lists files with one Drive query covering the root and every descendant folder.
- **Chunks:** the folder rides with each file through extraction, into a new line-preserving chunker, and onto every chunk. It becomes a `[FOLDER]` prefix in the stored text, and `folder`/`folder_path` in metadata.
- **Failures:** a failing file is skipped and reported through the existing error workflow, instead of aborting the batch.
- **Structure:** logic lives in three unit-tested `lib/` modules, pasted into n8n Code nodes verbatim. One-off splice scripts edit the workflow JSON.

**Tech Stack:** n8n 2.28.3 (workflow JSON), PostgreSQL + pgvector, Node 20 `node:test`, Google Drive API v3 via n8n's Google Drive node v3.

**Spec:** [docs/superpowers/specs/2026-09-27-nested-drive-ingestion-design.md](../specs/2026-09-27-nested-drive-ingestion-design.md)

## Global Constraints

- **Knowledge base root ID:** `1g7SDhQdmKB-MVs5R21gZypwpKLPzee0q`. The old flat folder `1-y3bvqtTXEj2Vyl-lC5Em6aISbtqCcbm` must not appear in `ingestion.json` afterwards.
- **Folder label:** the name of the root's direct child a file sits under. `folder_path` is the `/`-joined path from that child down. A file directly in the root gets `''` for both.
- **Supported MIME types, exactly:** `application/pdf`, `application/vnd.google-apps.document`, `application/vnd.google-apps.presentation`, `application/vnd.google-apps.spreadsheet`. Everything else is skipped and logged.
- **Chunking constants:** `WORD_LIMIT = 350`, `OVERLAP_WORDS = 75`, `WHOLE_DOC_WORDS = 800`, `MIN_SECTION_WORDS = 60`, `EMBED_BATCH_SIZE = 100`.
- **Stored chunk text:** `[<folder>] <title> — <heading>\n\n<chunk>`, or `<title> — <heading>\n\n<chunk>` when there is no folder. The dash is U+2014.
- **Embedding title:** `<folder> — <title> — <heading>`, or `<title> — <heading>`.
- **`MAX_FOLDERS = 150`.** More descendant folders than that throws.
- **Insert batching:** `Insert Into Postgres Knowledge Base` keeps the default `queryBatching` (`single`). Never set it to `transaction`: see the spec's "Atomic per-file replace".
- **Failure routing:**
  - These seven nodes get `onError: 'continueErrorOutput'`: `Download Knowledge Base File`, `Prepare Gemini Request`, `Gemini Text Extraction`, `Format Gemini Result`, `Preparing Chunks`, `Format for Insert`, `Insert Into Postgres Knowledge Base`.
  - `Generate Embeddings` gets `onError: 'continueRegularOutput'`.
- **Code-node drift:** every `lib/` module has `// ---8<--- SHARED START ---8<---` and `// ---8<--- SHARED END ---8<---` markers. The block between them is pasted into its Code node verbatim, with `\n` line endings.
- **File formats:**
  - `workflows/ingestion.json` is written as `JSON.stringify(wf, null, 2)` with **no** trailing newline;
  - `workflows/agent.json` is written **with** a trailing `\n`;
  - this keeps the diffs to the lines that actually change.
- **Tooling:** there is no package.json and no build step. Tests run with `node --test tests/` from the repo root, and library files are CommonJS.
- **Splice scripts** are written at the repo root, run once from the repo root, and deleted. They are never committed.

## Review Focus

These are inputs the spec implies but doesn't spell out. Each is pinned by a test in the task named.

1. **Google Doc names containing dots.** "Instructiuni update firmware P200-300-600 19.01.2026" must keep its full title, where the old `/\.[^.]+$/` cut it to "… 19.01". Pinned by `titleFromFileName strips only real extensions` in Task 4.
2. **A table Gemini flattened into one enormous line.** It must become overlapping word windows, none over `WORD_LIMIT`, with the tail kept. Pinned by `one enormous line is cut into overlapping word windows` in Task 4.
3. **A file with several parents, or directly in the root.** It gets the first in-tree parent's label or `''`, and never crashes. Pinned by `a file with several parents uses the first one inside the tree` and `a file directly in the root gets empty folder and path` in Task 3.
4. **A document that chunks to nothing.** It must throw into the error path rather than end the branch, which would silently skip the rest of the batch. Pinned by `blank text yields no chunks` in Task 4 and `Preparing Chunks embeds lib/chunking.js and never ends the loop silently` in Task 6.
5. **The failure email must name the file that failed**, and handle both error shapes: Code nodes put a string in `error`, the Postgres node an object. Pinned by `Note Failure names the file from the loop, for string and object error shapes` in Task 7. The real identity lookup is confirmed with a forced failure in Task 10.

---

## File Structure

| File | Responsibility |
|---|---|
| `tests/helpers/shared-block.js` | `sharedBlock(relPath)`: returns a lib's SHARED block with CRLF normalised (new) |
| `lib/drive-tree.js` | `buildFolderTree(listing, rootId)`: folder listing → `{ query, folders }` (new) |
| `lib/drive-manifest.js` | `buildManifest(files, folders)`, `buildSyncQuery(manifest)`: manifest rows and the sync SQL (new; replaces inline code) |
| `lib/chunking.js` | `chunkDocument(text, title, folder)`, `titleFromFileName(name)`: line-preserving chunker (new; replaces inline code) |
| `tests/drive-tree.test.js`, `tests/drive-manifest.test.js`, `tests/chunking.test.js` | Unit tests for the three modules (new) |
| `tests/db-schema.test.js` | Asserts the dedupe index key in schema and migration (new) |
| `tests/ingestion-workflow.test.js` | Structural and drift assertions for `ingestion.json` (extended) |
| `tests/agent-workflow.test.js` | Structural and drift assertions for `agent.json` (extended) |
| `workflows/ingestion.json` | Knowledge-base branch: listing, pass-through, chunking, failure routing (modified) |
| `workflows/agent.json` | Folder rule in `Build Prompt` and `AI Agent1` (modified) |
| `db/documents.sql` | Dedupe index keyed on `file_id` (modified) |
| `db/migrations/2026-09-27-documents-uniq-by-file-id.sql` | One-off index swap for the live database (new) |

---

### Task 1: Line-ending-safe drift checks

Two tests fail on a clean checkout today: `Extract Sigiliu embeds lib/sigiliu.js verbatim` and `Build Sync Batch embeds lib/sync-batch.js verbatim`. The code isn't actually different. `core.autocrlf=true` checks `lib/*.js` out with CRLF, while the Code nodes store `\n`. Every later task adds more checks of this kind, so fix the comparison first.

**Files:**
- Create: `tests/helpers/shared-block.js`
- Modify: `tests/ingestion-workflow.test.js` (the `Build Sync Batch embeds lib/sync-batch.js verbatim` test)
- Modify: `tests/agent-workflow.test.js` (the `Extract Sigiliu embeds lib/sigiliu.js verbatim` test)

**Interfaces:**
- Produces: `sharedBlock(relPath: string): string`. It returns the text from the SHARED START marker up to, but not including, the SHARED END marker, with `\r\n` turned into `\n`. It throws if either marker is missing. Tasks 5–7 use it.

- [ ] **Step 1: Confirm the two failures**

Run: `node --test tests/`
Expected: `# fail 2`. The failures are `Extract Sigiliu embeds lib/sigiliu.js verbatim` and `Build Sync Batch embeds lib/sync-batch.js verbatim`, both "Code node has drifted".

- [ ] **Step 2: Create the helper**

`tests/helpers/shared-block.js`. Node's test runner does not treat this path as a test file.

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Returns the SHARED START..END block of a lib/ file, line endings normalised
// to \n. With core.autocrlf=true, git checks lib/*.js out with CRLF, while the
// Code nodes in the workflow JSON always store \n -- comparing raw text fails
// on a byte-identical copy.
function sharedBlock(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  if (start === -1 || end <= start) throw new Error('SHARED markers missing in ' + relPath);
  return src.slice(start, end);
}

module.exports = { sharedBlock };
```

- [ ] **Step 3: Use it in `tests/ingestion-workflow.test.js`**

Add this line directly below `const path = require('node:path');`:

```js
const { sharedBlock } = require('./helpers/shared-block.js');
```

Replace the whole `Build Sync Batch embeds lib/sync-batch.js verbatim` test with:

```js
test('Build Sync Batch embeds lib/sync-batch.js verbatim', () => {
  assert.ok(byName('Build Sync Batch').parameters.jsCode.includes(sharedBlock('lib/sync-batch.js')),
    'Code node has drifted from lib/sync-batch.js');
});
```

- [ ] **Step 4: Use it in `tests/agent-workflow.test.js`**

Add the same `require` line directly below `const path = require('node:path');`. Then replace the whole `Extract Sigiliu embeds lib/sigiliu.js verbatim` test with:

```js
test('Extract Sigiliu embeds lib/sigiliu.js verbatim', () => {
  assert.ok(byName('Extract Sigiliu').parameters.jsCode.includes(sharedBlock('lib/sigiliu.js')),
    'Code node has drifted from lib/sigiliu.js');
});
```

- [ ] **Step 5: Run the suite**

Run: `node --test tests/`
Expected: `# pass 48`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/shared-block.js tests/ingestion-workflow.test.js tests/agent-workflow.test.js
git commit -m "test: normalise line endings when comparing lib code to Code nodes"
```

---

### Task 2: `lib/drive-tree.js`, folder tree and Drive query

**Files:**
- Create: `lib/drive-tree.js`
- Test: `tests/drive-tree.test.js`

**Interfaces:**
- Produces: `buildFolderTree(listing: Array<{id, name, parents?, mimeType?}>, rootId: string): { query: string, folders: { [folderId]: { label: string, path: string } } }`, plus the exported `MAX_FOLDERS` (150) and `FOLDER_MIME`.
- The SHARED block declares `FOLDER_MIME`, `MAX_FOLDERS` and `buildFolderTree`. Task 5 pastes it into `Build Folder Tree`.

- [ ] **Step 1: Write the failing tests**

`tests/drive-tree.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildFolderTree, MAX_FOLDERS, FOLDER_MIME } = require('../lib/drive-tree.js');

const ROOT = 'root0';
const folder = (id, name, parent) => ({ id, name, parents: [parent], mimeType: FOLDER_MIME });

test('direct children of the root are their own label and path', () => {
  const { folders } = buildFolderTree([
    folder('p200', 'PARTNER 200', ROOT),
    folder('common', 'DOCUMENTATIE COMUNA', ROOT),
  ], ROOT);
  assert.deepStrictEqual(folders, {
    p200: { label: 'PARTNER 200', path: 'PARTNER 200' },
    common: { label: 'DOCUMENTATIE COMUNA', path: 'DOCUMENTATIE COMUNA' },
  });
});

test('deeper folders keep the top-level label and get the full path', () => {
  const { folders } = buildFolderTree([
    folder('svc', 'Service', 'p600'),        // listed before its parent on purpose
    folder('p600', 'PARTNER 600', ROOT),
    folder('old', 'Vechi', 'svc'),
  ], ROOT);
  assert.deepStrictEqual(folders.svc, { label: 'PARTNER 600', path: 'PARTNER 600/Service' });
  assert.deepStrictEqual(folders.old, { label: 'PARTNER 600', path: 'PARTNER 600/Service/Vechi' });
});

test('folders outside the root are ignored', () => {
  const { folders } = buildFolderTree([
    folder('p200', 'PARTNER 200', ROOT),
    folder('elsewhere', 'Personal', 'someOtherRoot'),
    folder('nested', 'Deep', 'elsewhere'),
  ], ROOT);
  assert.deepStrictEqual(Object.keys(folders), ['p200']);
});

test('a parent cycle terminates', () => {
  const { folders } = buildFolderTree([
    folder('a', 'A', ROOT),
    folder('b', 'B', 'a'),
    { id: 'a', name: 'A', parents: ['b'], mimeType: FOLDER_MIME }, // a is also listed under b
  ], ROOT);
  assert.deepStrictEqual(folders, {
    a: { label: 'A', path: 'A' },
    b: { label: 'A', path: 'A/B' },
  });
});

test('the empty item from alwaysOutputData and non-folders are ignored', () => {
  const { folders, query } = buildFolderTree([
    {},
    { id: 'f1', name: 'doc', parents: [ROOT], mimeType: 'application/pdf' },
  ], ROOT);
  assert.deepStrictEqual(folders, {});
  assert.strictEqual(query,
    "('root0' in parents) and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
});

test('the query lists the root and every descendant folder', () => {
  const { query } = buildFolderTree([
    folder('p200', 'PARTNER 200', ROOT),
    folder('svc', 'Service', 'p200'),
  ], ROOT);
  assert.strictEqual(query,
    "('root0' in parents or 'p200' in parents or 'svc' in parents)" +
    " and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
});

test('more than MAX_FOLDERS folders throws', () => {
  const listing = [];
  for (let i = 0; i <= MAX_FOLDERS; i++) listing.push(folder('f' + i, 'F' + i, ROOT));
  assert.strictEqual(listing.length, 151);
  assert.throws(() => buildFolderTree(listing, ROOT), /151 subfolders; the limit is 150/);
});

test('exactly MAX_FOLDERS folders is allowed', () => {
  const listing = [];
  for (let i = 0; i < MAX_FOLDERS; i++) listing.push(folder('f' + i, 'F' + i, ROOT));
  assert.strictEqual(Object.keys(buildFolderTree(listing, ROOT).folders).length, 150);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/drive-tree.test.js`
Expected: FAIL with `Cannot find module '../lib/drive-tree.js'`.

- [ ] **Step 3: Implement**

`lib/drive-tree.js`:

```js
'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Folder Tree" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Every folder adds one "'<id>' in parents" clause to the Drive query. 150
// clauses keep it well inside Drive's query length limit.
const MAX_FOLDERS = 150;

// Walks a flat Drive folder listing down from rootId, to any depth.
// Returns:
//   folders: { <folderId>: { label, path } } for every folder under the root.
//            label = name of the root's direct child the folder sits under
//            (the machine, e.g. "PARTNER 600"); path = '/'-joined names from
//            that child down (e.g. "PARTNER 600/Service").
//   query:   the Drive query listing every non-folder directly in the root or
//            in any of those folders.
function buildFolderTree(listing, rootId) {
  const children = new Map();
  for (const f of listing || []) {
    if (!f || !f.id) continue;
    if (f.mimeType && f.mimeType !== FOLDER_MIME) continue;
    for (const parent of f.parents || []) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(f);
    }
  }

  const folders = {};
  // The visited set is what stops a parent cycle from looping forever.
  const visited = new Set([rootId]);
  const queue = (children.get(rootId) || [])
    .map((f) => ({ folder: f, label: f.name, path: f.name }));
  while (queue.length) {
    const { folder, label, path } = queue.shift();
    if (visited.has(folder.id)) continue;
    visited.add(folder.id);
    folders[folder.id] = { label, path };
    for (const child of children.get(folder.id) || []) {
      queue.push({ folder: child, label, path: path + '/' + child.name });
    }
  }

  const ids = Object.keys(folders);
  if (ids.length > MAX_FOLDERS) {
    throw new Error('The knowledge base root has ' + ids.length + ' subfolders; the limit is ' +
      MAX_FOLDERS + '. Each one adds a clause to the Drive query, which would grow too long ' +
      'for Drive to accept. Flatten the folder tree or raise MAX_FOLDERS after testing a query ' +
      'of that size.');
  }

  const parents = [rootId].concat(ids).map((id) => "'" + id + "' in parents").join(' or ');
  const query = '(' + parents + ') and trashed = false and mimeType != \'' + FOLDER_MIME + '\'';
  return { query, folders };
}
// ---8<--- SHARED END ---8<---

module.exports = { buildFolderTree, MAX_FOLDERS, FOLDER_MIME };
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/drive-tree.test.js`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/drive-tree.js tests/drive-tree.test.js
git commit -m "feat(lib): build the knowledge base folder tree and Drive query"
```

---

### Task 3: `lib/drive-manifest.js`, manifest and sync SQL

This moves today's inline `Build Drive Manifest` logic into a module. It adds the folder, the MIME allowlist, re-processing of moved files, and a stable order.

**Files:**
- Create: `lib/drive-manifest.js`
- Test: `tests/drive-manifest.test.js`

**Interfaces:**
- Consumes: the `folders` map shape from Task 2, `{ [folderId]: { label, path } }`.
- Produces:
  - `buildManifest(files, folders)` returns `{ manifest: Array<{file_id, file_name, last_modified, folder, folder_path}>, skipped: Array<{mimeType, path}> }`. It throws when zero files are usable.
  - `buildSyncQuery(manifest)` returns the SQL string. Its result rows are `{ id, name, last_modified, folder, folder_path }`.
  - `dollarQuote(s)` and `SUPPORTED_MIME` are exported too.
  - The SHARED block declares `dollarQuote`, `MANIFEST_FOLDER_MIME`, `SUPPORTED_MIME`, `buildManifest` and `buildSyncQuery`. Task 5 pastes it into `Build Drive Manifest`.

- [ ] **Step 1: Write the failing tests**

`tests/drive-manifest.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildManifest, buildSyncQuery, dollarQuote } = require('../lib/drive-manifest.js');

const FOLDERS = {
  p200: { label: 'PARTNER 200', path: 'PARTNER 200' },
  svc: { label: 'PARTNER 600', path: 'PARTNER 600/Service' },
};
const DOC = 'application/vnd.google-apps.document';
const file = (over) => Object.assign({
  id: 'f1', name: 'Manual', mimeType: DOC, parents: ['p200'],
  createdTime: '2026-09-26T11:00:00.000Z', modifiedTime: '2026-09-26T12:00:00.000Z',
}, over);

test('files get their folder label and path', () => {
  const { manifest } = buildManifest([file({}), file({ id: 'f2', parents: ['svc'] })], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => [m.file_id, m.folder, m.folder_path]), [
    ['f1', 'PARTNER 200', 'PARTNER 200'],
    ['f2', 'PARTNER 600', 'PARTNER 600/Service'],
  ]);
});

test('a file directly in the root gets empty folder and path', () => {
  const { manifest } = buildManifest([file({ parents: ['root0'] })], FOLDERS);
  assert.strictEqual(manifest[0].folder, '');
  assert.strictEqual(manifest[0].folder_path, '');
});

test('a file with several parents uses the first one inside the tree', () => {
  const { manifest } = buildManifest([file({ parents: ['outside', 'svc', 'p200'] })], FOLDERS);
  assert.strictEqual(manifest[0].folder_path, 'PARTNER 600/Service');
});

test('last_modified is the later of createdTime and modifiedTime', () => {
  const { manifest } = buildManifest([
    file({}),
    file({ id: 'f2', createdTime: '2026-09-27T00:00:00.000Z', modifiedTime: '2026-09-26T00:00:00.000Z' }),
    file({ id: 'f3', createdTime: undefined }),
  ], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => m.last_modified), [
    '2026-09-26T12:00:00.000Z', '2026-09-27T00:00:00.000Z', '2026-09-26T12:00:00.000Z',
  ]);
});

test('all four supported types are kept', () => {
  const types = ['application/pdf', DOC,
    'application/vnd.google-apps.presentation', 'application/vnd.google-apps.spreadsheet'];
  const { manifest, skipped } = buildManifest(types.map((t, i) => file({ id: 'f' + i, mimeType: t })), FOLDERS);
  assert.strictEqual(manifest.length, 4);
  assert.deepStrictEqual(skipped, []);
});

test('unsupported types, shortcuts included, are skipped and reported with their path', () => {
  const { manifest, skipped } = buildManifest([
    file({}),
    file({ id: 'd', name: 'Old.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parents: ['svc'] }),
    file({ id: 's', name: 'Link', mimeType: 'application/vnd.google-apps.shortcut', parents: ['root0'] }),
  ], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => m.file_id), ['f1']);
  assert.deepStrictEqual(skipped, [
    { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', path: 'PARTNER 600/Service/Old.docx' },
    { mimeType: 'application/vnd.google-apps.shortcut', path: 'Link' },
  ]);
});

test('folders and trashed files are dropped silently', () => {
  const { manifest, skipped } = buildManifest([
    file({}),
    file({ id: 'x', mimeType: 'application/vnd.google-apps.folder' }),
    file({ id: 'y', trashed: true }),
  ], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => m.file_id), ['f1']);
  assert.deepStrictEqual(skipped, []);
});

test('zero usable files throws instead of wiping the knowledge base', () => {
  assert.throws(() => buildManifest([], FOLDERS), /Refusing to run the orphan sweep/);
  assert.throws(() => buildManifest([file({ mimeType: 'text/plain' })], FOLDERS),
    /Refusing to run the orphan sweep/, 'only-unsupported must count as zero');
});

test('a file with no timestamps throws', () => {
  assert.throws(() => buildManifest([file({ createdTime: undefined, modifiedTime: undefined })], FOLDERS),
    /neither createdTime nor modifiedTime/);
});

test('the sync query reprocesses moved files and orders the work list', () => {
  const q = buildSyncQuery([{ file_id: 'f1', file_name: 'Manual', last_modified: 'x', folder: 'A', folder_path: 'A' }]);
  assert.ok(q.includes('folder text, folder_path text'));
  assert.ok(q.includes("max(metadata->>'folder_path') AS folder_path"));
  assert.ok(q.includes("OR coalesce(kb.folder_path, '') IS DISTINCT FROM drive.folder_path"));
  assert.ok(q.includes('OR kb.last_modified IS DISTINCT FROM drive.last_modified'));
  assert.ok(q.includes('drive.folder, drive.folder_path'));
  assert.ok(q.trimEnd().endsWith('ORDER BY drive.last_modified, drive.file_id'));
  assert.ok(q.includes("WHERE d.metadata->>'source' = 'knowledge_base'"), 'sweep stays scoped');
});

test('dollarQuote survives a payload containing its own tag', () => {
  assert.strictEqual(dollarQuote('a $q$ b'), '$q_$a $q$ b$q_$');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/drive-manifest.test.js`
Expected: FAIL with `Cannot find module '../lib/drive-manifest.js'`.

- [ ] **Step 3: Implement**

`lib/drive-manifest.js`:

```js
'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Drive Manifest" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

// Dollar-quoting: SQL-injection-proof escaping for PostgreSQL.
function dollarQuote(s) {
  let tag = 'q';
  while (s.includes('$' + tag + '$')) tag += '_';
  return '$' + tag + '$' + s + '$' + tag + '$';
}

const MANIFEST_FOLDER_MIME = 'application/vnd.google-apps.folder';

// What the extraction path can read: PDFs as-is, Google files exported to PDF
// by Download Knowledge Base File. Anything else never reaches Gemini.
const SUPPORTED_MIME = [
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
];

// Turns the Drive file listing into the manifest the sync compares against
// the database. `folders` is Build Folder Tree's { <folderId>: { label, path } };
// a file whose parent is not in it sits directly in the root and gets ''.
// Returns { manifest, skipped }: manifest rows are
// { file_id, file_name, last_modified, folder, folder_path }, where
// last_modified is max(createdTime, modifiedTime) as reported by Drive.
function buildManifest(files, folders) {
  const manifest = [];
  const skipped = [];
  for (const f of files || []) {
    if (!f || !f.id || f.mimeType === MANIFEST_FOLDER_MIME || f.trashed === true) continue;

    const parent = (f.parents || []).find((p) => folders && folders[p]);
    const where = parent ? folders[parent] : { label: '', path: '' };
    const name = f.name || f.id;

    if (!SUPPORTED_MIME.includes(f.mimeType)) {
      skipped.push({ mimeType: f.mimeType || 'unknown', path: (where.path ? where.path + '/' : '') + name });
      continue;
    }

    const created = f.createdTime || null;
    const modified = f.modifiedTime || null;
    if (!created && !modified) {
      throw new Error('Drive file "' + name + '" returned neither createdTime nor modifiedTime. Set the Google Drive node option Fields to [All] — without it the API omits both timestamps and every file would look changed on every run.');
    }
    const last = (created && modified)
      ? (new Date(modified) > new Date(created) ? modified : created)
      : (modified || created);

    manifest.push({
      file_id: f.id,
      file_name: name,
      last_modified: last,
      folder: where.label,
      folder_path: where.path,
    });
  }

  // An empty listing is far likelier to be an API or permission failure than a
  // genuinely empty folder, and the sweep would delete every knowledge_base
  // row. Refuse rather than wipe the knowledge base.
  if (manifest.length === 0) {
    throw new Error('Drive listing returned 0 usable files for the knowledge base folder tree. Refusing to run the orphan sweep, which would delete every knowledge_base row. Check the Drive credential, the root folder ID, and that "Return All" is enabled.');
  }
  return { manifest, skipped };
}

// One SQL statement that sweeps orphaned rows and returns the files still
// needing (re)processing.
//
// NOT EXISTS rather than NOT IN: NOT IN against a set containing any NULL
// evaluates to NULL and would silently delete nothing.
// IS DISTINCT FROM rather than <>: last_modified is nullable, and <> against
// NULL yields NULL, which would mark a file up-to-date and never reprocess it.
// folder_path: moving a file in Drive does not change modifiedTime, so a moved
// file is only caught by comparing where it was ingested from.
// All CTEs read one snapshot, so the DELETE in `orphans` does not perturb what
// `kb` sees; the work list is still computed against pre-delete state.
function buildSyncQuery(manifest) {
  return [
    'WITH drive AS (',
    '  SELECT * FROM jsonb_to_recordset(' + dollarQuote(JSON.stringify(manifest)) + '::jsonb)',
    '    AS x(file_id text, file_name text, last_modified timestamptz, folder text, folder_path text)',
    '),',
    'kb AS (',
    "  SELECT metadata->>'file_id' AS file_id, max(last_modified) AS last_modified,",
    "         max(metadata->>'folder_path') AS folder_path",
    '  FROM documents',
    "  WHERE metadata->>'source' = 'knowledge_base'",
    '  GROUP BY 1',
    '),',
    'orphans AS (',
    '  DELETE FROM documents d',
    "   WHERE d.metadata->>'source' = 'knowledge_base'",
    "     AND NOT EXISTS (SELECT 1 FROM drive WHERE drive.file_id = d.metadata->>'file_id')",
    '  RETURNING 1',
    ')',
    'SELECT drive.file_id AS id, drive.file_name AS name, drive.last_modified,',
    '       drive.folder, drive.folder_path',
    'FROM drive',
    'LEFT JOIN kb ON kb.file_id = drive.file_id',
    'WHERE kb.file_id IS NULL',
    '   OR kb.last_modified IS DISTINCT FROM drive.last_modified',
    "   OR coalesce(kb.folder_path, '') IS DISTINCT FROM drive.folder_path",
    'ORDER BY drive.last_modified, drive.file_id',
  ].join('\n');
}
// ---8<--- SHARED END ---8<---

module.exports = { buildManifest, buildSyncQuery, dollarQuote, SUPPORTED_MIME };
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/drive-manifest.test.js`
Expected: `# pass 11`, `# fail 0`.

This SQL was also run against PostgreSQL (PGlite) while the plan was being written. The work list was the new, moved and edited files, the orphan was swept, and expert-feedback rows survived. The live check is in Task 10.

- [ ] **Step 5: Commit**

```bash
git add lib/drive-manifest.js tests/drive-manifest.test.js
git commit -m "feat(lib): manifest with folder, type allowlist and move detection"
```

---

### Task 4: `lib/chunking.js`, line-preserving chunker

This replaces the inline chunker. It keeps line breaks, keeps short documents whole, merges tiny sections, adds the folder label, and fixes title extraction.

**Files:**
- Create: `lib/chunking.js`
- Test: `tests/chunking.test.js`

**Interfaces:**
- Produces:
  - `chunkDocument(text: string, title: string, folder: string)` returns `Array<{ text, section_heading, chunk_index, embed_title }>`. It returns `[]` for blank text.
  - `titleFromFileName(name: string): string`.
  - Also exported: `countWords` and the four constants.
  - The SHARED block declares `WORD_LIMIT`, `OVERLAP_WORDS`, `WHOLE_DOC_WORDS`, `MIN_SECTION_WORDS`, `countWords`, `titleFromFileName`, `splitSections`, `joinSections`, `mergeSmallSections`, `wordWindows`, `packSection` and `chunkDocument`. Task 6 pastes it into `Preparing Chunks`.

- [ ] **Step 1: Write the failing tests**

`tests/chunking.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  chunkDocument, titleFromFileName, countWords, WORD_LIMIT, OVERLAP_WORDS,
} = require('../lib/chunking.js');

// n distinct words, so overlap and dedupe can be checked by content.
const words = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => prefix + i).join(' ');
const body = (chunk) => chunk.text.slice(chunk.text.indexOf('\n\n') + 2);

test('a short procedure is one chunk and keeps one step per line', () => {
  const text = '## Procedura\n1. Apasati MENIU\n2. Selectati 5\n3. Introduceti parola 0000';
  const chunks = chunkDocument(text, 'Update firmware', 'DOCUMENTATIE COMUNA');
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].text,
    '[DOCUMENTATIE COMUNA] Update firmware — Update firmware\n\n' + text);
  assert.ok(chunks[0].text.includes('1. Apasati MENIU\n2. Selectati 5\n'));
});

test('a 700-word document with three sections stays one chunk', () => {
  const text = ['## A', words(250, 'a'), '## B', words(250, 'b'), '## C', words(197, 'c')].join('\n');
  assert.ok(countWords(text) <= 800);
  const chunks = chunkDocument(text, 'Doc', 'PARTNER 200');
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].section_heading, 'Doc');
});

test('a long document splits by section, labelled with folder, title and heading', () => {
  const text = ['## Instalare', words(300, 'i'), '## Service', words(300, 's'), '## Erori', words(300, 'e')].join('\n');
  const chunks = chunkDocument(text, 'Manual', 'PARTNER 600');
  assert.deepStrictEqual(chunks.map((c) => c.section_heading), ['Instalare', 'Service', 'Erori']);
  assert.ok(chunks[1].text.startsWith('[PARTNER 600] Manual — Service\n\n'));
  assert.strictEqual(chunks[1].embed_title, 'PARTNER 600 — Manual — Service');
  assert.deepStrictEqual(chunks.map((c) => c.chunk_index), [0, 1, 2]);
});

test('root-level files get no bracket label', () => {
  const chunks = chunkDocument('Scurt.', 'Nota', '');
  assert.strictEqual(chunks[0].text, 'Nota — Nota\n\nScurt.');
  assert.strictEqual(chunks[0].embed_title, 'Nota — Nota');
});

test('a tiny section merges into the next one with a joined heading', () => {
  const text = ['## Intro', words(300, 'i'), '## Atentie', words(20, 't'), '## Pasi', words(300, 'p'),
    '## Final', words(300, 'f')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X');
  assert.deepStrictEqual(chunks.map((c) => c.section_heading), ['Intro', 'Atentie / Pasi', 'Final']);
  assert.ok(body(chunks[1]).startsWith(words(20, 't') + '\n\n## Pasi\n'));
});

test('a tiny last section merges into the previous one', () => {
  const text = ['## A', words(500, 'a'), '## B', words(300, 'b'), '## Contact', words(10, 'c')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X');
  const last = chunks[chunks.length - 1];
  assert.strictEqual(last.section_heading, 'B / Contact');
  assert.ok(body(last).endsWith('## Contact\n' + words(10, 'c')));
});

test('lines are packed whole, never split mid-line, with line overlap', () => {
  // 40 lines of 20 words = 800 words in one section, plus a second section to pass WHOLE_DOC_WORDS.
  const lines = Array.from({ length: 40 }, (_, i) => words(20, 'l' + i + '_'));
  const text = ['## Pasi', ...lines, '## Alt', words(100, 'z')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X').filter((c) => c.section_heading === 'Pasi');
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    const b = body(c);
    assert.ok(countWords(b) <= WORD_LIMIT, 'chunk over the limit');
    for (const line of b.split('\n')) assert.ok(lines.includes(line), 'a line was cut: ' + line.slice(0, 30));
  }
  // The next chunk starts with the previous chunk's trailing lines (3 lines = 60 words <= 75).
  const firstLines = body(chunks[0]).split('\n');
  const secondLines = body(chunks[1]).split('\n');
  assert.deepStrictEqual(secondLines.slice(0, 3), firstLines.slice(-3));
});

test('one enormous line is cut into overlapping word windows', () => {
  const text = ['## Tabel', words(1000, 't'), '## Alt', words(100, 'z')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X').filter((c) => c.section_heading === 'Tabel');
  const bodies = chunks.map(body);
  for (const b of bodies) assert.ok(countWords(b) <= WORD_LIMIT);
  const first = bodies[0].split(' ');
  const second = bodies[1].split(' ');
  assert.strictEqual(first.length, WORD_LIMIT);
  assert.deepStrictEqual(second.slice(0, OVERLAP_WORDS), first.slice(-OVERLAP_WORDS));
  assert.ok(bodies[bodies.length - 1].endsWith('t999'), 'the tail of the line is kept');
});

test('a repeated section is stored once', () => {
  const sec = words(300, 'r');
  const text = ['## Dup', sec, '## Dup', sec, '## Alt', words(300, 'a')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X');
  assert.deepStrictEqual(chunks.map((c) => c.section_heading), ['Dup', 'Alt']);
});

test('blank text yields no chunks', () => {
  assert.deepStrictEqual(chunkDocument('   \n ', 'Doc', 'X'), []);
  assert.deepStrictEqual(chunkDocument('', 'Doc', 'X'), []);
});

test('titleFromFileName strips only real extensions', () => {
  assert.strictEqual(titleFromFileName('Instructiuni update firmware P200-300-600 19.01.2026'),
    'Instructiuni update firmware P200-300-600 19.01.2026');
  assert.strictEqual(titleFromFileName('Manual PARTNER 600-v2.pdf'), 'Manual PARTNER 600-v2');
  assert.strictEqual(titleFromFileName('Oferta.DOCX'), 'Oferta');
  assert.strictEqual(titleFromFileName('fisa.xlsx'), 'fisa');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/chunking.test.js`
Expected: FAIL with `Cannot find module '../lib/chunking.js'`.

- [ ] **Step 3: Implement**

`lib/chunking.js`:

```js
'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Preparing Chunks" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

const WORD_LIMIT = 350;        // max words per chunk (words, not model tokens)
const OVERLAP_WORDS = 75;      // words carried into the next chunk of a section
const WHOLE_DOC_WORDS = 800;   // documents at or under this stay one chunk
const MIN_SECTION_WORDS = 60;  // sections under this merge into a neighbour

function countWords(s) {
  return String(s || '').split(/\s+/).filter(Boolean).length;
}

// Google-native files have no extension, and their names can contain dots
// ("... 19.01.2026"), so only strip extensions we actually ingest.
function titleFromFileName(name) {
  return String(name || '').replace(/\.(pdf|docx?|pptx?|xlsx?)$/i, '');
}

// Split on "## " headings. Text before the first heading belongs to a section
// headed by the document title. Empty sections are dropped.
function splitSections(text, title) {
  const sections = [];
  let heading = title;
  let lines = [];
  const flush = () => {
    const content = lines.join('\n').trim();
    if (content) sections.push({ heading, content });
    lines = [];
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function joinSections(a, b) {
  return { heading: a.heading + ' / ' + b.heading, content: a.content + '\n\n## ' + b.heading + '\n' + b.content };
}

// A section under MIN_SECTION_WORDS merges into the next one; a small last
// section merges into the previous one instead.
function mergeSmallSections(sections) {
  const out = [];
  let pending = null;
  for (const s of sections) {
    const cur = pending ? joinSections(pending, s) : s;
    pending = null;
    if (countWords(cur.content) < MIN_SECTION_WORDS) {
      pending = cur;
      continue;
    }
    out.push(cur);
  }
  if (pending) {
    if (out.length) out[out.length - 1] = joinSections(out[out.length - 1], pending);
    else out.push(pending);
  }
  return out;
}

// A single line longer than WORD_LIMIT is cut into overlapping word windows.
function wordWindows(line) {
  const words = line.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += WORD_LIMIT - OVERLAP_WORDS) {
    out.push(words.slice(i, i + WORD_LIMIT).join(' '));
    if (i + WORD_LIMIT >= words.length) break;
  }
  return out;
}

// Fill chunks with whole lines, keeping the newlines, so numbered steps stay
// one per line. Each new chunk starts with the previous chunk's trailing lines,
// up to OVERLAP_WORDS words.
function packSection(content) {
  const units = [];
  for (const line of content.split('\n')) {
    if (countWords(line) > WORD_LIMIT) units.push(...wordWindows(line));
    else units.push(line);
  }

  const chunks = [];
  let cur = [];
  let curWords = 0;
  for (const unit of units) {
    const w = countWords(unit);
    if (curWords > 0 && curWords + w > WORD_LIMIT) {
      chunks.push(cur.join('\n').trim());
      const carry = [];
      let carryWords = 0;
      for (let k = cur.length - 1; k >= 0; k--) {
        const cw = countWords(cur[k]);
        if (carryWords + cw > OVERLAP_WORDS) break;
        carry.unshift(cur[k]);
        carryWords += cw;
      }
      cur = carryWords + w > WORD_LIMIT ? [] : carry;
      curWords = cur === carry ? carryWords : 0;
    }
    cur.push(unit);
    curWords += w;
  }
  if (curWords > 0) chunks.push(cur.join('\n').trim());
  return chunks;
}

// Returns [{ text, section_heading, chunk_index, embed_title }] for one
// document. `text` is what is stored and embedded: it starts with
// "[<folder>] <title> — <heading>" so every retrieval path sees the folder.
function chunkDocument(text, title, folder) {
  const body = String(text || '').trim();
  if (!body) return [];

  let pieces;
  if (countWords(body) <= WHOLE_DOC_WORDS) {
    pieces = [{ heading: title, text: body }];
  } else {
    pieces = [];
    for (const section of mergeSmallSections(splitSections(body, title))) {
      for (const chunk of packSection(section.content)) pieces.push({ heading: section.heading, text: chunk });
    }
  }

  const out = [];
  const seen = new Set();
  for (const p of pieces) {
    const label = (folder ? '[' + folder + '] ' : '') + title + ' — ' + p.heading;
    const stored = label + '\n\n' + p.text;
    // Gemini extraction may repeat a section; keep the first copy.
    if (seen.has(stored)) continue;
    seen.add(stored);
    out.push({
      text: stored,
      section_heading: p.heading,
      chunk_index: out.length,
      embed_title: (folder ? folder + ' — ' : '') + title + ' — ' + p.heading,
    });
  }
  return out;
}
// ---8<--- SHARED END ---8<---

module.exports = {
  chunkDocument, titleFromFileName, countWords,
  WORD_LIMIT, OVERLAP_WORDS, WHOLE_DOC_WORDS, MIN_SECTION_WORDS,
};
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/chunking.test.js`
Expected: `# pass 11`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/chunking.js tests/chunking.test.js
git commit -m "feat(lib): line-preserving chunker with whole-doc and small-section rules"
```

---

### Task 5: Walk the folder tree in `ingestion.json`

**Files:**
- Modify: `workflows/ingestion.json`. This adds `Drive: All Folders` and `Build Folder Tree`, changes `Drive: Knowledge Base` and `Build Drive Manifest`, and rewires `Sync Trigger`.
- Test: `tests/ingestion-workflow.test.js` (append)

**Interfaces:**
- Consumes: `buildFolderTree` (Task 2), `buildManifest` and `buildSyncQuery` (Task 3), `sharedBlock` (Task 1).
- Produces, for Task 6:
  - `Build Folder Tree` outputs one item, `{ query, folders }`.
  - `Sync Check` rows now carry `folder` and `folder_path` next to `id`, `name` and `last_modified`.

Facts about the n8n Drive node v3 search, read from the n8n 2.28.3 source (`nodes/Google/Drive/v2/actions/fileFolder/search.operation.ts`):
- `searchMethod: 'query'` sends `queryString` as-is.
- A non-empty `filter` makes the node append `'<folder>' in parents` and `trashed = false` clauses itself, which is why `filter` stays `{}`.
- `options.fields` has no `parents` entry, so we use `['*']`.

- [ ] **Step 1: Append the failing tests**

Append to the end of `tests/ingestion-workflow.test.js`:

```js
test('the knowledge base listing walks the folder tree in order', () => {
  assert.deepStrictEqual(targets('Sync Trigger'), [['Drive: All Folders']]);
  assert.deepStrictEqual(targets('Drive: All Folders'), [['Build Folder Tree']]);
  assert.deepStrictEqual(targets('Build Folder Tree'), [['Drive: Knowledge Base']]);
  assert.deepStrictEqual(targets('Drive: Knowledge Base'), [['Build Drive Manifest']]);
  assert.deepStrictEqual(targets('Build Drive Manifest'), [['Sync Check']]);
});

test('Drive: All Folders lists every folder and always reaches Build Folder Tree', () => {
  const node = byName('Drive: All Folders');
  assert.strictEqual(node.type, 'n8n-nodes-base.googleDrive');
  assert.strictEqual(node.parameters.searchMethod, 'query');
  assert.strictEqual(node.parameters.queryString,
    "mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  assert.strictEqual(node.parameters.returnAll, true);
  assert.deepStrictEqual(node.parameters.filter, {}, 'a filter makes the node append its own clauses');
  assert.deepStrictEqual(node.parameters.options.fields, ['*'], 'parents is only returned with *');
  assert.strictEqual(node.alwaysOutputData, true);
  assert.deepStrictEqual(node.credentials, byName('Download Knowledge Base File').credentials);
});

test('Build Folder Tree embeds lib/drive-tree.js and roots at the new folder', () => {
  const code = byName('Build Folder Tree').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/drive-tree.js')), 'Code node has drifted from lib/drive-tree.js');
  assert.ok(code.includes("const KB_ROOT_ID = '1g7SDhQdmKB-MVs5R21gZypwpKLPzee0q';"));
});

test('Drive: Knowledge Base lists files with the query Build Folder Tree built', () => {
  const p = byName('Drive: Knowledge Base').parameters;
  assert.strictEqual(p.searchMethod, 'query');
  assert.strictEqual(p.queryString, '={{ $json.query }}');
  assert.strictEqual(p.returnAll, true);
  assert.deepStrictEqual(p.filter, {});
  assert.deepStrictEqual(p.options.fields, ['*'], 'timestamps and parents need *');
  assert.ok(!JSON.stringify(p).includes('1-y3bvqtTXEj2Vyl-lC5Em6aISbtqCcbm'), 'old flat folder is gone');
});

test('Build Drive Manifest embeds lib/drive-manifest.js and reads folders from Build Folder Tree', () => {
  const code = byName('Build Drive Manifest').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/drive-manifest.js')), 'Code node has drifted from lib/drive-manifest.js');
  assert.ok(code.includes("$('Build Folder Tree').first().json.folders"));
  assert.ok(code.includes('buildSyncQuery(manifest)'));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/ingestion-workflow.test.js`
Expected: the 5 new tests FAIL. The first one reports `Drive: All Folders` missing from the `Sync Trigger` targets.

- [ ] **Step 3: Write the splice script**

`splice-listing.js` at the repo root:

```js
'use strict';
// One-off: walks the knowledge base folder tree instead of one flat folder.
// Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, 'workflows/ingestion.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (name) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('node not found: ' + name);
  return node;
};
// lib files may be checked out with CRLF; Code nodes store \n.
const shared = (rel) => {
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
  return src.slice(src.indexOf('// ---8<--- SHARED START ---8<---'), src.indexOf('// ---8<--- SHARED END ---8<---'));
};

const DRIVE_CREDS = byName('Drive: Knowledge Base').credentials;

const treeCode = shared('lib/drive-tree.js') + `
// ---- n8n glue ----
const KB_ROOT_ID = '1g7SDhQdmKB-MVs5R21gZypwpKLPzee0q';
const listing = $input.all().map((item) => item.json);
const { query, folders } = buildFolderTree(listing, KB_ROOT_ID);
console.log('Folder tree: ' + Object.keys(folders).length + ' folder(s) under the knowledge base root');
return [{ json: { query, folders } }];
`;

const manifestCode = shared('lib/drive-manifest.js') + `
// ---- n8n glue ----
const folders = $('Build Folder Tree').first().json.folders || {};
const files = $input.all().map((item) => item.json);
const { manifest, skipped } = buildManifest(files, folders);
for (const s of skipped) {
  console.log('unsupported type ' + s.mimeType + ': ' + s.path + ' (not ingested; convert it to a Google Doc or PDF)');
}
console.log('Drive manifest: ' + manifest.length + ' file(s) under the knowledge base root');
return [{ json: { query: buildSyncQuery(manifest), drive_file_count: manifest.length } }];
`;

wf.nodes.push(
  {
    parameters: {
      resource: 'fileFolder',
      searchMethod: 'query',
      queryString: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      returnAll: true,
      filter: {},
      options: { fields: ['*'] },
    },
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position: [4048, -1424],
    id: 'b7d1e2f0-0001-4000-8000-00000000a001',
    name: 'Drive: All Folders',
    alwaysOutputData: true,
    credentials: DRIVE_CREDS,
  },
  {
    parameters: { jsCode: treeCode },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [4272, -1424],
    id: 'b7d1e2f0-0002-4000-8000-00000000a002',
    name: 'Build Folder Tree',
  }
);

// Folder mode lists one folder's direct children; query mode takes the
// "(root or any descendant) in parents" query Build Folder Tree builds.
// filter stays {}: a non-empty filter makes the node append its own clauses.
byName('Drive: Knowledge Base').parameters = {
  resource: 'fileFolder',
  searchMethod: 'query',
  queryString: '={{ $json.query }}',
  returnAll: true,
  filter: {},
  options: { fields: ['*'] },
};
byName('Build Drive Manifest').parameters.jsCode = manifestCode;

wf.connections['Sync Trigger'] = { main: [[{ node: 'Drive: All Folders', type: 'main', index: 0 }]] };
wf.connections['Drive: All Folders'] = { main: [[{ node: 'Build Folder Tree', type: 'main', index: 0 }]] };
wf.connections['Build Folder Tree'] = { main: [[{ node: 'Drive: Knowledge Base', type: 'main', index: 0 }]] };

// ingestion.json is stored without a trailing newline.
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('ingestion.json: folder tree listing wired');
```

- [ ] **Step 4: Run it and delete it**

```bash
node splice-listing.js && rm splice-listing.js
```

Expected output: `ingestion.json: folder tree listing wired`.

- [ ] **Step 5: Run the suite**

Run: `node --test tests/`
Expected: `# fail 0`.

- [ ] **Step 6: Check the diff is only the knowledge-base listing**

Run: `git diff --stat workflows/ingestion.json`
Expected: one file changed. `git diff workflows/ingestion.json` shows these changes and nothing in the expert-feedback or technicians branches:
- two new nodes;
- the `Drive: Knowledge Base` parameters;
- the `Build Drive Manifest` code;
- three connection changes.

- [ ] **Step 7: Commit**

```bash
git add workflows/ingestion.json tests/ingestion-workflow.test.js
git commit -m "feat(ingestion): list the knowledge base as a folder tree"
```

---

### Task 6: Carry the folder through extraction and chunk with `lib/chunking.js`

**Files:**
- Modify: `workflows/ingestion.json`. This touches `Download Knowledge Base File`, `Prepare Gemini Request`, `Format Gemini Result`, `Preparing Chunks` and `Format for Insert`.
- Test: `tests/ingestion-workflow.test.js` (append)

**Interfaces:**
- Consumes: `Sync Check` rows with `folder` and `folder_path` (Task 5); `chunkDocument` and `titleFromFileName` (Task 4).
- Produces, for Task 7 and for retrieval:
  - `Preparing Chunks` throws `no chunkable text in "<name>"` when it produces zero chunks;
  - each chunk carries `folder`, `folder_path` and `embed_title`;
  - the `documents.metadata` JSON gains `folder` and `folder_path`.

The splice patches the three existing Code nodes by exact-anchor replacement, and refuses to run unless each anchor matches exactly once. `Format Gemini Result` and `Format for Insert` store CRLF line endings inside their code, and the `patch` helper keeps them.

- [ ] **Step 1: Append the failing tests**

Append to the end of `tests/ingestion-workflow.test.js`:

```js
test('Download Knowledge Base File exports Docs, Slides and Sheets as PDF', () => {
  const conv = byName('Download Knowledge Base File').parameters.options.googleFileConversion.conversion;
  assert.deepStrictEqual(conv, {
    docsToFormat: 'application/pdf',
    slidesToFormat: 'application/pdf',
    sheetsToFormat: 'application/pdf',
  });
});

test('the folder travels from Sync Check to the chunker', () => {
  const prep = byName('Prepare Gemini Request').parameters.jsCode;
  assert.ok(prep.includes("const folder = syncRow.folder || '';"));
  assert.ok(prep.includes("const folderPath = syncRow.folder_path || '';"));
  assert.ok(/folder: folder,\s+folder_path: folderPath,/.test(prep));
  const fmt = byName('Format Gemini Result').parameters.jsCode;
  assert.ok(/folder: prep\.folder \|\| '',\s+folder_path: prep\.folder_path \|\| ''/.test(fmt));
});

test('Preparing Chunks embeds lib/chunking.js and never ends the loop silently', () => {
  const code = byName('Preparing Chunks').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/chunking.js')), 'Code node has drifted from lib/chunking.js');
  assert.ok(code.includes("chunkDocument(x.text || '', title, x.folder || '')"));
  assert.ok(code.includes('titleFromFileName(originalFileName)'));
  assert.ok(code.includes('title: c.embed_title'));
  assert.ok(/if \(allChunks\.length === 0\) \{\s+throw new Error/.test(code));
  assert.ok(!code.includes('TOKEN_LIMIT'), 'the old inline chunker is gone');
});

test('Format for Insert stores folder and folder_path in metadata', () => {
  const code = byName('Format for Insert').parameters.jsCode;
  assert.ok(/folder: chunk\.folder,\s+folder_path: chunk\.folder_path,/.test(code));
  assert.ok(code.includes("source: 'knowledge_base'"));
  assert.ok(code.includes("DELETE FROM documents WHERE metadata->>'file_id' = "));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/ingestion-workflow.test.js`
Expected: the 4 new tests FAIL. The first reports that the conversion lacks `slidesToFormat`.

- [ ] **Step 3: Write the splice script**

`splice-chunking.js` at the repo root:

```js
'use strict';
// One-off: carries the folder through extraction, swaps in lib/chunking.js,
// stores folder metadata, and exports Slides/Sheets as PDF.
// Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, 'workflows/ingestion.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (name) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('node not found: ' + name);
  return node;
};
const shared = (rel) => {
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
  return src.slice(src.indexOf('// ---8<--- SHARED START ---8<---'), src.indexOf('// ---8<--- SHARED END ---8<---'));
};
// Replace exactly one occurrence, keeping the node's own line endings.
function patch(nodeName, anchor, replacement) {
  const node = byName(nodeName);
  const code = node.parameters.jsCode;
  const nl = code.includes('\r\n') ? '\r\n' : '\n';
  const a = anchor.replace(/\n/g, nl);
  const count = code.split(a).length - 1;
  if (count !== 1) throw new Error(nodeName + ': expected 1 match for anchor, found ' + count + ': ' + anchor);
  node.parameters.jsCode = code.replace(a, replacement.replace(/\n/g, nl));
}

// Slides and Sheets default to pptx/csv exports, which Gemini inline_data rejects.
byName('Download Knowledge Base File').parameters.options.googleFileConversion.conversion = {
  docsToFormat: 'application/pdf',
  slidesToFormat: 'application/pdf',
  sheetsToFormat: 'application/pdf',
};

patch('Prepare Gemini Request',
  '  const lastModified = driveJson.last_modified || syncRow.last_modified || null;\n',
  '  const lastModified = driveJson.last_modified || syncRow.last_modified || null;\n' +
  '  // Where the file sits under the knowledge base root (Sync Check). Preparing\n' +
  '  // Chunks puts it on every chunk; Format for Insert stores it in metadata.\n' +
  "  const folder = syncRow.folder || '';\n" +
  "  const folderPath = syncRow.folder_path || '';\n");
patch('Prepare Gemini Request',
  '      last_modified: lastModified,\n',
  '      last_modified: lastModified,\n' +
  '      folder: folder,\n' +
  '      folder_path: folderPath,\n');

patch('Format Gemini Result',
  '      last_modified: prep.last_modified || null\n',
  '      last_modified: prep.last_modified || null,\n' +
  "      folder: prep.folder || '',\n" +
  "      folder_path: prep.folder_path || ''\n");

byName('Preparing Chunks').parameters.jsCode = shared('lib/chunking.js') + `
// ---- n8n glue ----
const EMBED_BATCH_SIZE = 100;

const allChunks = [];
const names = [];
for (const item of $input.all()) {
  const x = item.json || {};
  const originalFileName = x.original_file_name || 'unknown';
  names.push(originalFileName);
  const title = titleFromFileName(originalFileName);
  for (const c of chunkDocument(x.text || '', title, x.folder || '')) {
    allChunks.push(Object.assign({}, c, {
      original_file_name: originalFileName,
      file_id: x.file_id || '',
      last_modified: x.last_modified || null,
      folder: x.folder || '',
      folder_path: x.folder_path || '',
    }));
  }
}

// An empty output would end the branch without looping back to Process One
// File, silently skipping every file still queued this run.
if (allChunks.length === 0) {
  throw new Error('no chunkable text in "' + names.join('", "') + '"');
}

const batches = [];
for (let i = 0; i < allChunks.length; i += EMBED_BATCH_SIZE) {
  const batch = allChunks.slice(i, i + EMBED_BATCH_SIZE);
  batches.push({
    json: {
      chunks: batch,
      requestBody: {
        requests: batch.map((c) => ({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: c.text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          title: c.embed_title,
          outputDimensionality: 1536,
        })),
      },
    },
  });
}
return batches;
`;

patch('Format for Insert',
  '      chunk_index: chunk.chunk_index,\n',
  '      chunk_index: chunk.chunk_index,\n' +
  '      folder: chunk.folder,\n' +
  '      folder_path: chunk.folder_path,\n');

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('ingestion.json: folder carried through, chunking replaced');
```

- [ ] **Step 4: Run it and delete it**

```bash
node splice-chunking.js && rm splice-chunking.js
```

Expected output: `ingestion.json: folder carried through, chunking replaced`.

- [ ] **Step 5: Run the suite**

Run: `node --test tests/`
Expected: `# fail 0`.

- [ ] **Step 6: Smoke-run the new Code nodes outside n8n**

This runs the embedded code with stubbed `$input` and `$`. It catches name clashes between a SHARED block and its glue, which the text-based tests cannot see.

```bash
node -e "
const wf=require('./workflows/ingestion.json');const code=(n)=>wf.nodes.find(x=>x.name===n).parameters.jsCode;
const run=(n,input,refs={})=>new Function('\$input','\$','console',code(n))({all:()=>input.map(j=>({json:j})),first:()=>({json:input[0]})},(name)=>({first:()=>({json:refs[name]})}),{log:()=>{}});
const R='1g7SDhQdmKB-MVs5R21gZypwpKLPzee0q',F='application/vnd.google-apps.folder';
const tree=run('Build Folder Tree',[{id:'p2',name:'PARTNER 200',parents:[R],mimeType:F}])[0].json;
const man=run('Build Drive Manifest',[{id:'a',name:'Manual',mimeType:'application/vnd.google-apps.document',parents:['p2'],modifiedTime:'2026-09-26T11:00:00Z'}],{'Build Folder Tree':tree})[0].json;
const w=(n,p)=>Array.from({length:n},(_,i)=>p+i).join(' ');
const pc=run('Preparing Chunks',[{text:'## A\n'+w(500,'a')+'\n## B\n'+w(500,'b'),original_file_name:'Instr 19.01.2026',file_id:'a',last_modified:'x',folder:'PARTNER 200',folder_path:'PARTNER 200'}]);
console.log(man.drive_file_count, pc[0].json.chunks.length, pc[0].json.requestBody.requests[0].title);
"
```

Expected: `1 4 PARTNER 200 — Instr 19.01.2026 — A`.

- [ ] **Step 7: Commit**

```bash
git add workflows/ingestion.json tests/ingestion-workflow.test.js
git commit -m "feat(ingestion): label chunks with their folder and keep line structure"
```

---

### Task 7: Skip and report failing files

**Files:**
- Modify: `workflows/ingestion.json`. This adds `Note Failure` and `Check Failures`, sets `onError` on 8 nodes, and wires the error outputs and `done`.
- Test: `tests/ingestion-workflow.test.js` (append)

**Interfaces:**
- Consumes: the `Preparing Chunks` throw from Task 6. The existing `Format for Insert` throw, `'Embedding API error for batch ' + i`, is unchanged.
- Produces:
  - `Note Failure` emits `{ kb_failure: { name, folder_path, error } }`.
  - `Check Failures` either returns `[{ json: { ok: true } }]` or throws `"<n> knowledge base file(s) were not ingested and will be retried on the next run:\n<folder_path>/<name>: <error>\n…"`. That message reaches the team through the workflow's existing `errorWorkflow`, which is `error-handling-ingestion`, whose `Build Error Report` uses `execution.error.message`.

Facts this relies on, read from the n8n 2.28.3 source:
- **Loop (`SplitInBatchesV3.node.ts`):** every item fed back into `Process One File` is added to `processedItems`, and `done` emits them all. So the `kb_failure` items reach `Check Failures` with no state store.
- **Postgres (`nodes/Postgres/v2/helpers/utils.ts`):** the default `single` batching joins the file's queries into one multi-statement string, which PostgreSQL runs as one implicit transaction. On error it returns exactly one error item.

- [ ] **Step 1: Append the failing tests**

Append to the end of `tests/ingestion-workflow.test.js`:

```js
const PER_FILE = [
  'Download Knowledge Base File',
  'Prepare Gemini Request',
  'Gemini Text Extraction',
  'Format Gemini Result',
  'Preparing Chunks',
  'Format for Insert',
  'Insert Into Postgres Knowledge Base',
];

test('every per-file node routes its errors to Note Failure', () => {
  for (const name of PER_FILE) {
    assert.strictEqual(byName(name).onError, 'continueErrorOutput', name);
    const outs = targets(name);
    assert.deepStrictEqual(outs[1], ['Note Failure'], name + ' error output');
    assert.ok(outs[0].length > 0, name + ' success output must stay wired');
  }
});

test('Generate Embeddings passes failed batches on instead of splitting the file', () => {
  assert.strictEqual(byName('Generate Embeddings').onError, 'continueRegularOutput');
  assert.deepStrictEqual(targets('Generate Embeddings'), [['Format for Insert']]);
  assert.ok(byName('Format for Insert').parameters.jsCode.includes("throw new Error('Embedding API error for batch '"),
    'Format for Insert must throw on a batch without embeddings');
});

test('Note Failure loops back and done goes to Check Failures', () => {
  assert.deepStrictEqual(targets('Note Failure'), [['Process One File']]);
  assert.deepStrictEqual(targets('Process One File'), [['Check Failures'], ['Download Knowledge Base File']]);
  assert.deepStrictEqual(targets('Insert Into Postgres Knowledge Base')[0], ['Process One File']);
});

test('Note Failure names the file from the loop, for string and object error shapes', () => {
  const code = byName('Note Failure').parameters.jsCode;
  const run = (err) => new Function('$', '$input', code)(
    () => ({ first: () => ({ json: { id: 'f1', name: 'Manual', folder_path: 'PARTNER 200' } }) }),
    { first: () => ({ json: err }) })[0].json.kb_failure;
  assert.deepStrictEqual(run({ error: 'Gemini API error' }),
    { name: 'Manual', folder_path: 'PARTNER 200', error: 'Gemini API error' });
  assert.strictEqual(run({ message: 'pg failed', error: { message: 'duplicate key' } }).error, 'duplicate key');
  assert.ok(code.includes("$('Process One File').first().json"));
});

test('Check Failures passes a clean run and throws one message naming every failed file', () => {
  const code = byName('Check Failures').parameters.jsCode;
  const run = (items) => new Function('$input', code)({ all: () => items.map((json) => ({ json })) });
  assert.deepStrictEqual(run([{ success: true }]), [{ json: { ok: true } }]);
  assert.throws(() => run([
    { success: true },
    { kb_failure: { name: 'Manual', folder_path: 'PARTNER 600', error: 'boom' } },
    { kb_failure: { name: 'Root doc', folder_path: '', error: 'bad pdf' } },
  ]), (err) => err.message ===
    '2 knowledge base file(s) were not ingested and will be retried on the next run:\n' +
    'PARTNER 600/Manual: boom\nRoot doc: bad pdf');
});

test('the insert stays in single-query batching, which is atomic per file', () => {
  // "single" concatenates the file's DELETE and INSERTs into one multi-statement
  // query: PostgreSQL runs it as one implicit transaction, and on failure the
  // node emits exactly one error item. "transaction" mode would emit success
  // items for rolled-back statements plus an error item, firing both outputs.
  const batching = byName('Insert Into Postgres Knowledge Base').parameters.options.queryBatching;
  assert.ok(batching === undefined || batching === 'single', 'queryBatching must stay single, got ' + batching);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/ingestion-workflow.test.js`
Expected: 5 of the 6 new tests FAIL. The first reports `Download Knowledge Base File` with `onError` undefined. `the insert stays in single-query batching…` already passes, and it is a guard against regression.

- [ ] **Step 3: Write the splice script**

`splice-failures.js` at the repo root:

```js
'use strict';
// One-off: a failing file is skipped and reported instead of aborting the batch.
// Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, 'workflows/ingestion.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (name) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('node not found: ' + name);
  return node;
};

// Each of these handles the file as one unit (one item in, or run once for all
// items), so a failure sends the file down the error output only.
const PER_FILE = [
  'Download Knowledge Base File',
  'Prepare Gemini Request',
  'Gemini Text Extraction',
  'Format Gemini Result',
  'Preparing Chunks',
  'Format for Insert',
  'Insert Into Postgres Knowledge Base',
];
for (const name of PER_FILE) {
  byName(name).onError = 'continueErrorOutput';
  wf.connections[name].main[1] = [{ node: 'Note Failure', type: 'main', index: 0 }];
}
// Generate Embeddings runs once per 100-chunk batch: with an error output, one
// file could fire both outputs. Failed batches flow on instead, and Format for
// Insert throws on the first batch without embeddings.
byName('Generate Embeddings').onError = 'continueRegularOutput';

const noteFailure = [
  '// Note Failure — one file failed somewhere in the per-file chain. Record why',
  '// and hand control back to Process One File so the rest of the batch runs.',
  "// Process One File's \"done\" output re-emits every item fed back into the loop,",
  '// so Check Failures finds these kb_failure items there.',
  "const file = $('Process One File').first().json || {};",
  'const err = $input.first().json || {};',
  'const e = err.error;',
  "const message = (typeof e === 'string' ? e : (e && (e.message || e.description))) ||",
  '  err.message || JSON.stringify(err).slice(0, 300);',
  'return [{',
  '  json: {',
  '    kb_failure: {',
  "      name: file.name || file.id || 'unknown',",
  "      folder_path: file.folder_path || '',",
  '      error: String(message).slice(0, 500),',
  '    },',
  '  },',
  '}];',
  '',
].join('\n');

const checkFailures = [
  '// Check Failures — runs once the loop is done. If any file failed this run,',
  '// fail the execution with one message naming them all: every good file is',
  "// already ingested, and the workflow's errorWorkflow emails the team.",
  'const failures = $input.all().map((item) => item.json.kb_failure).filter(Boolean);',
  'if (failures.length) {',
  "  throw new Error(failures.length + ' knowledge base file(s) were not ingested and will be retried on the next run:\\n' +",
  "    failures.map((f) => (f.folder_path ? f.folder_path + '/' : '') + f.name + ': ' + f.error).join('\\n'));",
  '}',
  'return [{ json: { ok: true } }];',
  '',
].join('\n');

wf.nodes.push(
  {
    parameters: { jsCode: noteFailure },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [5840, -976],
    id: 'b7d1e2f0-0003-4000-8000-00000000a003',
    name: 'Note Failure',
  },
  {
    parameters: { jsCode: checkFailures },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [4944, -1456],
    id: 'b7d1e2f0-0004-4000-8000-00000000a004',
    name: 'Check Failures',
  }
);

wf.connections['Note Failure'] = { main: [[{ node: 'Process One File', type: 'main', index: 0 }]] };
wf.connections['Process One File'].main[0] = [{ node: 'Check Failures', type: 'main', index: 0 }];

// ingestion.json is stored without a trailing newline.
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('ingestion.json: per-file failures skip and report');
```

- [ ] **Step 4: Run it and delete it**

```bash
node splice-failures.js && rm splice-failures.js
```

Expected output: `ingestion.json: per-file failures skip and report`.

- [ ] **Step 5: Run the suite**

Run: `node --test tests/`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add workflows/ingestion.json tests/ingestion-workflow.test.js
git commit -m "feat(ingestion): skip failing files and report them once per run"
```

---

### Task 8: Key chunk dedupe on `file_id`

**Files:**
- Create: `db/migrations/2026-09-27-documents-uniq-by-file-id.sql`
- Modify: `db/documents.sql` (the `documents_content_file_uniq` block)
- Test: `tests/db-schema.test.js`

- [ ] **Step 1: Write the failing test**

`tests/db-schema.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const KEY = "coalesce(metadata ->> 'file_id', metadata ->> 'original_file_name', '')";

test('the chunk dedupe index is keyed on file_id in the schema', () => {
  const sql = read('db/documents.sql');
  const block = sql.slice(sql.indexOf('create unique index documents_content_file_uniq'));
  assert.ok(block.slice(0, 200).includes(KEY), 'documents.sql must key the dedupe index on file_id');
  assert.ok(!sql.includes("coalesce(metadata ->> 'original_file_name', '')\n"), 'old name-only key is gone');
});

test('the migration rebuilds the index with the same key', () => {
  const sql = read('db/migrations/2026-09-27-documents-uniq-by-file-id.sql');
  assert.ok(sql.includes('drop index if exists public.documents_content_file_uniq;'));
  assert.ok(sql.includes('create unique index documents_content_file_uniq'));
  assert.ok(sql.includes(KEY));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/db-schema.test.js`
Expected: both tests FAIL. The first reports "documents.sql must key the dedupe index on file_id", and the second reports ENOENT for the migration.

- [ ] **Step 3: Write the migration**

`db/migrations/2026-09-27-documents-uniq-by-file-id.sql`:

```sql
-- =====================================================================
-- documents_content_file_uniq: key chunk dedupe on file_id, not file name.
--
-- The old key, md5(content) + original_file_name, silently dropped the
-- chunks of a second file with the same name and identical content -- the
-- ingestion INSERT is ON CONFLICT DO NOTHING. The knowledge base now holds
-- the same document in several machine folders, so the key has to be the
-- Drive file. original_file_name stays as the fallback for any row without
-- a file_id.
--
-- Run once against the production database before importing the updated
-- ingestion workflow. Idempotent.
-- =====================================================================

drop index if exists public.documents_content_file_uniq;

create unique index documents_content_file_uniq
  on public.documents (
    md5(content),
    coalesce(metadata ->> 'file_id', metadata ->> 'original_file_name', '')
  ) tablespace pg_default;
```

- [ ] **Step 4: Update the schema**

In `db/documents.sql`, replace this block:

```sql
-- Chunk-level dedupe within a file. coalesce() matters: without it,
-- rows missing original_file_name are all distinct under btree NULL
-- semantics and the constraint silently stops enforcing anything.
create unique index documents_content_file_uniq
  on public.documents (
    md5(content),
    coalesce(metadata ->> 'original_file_name', '')
  ) tablespace pg_default;
```

with:

```sql
-- Chunk-level dedupe within a file. Keyed on the Drive file, not its name:
-- the same document can sit in two machine folders under the same name, and
-- a name key would silently drop the second copy (the INSERT is ON CONFLICT
-- DO NOTHING). original_file_name is the fallback for rows without a file_id.
-- coalesce() matters: without it, rows missing both are all distinct under
-- btree NULL semantics and the constraint silently stops enforcing anything.
-- Existing databases: db/migrations/2026-09-27-documents-uniq-by-file-id.sql.
create unique index documents_content_file_uniq
  on public.documents (
    md5(content),
    coalesce(metadata ->> 'file_id', metadata ->> 'original_file_name', '')
  ) tablespace pg_default;
```

- [ ] **Step 5: Run the suite**

Run: `node --test tests/`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-09-27-documents-uniq-by-file-id.sql db/documents.sql tests/db-schema.test.js
git commit -m "fix(db): key chunk dedupe on file_id so same-name files both survive"
```

---

### Task 9: Teach both answering prompts the folder label

**Files:**
- Modify: `workflows/agent.json`. This touches `Build Prompt` rule 3 and `AI Agent1` rule 4.
- Test: `tests/agent-workflow.test.js` (append)

The rule is appended to the existing product-matching rule in each prompt; no rule is renumbered. It contains no apostrophe, because in `Build Prompt` it sits inside a single-quoted JS string. That Code node's source spells the em dash as the escape `—`, and the splice writes it the same way.

- [ ] **Step 1: Append the failing test**

Append to the end of `tests/agent-workflow.test.js`:

```js
test('both answering prompts explain the [FOLDER] chunk label', () => {
  const FOLDER_RULE = 'Each document begins with the folder it came from in square brackets, e.g. [PARTNER 200]. ' +
    'A document from a machine folder applies only to that machine — never apply it to another machine. ' +
    '[DOCUMENTATIE COMUNA] applies to all machines.';

  // Build Prompt: run the Code node's string-building and read the real prompt.
  const code = byName('Build Prompt').parameters.jsCode;
  const stub = (name) => ({
    first: () => ({ json: name === 'Unified Input' ? { question: 'q', sessionId: 's', from: 'f' } : { response: 'docs' } }),
    all: () => [],
  });
  const system = new Function('$', code)(stub)[0].json.system;
  assert.ok(system.includes('3. When the documentation contains product-specific info (e.g. Partner 200, Partner 600), ' +
    'ensure your answer matches the correct product. ' + FOLDER_RULE));

  const message = byName('AI Agent1').parameters.options.systemMessage;
  assert.ok(message.includes('4. When the documentation contains product-specific info (e.g. Partner 200, Partner 600), ' +
    'ensure your answer matches the correct product. ' + FOLDER_RULE + '\n'));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/agent-workflow.test.js`
Expected: `both answering prompts explain the [FOLDER] chunk label` FAILS, and every other test passes.

- [ ] **Step 3: Write the splice script**

`splice-agent.js` at the repo root:

```js
'use strict';
// One-off: teaches both answering prompts what the [FOLDER] chunk label means.
// Run from the repo root, then delete.
const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, 'workflows/agent.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (name) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error('node not found: ' + name);
  return node;
};
function replaceOnce(text, anchor, replacement, where) {
  const count = text.split(anchor).length - 1;
  if (count !== 1) throw new Error(where + ': expected 1 match, found ' + count);
  return text.replace(anchor, replacement);
}

// No apostrophes: in Build Prompt this sits inside a single-quoted JS string.
const FOLDER_RULE = 'Each document begins with the folder it came from in square brackets, e.g. [PARTNER 200]. ' +
  'A document from a machine folder applies only to that machine — never apply it to another machine. ' +
  '[DOCUMENTATIE COMUNA] applies to all machines.';
const PRODUCT_RULE = 'When the documentation contains product-specific info (e.g. Partner 200, Partner 600), ' +
  'ensure your answer matches the correct product.';

// Build Prompt: rule 3 is a JS string literal in the Code node; its source
// spells the em dash as the escape —, so write it the same way.
const bp = byName('Build Prompt');
bp.parameters.jsCode = replaceOnce(bp.parameters.jsCode,
  "'3. " + PRODUCT_RULE + "',",
  "'3. " + PRODUCT_RULE + ' ' + FOLDER_RULE.replace('—', '\\u2014') + "',",
  'Build Prompt rule 3');

// AI Agent1: rule 4 is plain text in the system message.
const agent = byName('AI Agent1');
agent.parameters.options.systemMessage = replaceOnce(agent.parameters.options.systemMessage,
  '4. ' + PRODUCT_RULE + '\n',
  '4. ' + PRODUCT_RULE + ' ' + FOLDER_RULE + '\n',
  'AI Agent1 rule 4');

// agent.json is stored with a trailing newline.
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n');
console.log('agent.json: folder rule added to Build Prompt and AI Agent1');
```

- [ ] **Step 4: Run it and delete it**

```bash
node splice-agent.js && rm splice-agent.js
```

Expected output: `agent.json: folder rule added to Build Prompt and AI Agent1`.

- [ ] **Step 5: Run the suite and check the diff**

Run: `node --test tests/`
Expected: `# fail 0`.

Run: `git diff --stat workflows/agent.json`
Expected: `1 file changed, 2 insertions(+), 2 deletions(-)`.

- [ ] **Step 6: Commit**

```bash
git add workflows/agent.json tests/agent-workflow.test.js
git commit -m "feat(agent): explain the [FOLDER] chunk label in both answer prompts"
```

---

### Task 10: Deploy and verify on the live instance

This task runs against production n8n and Postgres, so **the human partner runs it or approves each step**. Nothing here changes the repo.

- [ ] **Step 1: Precondition, the old folder's contents**

Confirm with the human partner that everything in the old `documentation` folder (`1-y3bvqtTXEj2Vyl-lC5Em6aISbtqCcbm`) that should stay has been copied into the new root. The first run deletes every `knowledge_base` row whose file is not under the new root.

- [ ] **Step 2: Apply the index migration**

First run the **pre-check** query from the migration's header. It must return no rows. If it returns any, those are rows sharing a `file_id` under two names; decide which copy to keep before going on.

Then run `db/migrations/2026-09-27-documents-uniq-by-file-id.sql` against the production database. It swaps the index in one transaction, so if the `CREATE` fails the old index stays in place. Then check:

```sql
select indexdef from pg_indexes where indexname = 'documents_content_file_uniq';
```

Expected: the definition contains `COALESCE((metadata ->> 'file_id'::text), (metadata ->> 'original_file_name'::text), ''::text)`.

- [ ] **Step 3: Import with the schedule off**

In n8n, deactivate the `ingestion` workflow. Import `workflows/ingestion.json` over it, and import `workflows/agent.json` over `agent`. In the ingestion workflow, open `Drive: All Folders` and confirm it shows the `Google Drive account` credential.

- [ ] **Step 4: Force one failure, to prove skip-and-report**

Make a corrupt PDF from any real one: `head -c 2000 any.pdf > broken-test.pdf`. Upload it to `DOCUMENTATIE COMUNA`. It keeps the `%PDF` header, so Drive stores it as `application/pdf` and it passes the allowlist. Its body is cut off, so Gemini or `Format Gemini Result` rejects it.

A text file renamed to `.pdf` is not reliable for this. Drive may detect it as `text/plain`, and the manifest would then skip it before it could fail.

- [ ] **Step 5: Run the sync once by hand, off-hours**

Open the ingestion workflow and run it from `Sync Trigger`. Expect 15–40 minutes for about 30 files.

Expected:
- the execution ends **failed** at `Check Failures`;
- the error shown on `Check Failures` in the execution view names `DOCUMENTATIE COMUNA/broken-test.pdf`, which confirms that `Note Failure`'s `$('Process One File').first()` resolves the right file;
- every other file was processed;
- **no email arrives.** n8n 2.28.3 never runs the error workflow for executions started by hand (`execution-lifecycle-hooks.ts`: every `executeErrorWorkflow` call is guarded by `!isManualMode`). This is expected, not a fault.

If the error names a different file, stop. Change `Note Failure` to read `$('Process One File').first(1)` (the loop output) instead, and re-run.

- [ ] **Step 6: Check the knowledge base**

```sql
select metadata->>'folder' as folder, count(*) from documents
where metadata->>'source' = 'knowledge_base' group by 1 order by 1;
```

Expected: one row per subfolder that has supported files. That is `DOCUMENTATIE COMUNA`, `PARTNER 200`, `PARTNER 300`, `PARTNER 600`, `PARTNER PF 80K`, `PARTNER TOUCH EVO` and `TASTATURI VIRTUALE`, with no row for the old flat folder.

```sql
select metadata->>'folder_path', count(*) from documents
where content like '%intervale serii care functioneaza cu memorii fiscale FLASH%'
group by 1;
```

Expected: two rows, `PARTNER 200` and `PARTNER 600`.

```sql
select content from documents
where metadata->>'original_file_name' = 'Procedura de update firmware cu ajutorul unui memory stick';
```

Expected: one chunk starting `[DOCUMENTATIE COMUNA] Procedura de update firmware cu ajutorul unui memory stick — `, with the procedure's steps on separate lines.

- [ ] **Step 7: Clean up and re-run**

Delete `broken-test.pdf` from Drive and run the sync once more by hand. Expected: it succeeds, and the work list is empty or near-empty because nothing changed.

- [ ] **Step 8: Ask the bot**

Over WhatsApp, ask the same question for two machines, for example how to change the VAT rates ("cote TVA") on a Partner 200, and then on a Partner 600. Expected: each answer uses that machine's documents and/or `DOCUMENTATIE COMUNA`, and never the other machine's.

- [ ] **Step 9: Turn the schedule back on**

Reactivate the `ingestion` workflow.

- [ ] **Step 10: Prove the failure email on a scheduled run**

Runs started by hand never send the email (see Step 5), so the email path is only proven by a scheduled run. Upload `broken-test.pdf` to `DOCUMENTATIE COMUNA` again and wait for the next scheduled run, at most 30 minutes.

Expected: the team receives one error email whose message names `DOCUMENTATIE COMUNA/broken-test.pdf`. Then delete the file from Drive. The next scheduled run succeeds and sends no email.
