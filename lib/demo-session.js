'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Verify Token" Code node in
// workflows/demo-verify-session.json and the "Sign Token" Code node in
// workflows/demo-verify-code.json.
// tests/demo-workflow.test.js fails if they drift apart.
//
// Requires NODE_FUNCTION_ALLOW_BUILTIN=crypto on the n8n container.

const crypto = require('crypto');

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// A real token is ~94 chars (uuid + '.' + ms timestamp + '.' + base64url mac).
// The cap is generous but bounded: sessionId is attacker-controlled, and
// without it an arbitrarily large string reaches the HMAC.
const MAX_TOKEN_LENGTH = 512;

function signToken(sessionId, expiresAtMs, secret) {
  if (!sessionId) throw new Error('signToken requires a sessionId');
  if (!secret) throw new Error('signToken requires a secret');
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret)) {
    throw new Error('signToken requires a string or Buffer secret');
  }
  // Postgres `extract(epoch from ...) * 1000` yields a NUMERIC with a
  // fractional part, and String(1788695089121.642) is "1788695089121.642".
  // verifyToken requires /^\d+$/ on the expiry segment, so a float here mints
  // a token that can never verify -- a silent, and very confusing, failure.
  // Fail at the point of the mistake instead.
  if (!Number.isInteger(expiresAtMs)) {
    throw new Error('signToken requires an integer expiresAtMs (got ' + expiresAtMs + ')');
  }
  const payload = String(sessionId) + '.' + String(expiresAtMs);
  const mac = crypto.createHmac('sha256', secret).update(payload).digest();
  return payload + '.' + base64url(mac);
}

function verifyToken(token, secret, nowMs) {
  if (typeof token !== 'string') return null;
  // A truthy non-string secret would throw inside createHmac rather than
  // reject here -- in a Code node that is a 500 instead of a clean refusal.
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret)) return null;
  if (!secret.length) return null;
  if (token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const sessionId = parts[0];
  const expiresRaw = parts[1];
  const providedMac = parts[2];
  if (!sessionId || !expiresRaw) return null;

  // Reject before doing crypto work on obviously bad input.
  if (!/^\d+$/.test(expiresRaw)) return null;
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isFinite(expiresAtMs)) return null;

  const expectedMac = base64url(
    crypto.createHmac('sha256', secret).update(sessionId + '.' + expiresRaw).digest()
  );

  const a = Buffer.from(providedMac);
  const b = Buffer.from(expectedMac);
  // timingSafeEqual throws on a length mismatch, so check length first.
  // Length is not a secret -- the MAC is a fixed width.
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  // Signature is good; now check the claim it protects.
  if (expiresAtMs <= nowMs) return null;

  return { sessionId: sessionId, expiresAtMs: expiresAtMs };
}
// ---8<--- SHARED END ---8<---

module.exports = { signToken, verifyToken, base64url };
