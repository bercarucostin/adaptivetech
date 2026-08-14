'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeSigiliu, extractSigilii } = require('../lib/sigiliu.js');

test('normalizeSigiliu uppercases and strips separators', () => {
  assert.strictEqual(normalizeSigiliu('PN 002'), 'PN002');
  assert.strictEqual(normalizeSigiliu('pn-002'), 'PN002');
  assert.strictEqual(normalizeSigiliu('WR001'), 'WR001');
  assert.strictEqual(normalizeSigiliu('  pn . 002  '), 'PN002');
});

test('normalizeSigiliu tolerates non-strings', () => {
  assert.strictEqual(normalizeSigiliu(null), '');
  assert.strictEqual(normalizeSigiliu(undefined), '');
  assert.strictEqual(normalizeSigiliu(123), '123');
});

test('extractSigilii accepts every realistic way of typing a sigiliu', () => {
  assert.deepStrictEqual(extractSigilii('PN 002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('pn002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN-002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN.002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN_002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('Sigiliul meu este PN 002, mersi'), ['PN002']);
});

test('extractSigilii matches the sheet-side malformed WR001 both ways', () => {
  assert.deepStrictEqual(extractSigilii('WR001'), ['WR001']);
  assert.deepStrictEqual(extractSigilii('WR 001'), ['WR001']);
});

test('extractSigilii ignores tokens embedded in longer runs', () => {
  assert.deepStrictEqual(extractSigilii('am comanda AB1234 in lucru'), []);
  assert.deepStrictEqual(extractSigilii('sigiliuPN002'), []);
  assert.deepStrictEqual(extractSigilii('va rog ajutor, 12345'), []);
});

// SECURITY: DE is a real prefix and DE 001/002/003/005 all exist in the sheet.
// A 1-3 digit rule with zero-padding would let ordinary Romanian authenticate a
// stranger. These cases must stay empty.
test('extractSigilii does not authenticate ordinary Romanian prose', () => {
  assert.deepStrictEqual(extractSigilii('am asteptat de 5 zile'), []);
  assert.deepStrictEqual(extractSigilii('de 2 ori pe zi'), []);
  assert.deepStrictEqual(extractSigilii('costa 50 de lei'), []);
});

// SECURITY: this message is sent before the sender is known, so any token in it
// is a credential handed to a stranger.
test('the Ask Sigiliu prompt itself contains no extractable sigiliu', () => {
  const prompt =
    'Salut! Pentru a folosi acest asistent, te rog trimite-mi sigiliul tau de ' +
    'identificare. Daca nu il ai, contacteaza Partner.';
  assert.deepStrictEqual(extractSigilii(prompt), []);
});

test('extractSigilii preserves order and deduplicates', () => {
  assert.deepStrictEqual(extractSigilii('PN 002 si SW 020'), ['PN002', 'SW020']);
  assert.deepStrictEqual(extractSigilii('PN 002 apoi PN-002'), ['PN002']);
});

test('extractSigilii is safe to call repeatedly', () => {
  assert.deepStrictEqual(extractSigilii('PN 002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN 002'), ['PN002']);
});

test('extractSigilii tolerates non-strings', () => {
  assert.deepStrictEqual(extractSigilii(null), []);
  assert.deepStrictEqual(extractSigilii(undefined), []);
  assert.deepStrictEqual(extractSigilii(123), []);
});
