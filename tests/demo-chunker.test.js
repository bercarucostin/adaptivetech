'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { chunkDocument } = require('../lib/demo-chunker.js');

const words = (n, w) => Array.from({ length: n }, (_, i) => (w || 'w') + i).join(' ');

test('an empty or blank document yields no chunks', () => {
  assert.deepStrictEqual(chunkDocument('a.pdf', ''), []);
  assert.deepStrictEqual(chunkDocument('a.pdf', '   \n  \n '), []);
  assert.deepStrictEqual(chunkDocument('a.pdf', null), []);
});

test('a short document with no headings becomes one chunk titled by filename', () => {
  const out = chunkDocument('Manual de service.pdf', 'doar cateva cuvinte aici');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].section_heading, 'Manual de service');
  assert.strictEqual(out[0].original_file_name, 'Manual de service.pdf');
  assert.strictEqual(out[0].chunk_index, 0);
});

test('the embedded text is prefixed with title and section for retrieval context', () => {
  const out = chunkDocument('Manual.pdf', '## Resetare\ntine apasat 5 secunde');
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].text.startsWith('Manual — Resetare\n\n'));
  assert.ok(out[0].text.includes('tine apasat 5 secunde'));
});

test('## headings split sections and each section restarts its own content', () => {
  const out = chunkDocument('M.pdf', '## Unu\nalpha\n## Doi\nbeta');
  assert.deepStrictEqual(out.map((c) => c.section_heading), ['Unu', 'Doi']);
  assert.ok(out[0].text.includes('alpha') && !out[0].text.includes('beta'));
  assert.ok(out[1].text.includes('beta') && !out[1].text.includes('alpha'));
});

test('content before the first heading is kept under the document title', () => {
  const out = chunkDocument('M.pdf', 'intro text\n## Unu\nalpha');
  assert.strictEqual(out[0].section_heading, 'M');
  assert.ok(out[0].text.includes('intro text'));
});

test('a long section is windowed at 350 tokens with 75 tokens of overlap', () => {
  const out = chunkDocument('M.pdf', words(800));
  assert.strictEqual(out.length, 3);

  // The window is the text after the "title — heading" prefix.
  const win = (c) => c.text.split('\n\n')[1].split(' ');
  const w0 = win(out[0]);
  const w1 = win(out[1]);

  assert.strictEqual(w0.length, 350, 'first window must be exactly the token limit');
  assert.strictEqual(w0[0], 'w0');
  assert.strictEqual(w1.length, 350, 'second window must be exactly the token limit');
  assert.strictEqual(w1[0], 'w275', 'second window starts 350 - 75 = 275 tokens in');

  // The overlap is the tokens the two windows share — 75 of them, by
  // definition. Asserting the shared count is what makes this a test of
  // the contract rather than of one hand-computed token name.
  const shared = w0.filter((t) => w1.includes(t));
  assert.strictEqual(shared.length, 75, 'windows must share exactly 75 tokens');
});

test('chunk_index increases across sections, not within them', () => {
  const out = chunkDocument('M.pdf', '## A\n' + words(400) + '\n## B\nshort');
  assert.deepStrictEqual(out.map((c) => c.chunk_index), [0, 1, 2]);
});

test('exceeding the chunk ceiling throws rather than silently truncating', () => {
  assert.throws(
    () => chunkDocument('M.pdf', words(300_000), { maxChunks: 600 }),
    /too large/i
  );
});

test('the ceiling is configurable so the test does not depend on the default', () => {
  assert.throws(() => chunkDocument('M.pdf', words(2000), { maxChunks: 2 }), /too large/i);
  assert.strictEqual(chunkDocument('M.pdf', words(2000), { maxChunks: 99 }).length, 7);
});

test('identical chunks within one document are de-duplicated', () => {
  const out = chunkDocument('M.pdf', '## A\nacelasi text\n## B\nacelasi text');
  assert.strictEqual(out.length, 1, 'duplicate content should collapse');
});

test('a filename with no extension is used as the title unchanged', () => {
  const out = chunkDocument('README', 'text');
  assert.strictEqual(out[0].section_heading, 'README');
});
