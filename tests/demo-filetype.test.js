'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectFileType } = require('../lib/demo-filetype.js');

test('a PDF is detected by its %PDF- signature', () => {
  assert.strictEqual(detectFileType(Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3')), 'pdf');
});

test('a ZIP-container document is detected as docx', () => {
  assert.strictEqual(detectFileType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])), 'docx');
});

test('an empty zip end-of-archive marker is still a zip container', () => {
  assert.strictEqual(detectFileType(Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00])), 'docx');
});

test('plain UTF-8 text is detected as txt', () => {
  assert.strictEqual(detectFileType(Buffer.from('Procedura de resetare\nApasa 5 secunde', 'utf8')), 'txt');
});

test('text with diacritics is still txt', () => {
  assert.strictEqual(detectFileType(Buffer.from('Ștergeți fișierul și reporniți', 'utf8')), 'txt');
});

test('a binary blob with NUL bytes is rejected', () => {
  assert.strictEqual(detectFileType(Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff])), null);
});

test('an executable is rejected despite being mostly printable', () => {
  assert.strictEqual(detectFileType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])), null);
});

test('a PNG is rejected -- images are not in the allowlist', () => {
  assert.strictEqual(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), null);
});

test('empty and non-buffer input is rejected without throwing', () => {
  assert.strictEqual(detectFileType(Buffer.alloc(0)), null);
  assert.strictEqual(detectFileType(null), null);
  assert.strictEqual(detectFileType('%PDF-1.7'), null);
});

test('a PDF signature that is not at offset 0 is rejected', () => {
  assert.strictEqual(detectFileType(Buffer.from('   %PDF-1.7')), 'txt');
});

test('binary past the 8 KB sample still disqualifies a file as text', () => {
  // Clean ASCII well past the sampling window, then a NUL. Sampling only the
  // first 8 KB would call this text and hand the whole buffer to extraction.
  const buf = Buffer.concat([
    Buffer.from('a'.repeat(10000), 'utf8'),
    Buffer.from([0x00, 0xff, 0xfe]),
  ]);
  assert.strictEqual(detectFileType(buf), null);
});

test('a large clean text file is still accepted', () => {
  assert.strictEqual(detectFileType(Buffer.from('a'.repeat(100000), 'utf8')), 'txt');
});
