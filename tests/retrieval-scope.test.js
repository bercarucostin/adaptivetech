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
