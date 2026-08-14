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
  const src = fs.readFileSync(path.join(ROOT, 'lib/sync-batch.js'), 'utf8');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  assert.ok(start !== -1 && end > start, 'SHARED markers missing');
  const shared = src.slice(start, end);
  assert.ok(byName('Build Sync Batch').parameters.jsCode.includes(shared),
    'Code node has drifted from lib/sync-batch.js');
});

test('the floor is set to 100 and the mirror count is wired through', () => {
  const code = byName('Build Sync Batch').parameters.jsCode;
  assert.match(code, /buildSyncBatch\(rows,\s*100,\s*\$json\.mirror_count\)/);
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
