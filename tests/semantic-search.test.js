'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  embedRequest, searchParams, buildSearchSql, SEARCH_SQL,
  SEARCH_K, SEARCH_POOL, CONTEXT_WEIGHT, SHARED_SLOTS, SHARED_MARGIN, EMBED_DIMS,
} = require('../lib/semantic-search.js');

const vec = (x) => Array.from({ length: EMBED_DIMS }, () => x);

test('one question makes one embedding request', () => {
  const body = embedRequest('cum schimb memoria fiscala', '');
  assert.strictEqual(body.requests.length, 1);
  assert.deepStrictEqual(body.requests[0], {
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text: 'cum schimb memoria fiscala' }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: EMBED_DIMS,
  });
});

test('a question with context makes two embedding requests, question first', () => {
  const body = embedRequest('Dar P300?', 'Se pot schimba cotele de tva la P200?\nDar P300?');
  assert.deepStrictEqual(body.requests.map((r) => r.content.parts[0].text),
    ['Dar P300?', 'Se pot schimba cotele de tva la P200?\nDar P300?']);
});

test('searchParams normalizes both vectors and leaves the context empty when there is none', () => {
  const one = searchParams([{ values: vec(2) }], undefined);
  const v = JSON.parse(one.vector);
  assert.strictEqual(v.length, EMBED_DIMS);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9, 'unit length');
  assert.strictEqual(one.context_vector, '');
  assert.strictEqual(one.filter, '{}');

  const two = searchParams([{ values: vec(1) }, { values: vec(3) }], { folder: 'PARTNER 200' });
  assert.ok(Math.abs(Math.hypot(...JSON.parse(two.context_vector)) - 1) < 1e-9);
  assert.strictEqual(two.filter, '{"folder":"PARTNER 200"}');
});

test('searchParams refuses an embedding of the wrong size', () => {
  assert.throws(() => searchParams([{ values: [1, 2, 3] }], '{}'), /3 dims, expected 1536/);
  assert.throws(() => searchParams(undefined, '{}'), /Embedding failed/);
});

test('the search SQL fuses two rankings and keeps slots for shared folders', () => {
  assert.strictEqual(SEARCH_K, 15);
  assert.strictEqual(SEARCH_POOL, 50);
  assert.strictEqual(CONTEXT_WEIGHT, 0.3);
  assert.strictEqual(SHARED_SLOTS, 3);
  assert.ok(SEARCH_SQL.includes("nullif($2, '')::vector(1536)"), 'the context vector is optional');
  assert.ok(SEARCH_SQL.includes('0.7 / (50 + a.rk)') && SEARCH_SQL.includes('0.3 / (50 + c.rk)'), 'weighted RRF');
  assert.ok(SEARCH_SQL.includes("join kb_folders k on k.folder = d.metadata->>'folder' and k.kind = 'shared'"));
  assert.ok(SEARCH_SQL.includes('limit 3'), 'three shared slots');
  assert.ok(SEARCH_SQL.includes('0.7 * (d.embedding <=> p.v) + 0.3 * (d.embedding <=> coalesce(p.cv, p.v))'),
    'shared slots are ranked with the context too, so "partner 600" after a question finds that topic');
  assert.ok(!/websearch_to_tsquery|ts_rank|fts/.test(SEARCH_SQL), 'no keyword branch');
});

test('SEARCH_SQL is the builder with the chosen shared margin', () => {
  // 0.03: shared docs still reach every question that needs them, with or without an
  // unrelated earlier message, and irrelevant ones no longer push product chunks out.
  assert.strictEqual(SHARED_MARGIN, 0.03);
  assert.strictEqual(SEARCH_SQL, buildSearchSql({ sharedMargin: SHARED_MARGIN }));
  assert.ok(SEARCH_SQL.includes('where dist <= (select worst from cutoff) + 0.03'));
});

test('without a margin the shared slots are always filled', () => {
  const sql = buildSearchSql({ sharedMargin: null });
  assert.ok(!sql.includes('worst'));
});

test('with a margin a shared chunk must be about as close as the list it joins', () => {
  const sql = buildSearchSql({ sharedMargin: 0.02 });
  assert.ok(sql.includes('max(0.7 * (d.embedding <=> p.v) + 0.3 * (d.embedding <=> coalesce(p.cv, p.v))) as worst'),
    'the cutoff is the farthest chunk already in the list, measured the same way');
  assert.ok(sql.includes('where dist <= (select worst from cutoff) + 0.02'));
});
