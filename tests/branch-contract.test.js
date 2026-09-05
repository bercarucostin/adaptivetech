'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

const tracked = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

// The whole point of this branch is that these stay on partner-prod. A
// careless merge or `git checkout partner-prod -- .` reintroduces them,
// and every other test on this branch would still pass.
const FORBIDDEN = [
  'workflows/agent.json',
  'workflows/conversations-report.json',
  'lib/sigiliu.js',
  'lib/sync-batch.js',
  'tests/sigiliu.test.js',
  'tests/sync-batch.test.js',
  'tests/agent-workflow.test.js',
  'db/technicians.sql',
  'db/validated_numbers.sql',
  'db/wa_message_links.sql',
  'db/wa_reaction_links.sql',
  'Tabel tehnicieni pentru Robotel.ods',
];

test('no client-specific file has returned to the branch', () => {
  const files = tracked();
  for (const forbidden of FORBIDDEN) {
    assert.ok(!files.includes(forbidden), forbidden + ' must stay on partner-prod');
  }
});

test('no tracked file names the client or leaks a sigiliu', () => {
  for (const file of tracked()) {
    // The plans and spec discuss the separation itself, by necessity, and
    // this file must name what it forbids in order to forbid it. Every
    // other file, including every other test, is scanned.
    if (file.startsWith('docs/') || file === 'tests/branch-contract.test.js') continue;
    const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!/robotel/i.test(body), file + ' names the client');
    assert.ok(!/\bsigiliu/i.test(body), file + ' mentions sigiliu');
    // Sigiliu format: two letters, optional separator, three digits.
    assert.ok(
      !/\b(?:DE|LA|CU|AM|PN|WR)[ ._-]?\d{3}\b/.test(body),
      file + ' appears to contain a sigiliu code'
    );
  }
});

test('every workflow file is valid JSON with a consistent graph', () => {
  const dir = path.join(ROOT, 'workflows');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 5, 'expected at least five workflows');
  for (const file of files) {
    const wf = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(Array.isArray(wf.nodes), file + ' has no nodes array');
    assert.ok(wf.nodes.length > 0, file + ' has no nodes');
    // A truncated re-export usually shows up as an edge to a missing node.
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [src, conn] of Object.entries(wf.connections || {})) {
      assert.ok(names.has(src), file + ': connection from missing node ' + src);
      for (const out of conn.main || []) {
        for (const c of out || []) {
          assert.ok(names.has(c.node), file + ': edge to missing node ' + c.node);
        }
      }
    }
  }
});

test('the 1536-dimension contract agrees across schema, function and workflows', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

  // The column type is the real dimension guard.
  assert.match(read('db/documents.sql'), /embedding\s+vector\(1536\)/,
    'documents.embedding must be vector(1536)');

  // The search function must take the same width.
  assert.match(read('db/hybrid_search.sql'), /query_embedding\s+vector\(1536\)/,
    'hybrid_search must accept vector(1536)');

  // Ingestion must request that width from the embedding API.
  assert.match(read('workflows/ingestion.json'), /outputDimensionality[^0-9]{0,12}1536/,
    'ingestion must request outputDimensionality 1536');

  // And the retrieval tool must both request and assert it.
  const tool = read('workflows/hybrid-search-tool.json');
  assert.match(tool, /outputDimensionality[^0-9]{0,12}1536/,
    'hybrid-search-tool must request outputDimensionality 1536');
  assert.match(tool, /EXPECTED_DIMS\s*=\s*1536/,
    'hybrid-search-tool must assert 1536 dims before building the query');
  assert.match(tool, /vector\(1536\)/,
    'hybrid-search-tool must cast to vector(1536)');
});
