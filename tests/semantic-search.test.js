'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  embedRequest, searchParams, keywordQuery, buildSearchSql, SEARCH_SQL,
  SEARCH_K, SEARCH_POOL, CONTEXT_WEIGHT, KEYWORD_WEIGHT, SHARED_SLOTS, SHARED_MARGIN, EMBED_DIMS,
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

test('keywordQuery matches any word, without diacritics or punctuation', () => {
  assert.strictEqual(keywordQuery('Cum se exportă XML-ul pe stick?'), 'Cum or se or exporta or XML or ul or pe or stick');
  assert.strictEqual(keywordQuery('eroare 111-ERR PPP'), 'eroare or 111 or ERR or PPP');
  // single letters dropped; "or" is websearch_to_tsquery's operator, so dropped too
  assert.strictEqual(keywordQuery('Ș ț â "or" (x) OR'), '');
  assert.strictEqual(keywordQuery(''), '');
  assert.strictEqual(keywordQuery(undefined), '');
});

test('searchParams carries the keyword query of the question', () => {
  assert.strictEqual(searchParams([{ values: vec(1) }], '{}', 'Eroare 40?').keywords, 'Eroare or 40');
  assert.strictEqual(searchParams([{ values: vec(1) }], '{}').keywords, '');
});

test('searchParams refuses an embedding of the wrong size', () => {
  assert.throws(() => searchParams([{ values: [1, 2, 3] }], '{}'), /3 dims, expected 1536/);
  assert.throws(() => searchParams(undefined, '{}'), /Embedding failed/);
});

test('the search SQL fuses three rankings and keeps slots for shared folders', () => {
  // 20 chunks and a keyword branch at 0.1: answers needing several facts complete
  // in 67% of the evaluation set instead of 57% (62% vs 43% with an unrelated
  // earlier message), with no answer lost and exact terms still ranked first.
  assert.strictEqual(SEARCH_K, 20);
  assert.strictEqual(SEARCH_POOL, 50);
  assert.strictEqual(CONTEXT_WEIGHT, 0.3);
  assert.strictEqual(KEYWORD_WEIGHT, 0.1);
  assert.strictEqual(SHARED_SLOTS, 3);
  assert.ok(SEARCH_SQL.includes("nullif($2, '')::vector(1536)"), 'the context vector is optional');
  assert.ok(SEARCH_SQL.includes('(case when p.cv is null then 0.9 else 0.63 end) / (50 + a.rk)'),
    'the question alone gets all the semantic weight when there is no context');
  assert.ok(SEARCH_SQL.includes('0.27 / (50 + c.rk)') && SEARCH_SQL.includes('0.1 / (50 + w.rk)'), 'weighted RRF');
  assert.ok(!/ [01] \/ \(/.test(SEARCH_SQL), 'no integer weight: SQL would divide integers and tie every score');
  assert.ok(SEARCH_SQL.includes("websearch_to_tsquery('romanian', $4)"), 'any-word keyword query from searchParams');
  assert.ok(SEARCH_SQL.includes("to_tsvector('romanian', translate(d.content, 'ăâîșşțţĂÂÎȘŞȚŢ', 'aaissttAAISSTT'))"),
    'diacritics removed on the document side too');
  assert.ok(SEARCH_SQL.includes('limit 20\n)'), 'twenty chunks');
  assert.ok(SEARCH_SQL.includes("join kb_folders k on k.folder = d.metadata->>'folder' and k.kind = 'shared'"));
  assert.ok(SEARCH_SQL.includes('limit 3'), 'three shared slots');
  assert.ok(SEARCH_SQL.includes('0.7 * (d.embedding <=> p.v) + 0.3 * (d.embedding <=> coalesce(p.cv, p.v))'),
    'shared slots are ranked with the context too, so "partner 600" after a question finds that topic');
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
