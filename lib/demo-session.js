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

function signToken(sessionId, expiresAtMs, secret) {
  if (!sessionId) throw new Error('signToken requires a sessionId');
  if (!secret) throw new Error('signToken requires a secret');
  const payload = String(sessionId) + '.' + String(expiresAtMs);
  const mac = crypto.createHmac('sha256', secret).update(payload).digest();
  return payload + '.' + base64url(mac);
}

function verifyToken(token, secret, nowMs) {
  if (typeof token !== 'string' || !secret) return null;

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
