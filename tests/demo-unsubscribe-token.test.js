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

// The verifying half. Only the two $env lines are removed; the body runs as
// written, with `$` supplied the way n8n would supply it. An earlier version
// stripped the token-extraction line too, which meant the test silently
// stopped covering how the token is read off the request at all.
const verifyBody = nodeCode('demo-unsubscribe.json', 'Verify Token')
  .replace("const crypto = require('crypto');", '')
  .replace(/const secret = \$env\.DEMO_SESSION_SECRET;\n/, '')
  .replace(/if \(!secret\) throw new Error\([^\n]*\n/, '');

const verifyFn = new Function('$', 'secret', 'crypto', verifyBody);

/** Run the node with the token arriving where `where` says: query or body. */
function check(token, secret, where) {
  const json = where === 'body' ? { body: { t: token } } : { query: { t: token } };
  const $ = function () {
    return { first: function () { return { json: json }; } };
  };
  return verifyFn($, secret || SECRET, crypto)[0].json;
}

test('a freshly minted token verifies and yields the address back', () => {
  for (const email of ['a@b.ro', 'user+demo@company.co.uk', 'ștefan@firmă.ro']) {
    const token = mint(email, SECRET, crypto);
    assert.deepStrictEqual(check(token), { ok: true, email: email, token: token },
      'round trip failed for ' + email);
  }
});

test('the token is accepted from the body as well as the query', () => {
  // The confirm form puts it in the query; a mail client doing RFC 8058
  // one-click may POST it in the body instead. Reading only the query would
  // make native unsubscribe controls silently fail.
  const token = mint('a@b.ro', SECRET, crypto);
  assert.strictEqual(check(token, SECRET, 'body').ok, true);
  assert.strictEqual(check(token, SECRET, 'query').ok, true);
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
