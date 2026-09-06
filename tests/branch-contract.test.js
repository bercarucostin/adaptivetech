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
  // The WhatsApp bot's own workflows. They belong to a different product
  // that shares no deployment, no database and no n8n instance with the
  // demo, and they were only ever here because this branch was cut from
  // main. Their node shapes are pinned into tools/build-demo-workflows.js
  // where the demo needed them, so nothing here depends on the files.
  'workflows/ingestion.json',
  'workflows/hybrid-search-tool.json',
  'workflows/db-cleanup.json',
  'workflows/error-handling-ingestion.json',
  'workflows/error-handling-agent.json',
  'tests/ingestion-workflow.test.js',
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
  assert.match(read('db/demo_schema.sql'), /embedding\s+vector\(1536\)/,
    'demo_documents.embedding must be vector(1536)');

  // The search function must take the same width.
  assert.match(read('db/demo_hybrid_search.sql'), /query_embedding\s+vector\(1536\)/,
    'demo_hybrid_search must accept vector(1536)');

  // Both sides of the demo must ask the embedding API for that same width.
  // A mismatch does not error anywhere: Postgres rejects the insert, or -- far
  // worse -- the two sides agree with each other but disagree with the column,
  // and every search silently returns nothing.
  assert.match(read('workflows/demo-upload.json'), /outputDimensionality[^0-9]{0,12}1536/,
    'demo-upload must request outputDimensionality 1536 when embedding chunks');
  assert.match(read('workflows/demo-chat.json'), /outputDimensionality[^0-9]{0,12}1536/,
    'demo-chat must request outputDimensionality 1536 when embedding the query');
});

test('embeddings are normalised on both sides of the demo', () => {
  // The paired invariant to the dimension above, and the one with no symptom.
  // gemini-embedding-001 returns unit vectors only at 3072 dims; at 1536 they
  // come back unnormalised, and demo_hybrid_search assumes unit length. Drop
  // this on either side and cosine distance quietly ranks by magnitude --
  // retrieval still returns results, just subtly wrong ones.
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  for (const file of ['workflows/demo-upload.json', 'workflows/demo-chat.json']) {
    assert.match(read(file), /l2normalize/,
      file + ' must L2-normalise embeddings before use');
  }
});

// The isolation guarantee, asserted rather than trusted. Both halves below
// would still pass every other test on this branch if they regressed, and
// both would serve one visitor's document to another.
//
// The naive form of this check -- "any query naming demo_uploads must name
// session_id" -- is wrong, and rejecting it is the point. demo-upload's
// status writes address a row by an upload_id the workflow minted itself
// moments earlier for the verified session; that id never came from the
// caller, and requiring a redundant session_id clause there would be
// cargo-culting the shape of the rule instead of the rule.
//
// What actually matters is where the value comes from.

const SCOPED_TABLES = ['demo_uploads', 'demo_documents', 'demo_messages'];

function demoWorkflows() {
  const dir = path.join(ROOT, 'workflows');
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('demo-'))
    .map((f) => ({ file: f, wf: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

test('no query takes an identifier from the request body without scoping it', () => {
  for (const { file, wf } of demoWorkflows()) {
    for (const node of wf.nodes) {
      const p = node.parameters || {};
      if (typeof p.query !== 'string') continue;
      const params = JSON.stringify(p.options || {});
      // A parameter read off the request body is attacker-chosen. Paired with
      // a per-visitor table it MUST also be paired with the session id from
      // the verified token -- that is what makes a guessed id return nothing.
      if (!/\.body\b/.test(params)) continue;
      if (!SCOPED_TABLES.some((t) => p.query.includes(t))) continue;
      assert.ok(
        /session_id/.test(p.query),
        file + ' / ' + node.name +
          ': uses a request-body value against a per-visitor table without session_id'
      );
    }
  }
});

test('every read of per-visitor data is scoped to the session', () => {
  for (const { file, wf } of demoWorkflows()) {
    // The hourly purge is the one legitimate cross-session statement: it
    // deletes BY EXPIRY across every visitor, which is its entire job.
    if (file === 'demo-cleanup.json') continue;
    for (const node of wf.nodes) {
      const query = (node.parameters || {}).query;
      if (typeof query !== 'string' || !/^\s*(WITH|SELECT)/i.test(query)) continue;
      for (const table of SCOPED_TABLES) {
        if (!query.includes(table)) continue;
        assert.ok(
          /session_id/.test(query),
          file + ' / ' + node.name + ': reads ' + table + ' without naming session_id'
        );
      }
    }
  }
});

test('no route reads a session id from the request body', () => {
  // The session id has exactly one origin: the signed cookie, via
  // demo-verify-session. A body-supplied session_id anywhere would make the
  // whole token scheme decorative.
  for (const { file, wf } of demoWorkflows()) {
    const body = JSON.stringify(wf);
    assert.ok(
      !/body\.session_id|body\)\.session_id|body\["session_id"\]/.test(body),
      file + ' reads session_id from the request body'
    );
  }
});

test('per-address limits count the inbox, not the alias', () => {
  // citext only folds case. you+1@gmail.com and you+2@gmail.com are distinct
  // rows delivered to one inbox, as is y.o.u@gmail.com -- so a quota keyed on
  // the raw address is satisfied indefinitely from a single free mailbox,
  // legitimately, with nothing about it resembling an attack.
  //
  // Any query that enforces a limit, or honours an unsubscribe, must go
  // through demo_canonical_email. Reverting one to `email = $1` would pass
  // every other test here and quietly reopen it.
  const MUST_CANONICALISE = [
    ['demo-request-code.json', 'Check Quota'],
    ['demo-verify-code.json', 'Upsert Lead'],
    ['demo-unsubscribe.json', 'Suppress Address'],
  ];
  for (const [file, node] of MUST_CANONICALISE) {
    const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
    const n = wf.nodes.find((x) => x.name === node);
    assert.ok(n, file + ': node "' + node + '" is missing');
    assert.match(
      n.parameters.query, /demo_canonical_email/,
      file + ' / ' + node + ' compares raw addresses, so aliases bypass it'
    );
  }
});

test('the canonicalisation is derived by the database, not by a workflow', () => {
  // A workflow can forget to canonicalise; a generated column cannot, and no
  // caller can supply a value for one. That is the whole reason this lives in
  // SQL rather than in a Code node.
  const sql = fs.readFileSync(path.join(ROOT, 'db', 'demo_email_canonical.sql'), 'utf8');
  for (const table of ['demo_sessions', 'demo_email_codes', 'demo_suppressions']) {
    const re = new RegExp(
      'alter table public\\.' + table + '[\\s\\S]{0,200}?generated always as', 'i'
    );
    assert.match(sql, re, table + ' has no generated email_canonical column');
  }
  assert.match(sql, /immutable/i,
    'demo_canonical_email must be IMMUTABLE or a generated column cannot use it');
  // Dots are Google-specific. Stripping them everywhere would merge
  // first.last@ and firstlast@, who are different people almost everywhere.
  assert.match(sql, /gmail\.com', 'googlemail\.com'/,
    'dot-stripping must be scoped to Google domains');
});
