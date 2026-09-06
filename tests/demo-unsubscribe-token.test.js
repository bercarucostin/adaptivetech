'use strict';
// The unsubscribe token is minted in one workflow (demo-request-code's
// "Generate Code" node) and verified in another (demo-unsubscribe's "Verify
// Token" node). Nothing else couples them: there is no shared lib block here,
// because the mint is three lines inside a node that mostly does other things.
//
// So this test extracts BOTH halves out of the generated workflow JSON and
// runs them against each other. Editing either side alone fails here rather
// than in production, where the symptom is an unsubscribe link that silently
// stops working -- on a page whose privacy policy promises it works.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKFLOWS = path.join(__dirname, '..', 'workflows');
const SECRET = 'test-secret-not-the-real-one';

function nodeCode(file, nodeName) {
  const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8'));
  const node = wf.nodes.find((n) => n.name === nodeName);
  assert.ok(node, 'node "' + nodeName + '" is missing from ' + file);
  return node.parameters.jsCode;
}

// The minting half, lifted verbatim from the node that emails the link.
const mintSrc = nodeCode('demo-request-code.json', 'Generate Code')
  .match(/const unsubMac[\s\S]*?const unsubToken = [^\n]*/);
assert.ok(mintSrc, 'demo-request-code no longer mints an unsub token the expected way');
const mint = new Function('email', 'secret', 'crypto', mintSrc[0] + '; return unsubToken;');

// The verifying half, with only its n8n-specific preamble removed.
const verify = (function () {
  const src = nodeCode('demo-unsubscribe.json', 'Verify Token')
    .replace("const crypto = require('crypto');", '')
    .replace(/const token = String\([^\n]*\n/, '')
    .replace(/const secret = \$env\.DEMO_SESSION_SECRET;\n/, '')
    .replace(/if \(!secret\) throw new Error\([^\n]*\n/, '');
  return new Function('token', 'secret', 'crypto', src);
})();

function check(token, secret) {
  return verify(token, secret || SECRET, crypto)[0].json;
}

test('a freshly minted token verifies and yields the address back', () => {
  for (const email of ['a@b.ro', 'user+demo@company.co.uk', 'ștefan@firmă.ro']) {
    const claims = check(mint(email, SECRET, crypto));
    assert.deepStrictEqual(claims, { ok: true, email: email },
      'round trip failed for ' + email);
  }
});

test('the address cannot be swapped while keeping a valid signature', () => {
  // The attack this endpoint exists to refuse: unsubscribing someone else by
  // editing the address in a link you legitimately received.
  const mac = mint('mine@x.ro', SECRET, crypto).split('.')[1];
  const forged = Buffer.from('victim@x.ro').toString('base64url') + '.' + mac;
  assert.strictEqual(check(forged).ok, false);
});

test('a tampered signature is rejected', () => {
  const token = mint('a@b.ro', SECRET, crypto);
  const last = token.slice(-1);
  assert.strictEqual(check(token.slice(0, -1) + (last === 'A' ? 'B' : 'A')).ok, false);
});

test('a token signed with another secret is rejected', () => {
  assert.strictEqual(check(mint('a@b.ro', 'some-other-secret', crypto)).ok, false);
});

test('malformed tokens are rejected without throwing', () => {
  for (const bad of ['', 'xxx', 'a.b.c', Buffer.from('a@b.ro').toString('base64url') + '.']) {
    assert.strictEqual(check(bad).ok, false, 'should reject ' + JSON.stringify(bad));
  }
});

test('an absurdly long address is refused before any crypto runs', () => {
  const huge = 'x'.repeat(400) + '@b.ro';
  assert.strictEqual(check(Buffer.from(huge).toString('base64url') + '.aaaa').ok, false);
});

test('the minted token is safe in a URL query string', () => {
  const token = mint('user+demo@company.co.uk', SECRET, crypto);
  assert.match(token, /^[A-Za-z0-9._-]+$/,
    'token must survive a mail client without percent-encoding');
});
