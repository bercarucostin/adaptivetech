'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sharedBlock } = require('./helpers/shared-block.js');

const ROOT = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/ingestion.json'), 'utf8'));
const byName = (name) => wf.nodes.find((n) => n.name === name);
const targets = (name) => ((wf.connections[name] || {}).main || [])
  .map((out) => (out || []).map((c) => c.node));

test('the old validated-numbers chain is gone', () => {
  for (const gone of ['Drive: Validated Numbers', 'Get row(s) in sheet', 'Insert or Update Validated Numbers']) {
    assert.strictEqual(byName(gone), undefined, `${gone} should be deleted`);
    assert.strictEqual(wf.connections[gone], undefined, `${gone} should have no connections`);
  }
  const json = JSON.stringify(wf);
  assert.ok(!json.includes('Insert or Update Validated Numbers'), 'no dangling references');
});

test('the new sync chain exists and is wired in order', () => {
  assert.ok(byName('Drive: Technicians'));
  assert.ok(byName('Get Technicians Sheet'));
  assert.ok(byName('Count Mirror'));
  assert.ok(byName('Build Sync Batch'));
  assert.ok(byName('Sync Technicians'));

  assert.deepStrictEqual(targets('Drive: Technicians'), [['Get Technicians Sheet']]);
  assert.deepStrictEqual(targets('Get Technicians Sheet'), [['Count Mirror']]);
  assert.deepStrictEqual(targets('Count Mirror'), [['Build Sync Batch']]);
  assert.deepStrictEqual(targets('Build Sync Batch'), [['Sync Technicians']]);
});

test('Count Mirror counts the pre-wipe mirror and shares the Sync Technicians credential', () => {
  const node = byName('Count Mirror');
  assert.strictEqual(node.parameters.operation, 'executeQuery');
  assert.match(node.parameters.query, /count\(\*\).*FROM technicians/is);
  assert.strictEqual(node.typeVersion, 2.5);
  assert.strictEqual(node.retryOnFail, true);
  assert.strictEqual(
    node.credentials.postgres.id,
    byName('Sync Technicians').credentials.postgres.id,
    'Count Mirror must read the same database Sync Technicians writes to'
  );
});

test('Count Mirror runs once, not once per sheet row', () => {
  // Get Technicians Sheet emits one item per row (~476); without executeOnce,
  // Count Mirror -- and the count query it runs -- fires once per item.
  const node = byName('Count Mirror');
  assert.strictEqual(node.executeOnce, true);
});

test('the Drive trigger points at a real configured file', () => {
  const id = byName('Drive: Technicians').parameters.fileToWatch.value;
  assert.match(id, /^[A-Za-z0-9_-]{20,}$/, 'a real Drive file ID must be filled in');
});

test('Sync Technicians retries and is parameterised, not interpolated', () => {
  const node = byName('Sync Technicians');
  assert.strictEqual(node.retryOnFail, true);
  const q = node.parameters.query;
  assert.ok(q.includes('$1::jsonb'), 'payload must ride in a bind parameter');
  assert.ok(q.includes('DELETE FROM technicians'));
  assert.ok(q.includes('sigiliu IS NOT NULL'), 'NULL-sigiliu rows must survive cleanup');
  assert.ok(/NOT EXISTS \(SELECT 1 FROM canon/.test(q), 'cleanup compares against canon, not technicians');
  assert.ok(q.includes('DISTINCT ON (sigiliu)'), 'MA 050 needs a deterministic tie-break');
});

test('the orphan cleanup never deletes a revoked (is_active = false) row', () => {
  // A revoked row must survive as a tombstone so a phone that re-sends any
  // currently-valid sigiliu still routes to the refusal branch, not back to
  // "unknown -> re-validate with is_active defaulting to true".
  const q = byName('Sync Technicians').parameters.query;
  const orphanClause = q.slice(q.indexOf('orphaned AS'), q.indexOf('refreshed AS'));
  assert.ok(/DELETE FROM validated_numbers/.test(orphanClause));
  assert.ok(/AND\s+v\.is_active/.test(orphanClause),
    'orphan DELETE must require is_active so revoked rows are not un-revoked by leaving the sheet');
});

test('Build Sync Batch embeds lib/sync-batch.js verbatim', () => {
  assert.ok(byName('Build Sync Batch').parameters.jsCode.includes(sharedBlock('lib/sync-batch.js')),
    'Code node has drifted from lib/sync-batch.js');
});

test('the floor is set to 100 and the mirror count is wired through unambiguously', () => {
  const code = byName('Build Sync Batch').parameters.jsCode;
  // $json is undefined in "Run Once for All Items" mode (this node's mode); only
  // $input.first().json resolves the count unambiguously -- see the sibling
  // "Extract Sigiliu" glue in workflows/agent.json for the same precedent.
  assert.match(code, /buildSyncBatch\(rows,\s*100,\s*mirrorCount\)/);
  assert.ok(code.includes("$input.first().json.mirror_count"),
    'the mirror count must be read via $input.first().json, not the per-item $json shorthand');
  assert.ok(!/\$json\.mirror_count/.test(code),
    'the ambiguous $json.mirror_count form must not reappear');
});

test('Build Sync Batch fails loudly instead of silently defaulting when mirror_count is unusable', () => {
  const code = byName('Build Sync Batch').parameters.jsCode;
  assert.ok(/Number\.isFinite\(mirrorCount\)/.test(code),
    'an unusable mirror_count must be rejected before reaching buildSyncBatch, ' +
    'otherwise the library default of 0 silently disables the proportional guard');
  assert.ok(/throw new Error/.test(code.slice(code.indexOf('mirrorCount'))),
    'the validation must throw, not fall through');
});

test('Build Sync Batch reads sheet rows from Get Technicians Sheet, not its direct input', () => {
  // Count Mirror now sits between Get Technicians Sheet and Build Sync Batch, so
  // Build Sync Batch's direct input ($input) is the mirror count, not the rows.
  const glue = byName('Build Sync Batch').parameters.jsCode;
  assert.ok(glue.includes("$('Get Technicians Sheet').all()"),
    'rows must be pulled explicitly from Get Technicians Sheet');
  assert.ok(!/const rows = \$input\.all\(\)/.test(glue),
    'reading rows from $input would read the mirror count instead, once Count Mirror is upstream');
});

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

test('an empty file listing still reaches the zero-files guard', () => {
  // With no items, Build Drive Manifest would never run and the run would end
  // "successfully" with nothing ingested and no alert -- e.g. at rollout, if
  // the credential cannot see the new root. alwaysOutputData emits one empty
  // item, which buildManifest ignores, so the guard throws.
  assert.strictEqual(byName('Drive: Knowledge Base').alwaysOutputData, true);
  const { buildManifest } = require('../lib/drive-manifest.js');
  assert.throws(() => buildManifest([{}], {}), /Refusing to run the orphan sweep/);
});
