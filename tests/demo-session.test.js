'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { signToken, verifyToken } = require('../lib/demo-session.js');

const SECRET = 'test-secret-not-the-real-one';
const SID = '3f1a9c2e-0b44-4a7d-9f13-5c8e2d6b7a01';
const NOW = 1_757_000_000_000;
const SOON = NOW + 2 * 60 * 60 * 1000;

test('a freshly signed token verifies and returns its session id', () => {
  const token = signToken(SID, SOON, SECRET);
  const claims = verifyToken(token, SECRET, NOW);
  assert.deepStrictEqual(claims, { sessionId: SID, expiresAtMs: SOON });
});

test('a token signed with a different secret is rejected', () => {
  const token = signToken(SID, SOON, 'some-other-secret');
  assert.strictEqual(verifyToken(token, SECRET, NOW), null);
});

test('swapping the session id invalidates the signature', () => {
  const token = signToken(SID, SOON, SECRET);
  const other = '00000000-0000-4000-8000-000000000000';
  const forged = other + '.' + token.split('.').slice(1).join('.');
  assert.strictEqual(verifyToken(forged, SECRET, NOW), null);
});

test('extending the expiry invalidates the signature', () => {
  const token = signToken(SID, SOON, SECRET);
  const parts = token.split('.');
  const forged = parts[0] + '.' + String(SOON + 86_400_000) + '.' + parts[2];
  assert.strictEqual(verifyToken(forged, SECRET, NOW), null);
});

test('an expired token is rejected even though its signature is valid', () => {
  const token = signToken(SID, NOW - 1, SECRET);
  assert.strictEqual(verifyToken(token, SECRET, NOW), null);
});

test('a token expiring exactly now is rejected', () => {
  const token = signToken(SID, NOW, SECRET);
  assert.strictEqual(verifyToken(token, SECRET, NOW), null);
});

test('malformed input is rejected without throwing', () => {
  for (const bad of [null, undefined, '', 'a', 'a.b', 'a.b.c.d', 42, {}, []]) {
    assert.strictEqual(verifyToken(bad, SECRET, NOW), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('a non-numeric expiry is rejected', () => {
  assert.strictEqual(verifyToken(SID + '.notanumber.abc', SECRET, NOW), null);
});

test('a truncated signature is rejected rather than throwing on length mismatch', () => {
  const token = signToken(SID, SOON, SECRET);
  const parts = token.split('.');
  assert.strictEqual(verifyToken(parts[0] + '.' + parts[1] + '.' + parts[2].slice(0, 10), SECRET, NOW), null);
});

test('signToken refuses to sign without a session id or secret', () => {
  assert.throws(() => signToken('', SOON, SECRET));
  assert.throws(() => signToken(SID, SOON, ''));
});

test('the token is cookie-safe -- no characters needing encoding', () => {
  const token = signToken(SID, SOON, SECRET);
  assert.match(token, /^[A-Za-z0-9._-]+$/);
});
