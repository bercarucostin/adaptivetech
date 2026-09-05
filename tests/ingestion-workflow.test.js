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

test('the client-specific technicians sync is absent from the generic ingestion', () => {
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
  for (const term of ['technician', 'tehnicien']) {
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
