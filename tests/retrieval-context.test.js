'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { historyFromRows, searchRequest, folderRule, CONTEXT_CHARS } = require('../lib/retrieval-context.js');

const FOLDERS = [
  { folder: 'DOCUMENTATIE COMUNA', kind: 'shared' },
  { folder: 'PARTNER 200', kind: 'product' },
  { folder: 'PARTNER 600', kind: 'product' },
  { folder: 'TASTATURI VIRTUALE', kind: 'shared' },
];

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

test('a first message searches with the question alone', () => {
  assert.deepStrictEqual(searchRequest('cum adaug sertar la partner 200', []),
    { query: 'cum adaug sertar la partner 200', context_query: '' });
});

test('a later message also searches with the previous user message in front', () => {
  const history = [
    { role: 'user', content: 'cum conectez si eu un sertar?' },
    { role: 'assistant', content: 'Ce model aveți?' },
  ];
  assert.deepStrictEqual(searchRequest('partner 200 am', history),
    { query: 'partner 200 am', context_query: 'cum conectez si eu un sertar?\npartner 200 am' });
});

test('the previous user message is cut to CONTEXT_CHARS', () => {
  const history = [{ role: 'user', content: 'x'.repeat(1000) }];
  const { context_query } = searchRequest('q', history);
  assert.strictEqual(context_query, 'x'.repeat(CONTEXT_CHARS) + '\nq');
});

test('the folder rule names the shared folders and never a product', () => {
  const rule = folderRule(FOLDERS);
  assert.ok(rule.includes('Documents from [DOCUMENTATIE COMUNA], [TASTATURI VIRTUALE], and documents with no folder label, apply to every product.'));
  assert.ok(rule.includes('named in the question or earlier in the conversation'));
  assert.ok(rule.includes('say explicitly that it comes from the documentation for that other product'));
  assert.ok(rule.includes('ask which product the user has'));
  assert.ok(!rule.includes('PARTNER 200'));
});

test('with no shared folders the rule only mentions unlabelled documents', () => {
  assert.ok(folderRule([{ folder: 'PARTNER 200', kind: 'product' }])
    .includes('Documents with no folder label apply to every product.'));
});
