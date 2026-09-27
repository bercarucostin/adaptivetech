'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  chunkDocument, titleFromFileName, countWords, WORD_LIMIT, OVERLAP_WORDS,
} = require('../lib/chunking.js');

// n distinct words, so overlap and dedupe can be checked by content.
const words = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => prefix + i).join(' ');
const body = (chunk) => chunk.text.slice(chunk.text.indexOf('\n\n') + 2);

test('a short procedure is one chunk and keeps one step per line', () => {
  const text = '## Procedura\n1. Apasati MENIU\n2. Selectati 5\n3. Introduceti parola 0000';
  const chunks = chunkDocument(text, 'Update firmware', 'DOCUMENTATIE COMUNA');
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].text,
    '[DOCUMENTATIE COMUNA] Update firmware — Update firmware\n\n' + text);
  assert.ok(chunks[0].text.includes('1. Apasati MENIU\n2. Selectati 5\n'));
});

test('a 700-word document with three sections stays one chunk', () => {
  const text = ['## A', words(250, 'a'), '## B', words(250, 'b'), '## C', words(197, 'c')].join('\n');
  assert.ok(countWords(text) <= 800);
  const chunks = chunkDocument(text, 'Doc', 'PARTNER 200');
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].section_heading, 'Doc');
});

test('a long document splits by section, labelled with folder, title and heading', () => {
  const text = ['## Instalare', words(300, 'i'), '## Service', words(300, 's'), '## Erori', words(300, 'e')].join('\n');
  const chunks = chunkDocument(text, 'Manual', 'PARTNER 600');
  assert.deepStrictEqual(chunks.map((c) => c.section_heading), ['Instalare', 'Service', 'Erori']);
  assert.ok(chunks[1].text.startsWith('[PARTNER 600] Manual — Service\n\n'));
  assert.strictEqual(chunks[1].embed_title, 'PARTNER 600 — Manual — Service');
  assert.deepStrictEqual(chunks.map((c) => c.chunk_index), [0, 1, 2]);
});

test('root-level files get no bracket label', () => {
  const chunks = chunkDocument('Scurt.', 'Nota', '');
  assert.strictEqual(chunks[0].text, 'Nota — Nota\n\nScurt.');
  assert.strictEqual(chunks[0].embed_title, 'Nota — Nota');
});

test('a tiny section merges into the next one with a joined heading', () => {
  const text = ['## Intro', words(300, 'i'), '## Atentie', words(20, 't'), '## Pasi', words(300, 'p'),
    '## Final', words(300, 'f')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X');
  assert.deepStrictEqual(chunks.map((c) => c.section_heading), ['Intro', 'Atentie / Pasi', 'Final']);
  assert.ok(body(chunks[1]).startsWith(words(20, 't') + '\n\n## Pasi\n'));
});

test('a tiny last section merges into the previous one', () => {
  const text = ['## A', words(500, 'a'), '## B', words(300, 'b'), '## Contact', words(10, 'c')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X');
  const last = chunks[chunks.length - 1];
  assert.strictEqual(last.section_heading, 'B / Contact');
  assert.ok(body(last).endsWith('## Contact\n' + words(10, 'c')));
});

test('lines are packed whole, never split mid-line, with line overlap', () => {
  // 40 lines of 20 words = 800 words in one section, plus a second section to pass WHOLE_DOC_WORDS.
  const lines = Array.from({ length: 40 }, (_, i) => words(20, 'l' + i + '_'));
  const text = ['## Pasi', ...lines, '## Alt', words(100, 'z')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X').filter((c) => c.section_heading === 'Pasi');
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    const b = body(c);
    assert.ok(countWords(b) <= WORD_LIMIT, 'chunk over the limit');
    for (const line of b.split('\n')) assert.ok(lines.includes(line), 'a line was cut: ' + line.slice(0, 30));
  }
  // The next chunk starts with the previous chunk's trailing lines (3 lines = 60 words <= 75).
  const firstLines = body(chunks[0]).split('\n');
  const secondLines = body(chunks[1]).split('\n');
  assert.deepStrictEqual(secondLines.slice(0, 3), firstLines.slice(-3));
});

test('one enormous line is cut into overlapping word windows', () => {
  const text = ['## Tabel', words(1000, 't'), '## Alt', words(100, 'z')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X').filter((c) => c.section_heading === 'Tabel');
  const bodies = chunks.map(body);
  for (const b of bodies) assert.ok(countWords(b) <= WORD_LIMIT);
  const first = bodies[0].split(' ');
  const second = bodies[1].split(' ');
  assert.strictEqual(first.length, WORD_LIMIT);
  assert.deepStrictEqual(second.slice(0, OVERLAP_WORDS), first.slice(-OVERLAP_WORDS));
  assert.ok(bodies[bodies.length - 1].endsWith('t999'), 'the tail of the line is kept');
});

test('a repeated section is stored once', () => {
  const sec = words(300, 'r');
  const text = ['## Dup', sec, '## Dup', sec, '## Alt', words(300, 'a')].join('\n');
  const chunks = chunkDocument(text, 'Doc', 'X');
  assert.deepStrictEqual(chunks.map((c) => c.section_heading), ['Dup', 'Alt']);
});

test('blank text yields no chunks', () => {
  assert.deepStrictEqual(chunkDocument('   \n ', 'Doc', 'X'), []);
  assert.deepStrictEqual(chunkDocument('', 'Doc', 'X'), []);
});

test('titleFromFileName strips only real extensions', () => {
  assert.strictEqual(titleFromFileName('Instructiuni update firmware P200-300-600 19.01.2026'),
    'Instructiuni update firmware P200-300-600 19.01.2026');
  assert.strictEqual(titleFromFileName('Manual PARTNER 600-v2.pdf'), 'Manual PARTNER 600-v2');
  assert.strictEqual(titleFromFileName('Oferta.DOCX'), 'Oferta');
  assert.strictEqual(titleFromFileName('fisa.xlsx'), 'fisa');
});
