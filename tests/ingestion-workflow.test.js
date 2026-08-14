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
  assert.ok(byName('Build Sync Batch'));
  assert.ok(byName('Sync Technicians'));

  assert.deepStrictEqual(targets('Drive: Technicians'), [['Get Technicians Sheet']]);
  assert.deepStrictEqual(targets('Get Technicians Sheet'), [['Build Sync Batch']]);
  assert.deepStrictEqual(targets('Build Sync Batch'), [['Sync Technicians']]);
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

test('Build Sync Batch embeds lib/sync-batch.js verbatim', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/sync-batch.js'), 'utf8');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  assert.ok(start !== -1 && end > start, 'SHARED markers missing');
  const shared = src.slice(start, end);
  assert.ok(byName('Build Sync Batch').parameters.jsCode.includes(shared),
    'Code node has drifted from lib/sync-batch.js');
});

test('the floor is set to 100', () => {
  assert.match(byName('Build Sync Batch').parameters.jsCode, /buildSyncBatch\(rows,\s*100\)/);
});
