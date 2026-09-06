'use strict';
// error-handling-demo emails a failure report for a PUBLIC endpoint, so its
// inputs are a stranger's document and a stranger's questions -- not the
// team's own files. Two properties matter enough to pin here, because both
// fail silently: a leak looks like a normal alert, and a broken throttle
// looks like a busy inbox.
//
// The code under test is extracted from the generated workflow JSON, so
// editing the node without updating this fails here rather than in a mailbox.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const wf = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'workflows', 'error-handling-demo.json'), 'utf8')
);
const src = wf.nodes.find((n) => n.name === 'Build Error Report').parameters.jsCode;

/** Run the node body with a fresh static-data store, as n8n would. */
function harness() {
  const store = {};
  return function run(payload) {
    const fn = new Function('$', '$getWorkflowStaticData', src);
    return fn(
      () => ({ first: () => ({ json: payload }) }),
      () => store
    )[0].json;
  };
}

function failure(message, over) {
  return Object.assign(
    {
      workflow: { name: 'demo-upload', id: 'wf1' },
      execution: {
        id: '1',
        url: 'https://n8n.example/executions/1',
        mode: 'webhook',
        lastNodeExecuted: 'Gemini Extract',
        error: { message: message },
      },
    },
    over || {}
  );
}

test('a visitor email address never reaches the alert', () => {
  const out = harness()(failure('duplicate key violates constraint: ana.pop@firma.ro'));
  assert.ok(out.send);
  assert.ok(!/ana\.pop/.test(out.html), 'address leaked into the email body');
  assert.match(out.html, /redacted:email/);
});

test('document bytes and embedding vectors never reach the alert', () => {
  const out = harness()(failure('failed on {"data":"' + 'QUJD'.repeat(60) + '"}'));
  assert.ok(!/(QUJD){10}/.test(out.html), 'base64 blob leaked into the email body');
  assert.match(out.html, /redacted:blob/);
});

test('a long error message is truncated rather than pasted whole', () => {
  // Distinct words, so nothing matches the blob or email patterns -- this
  // pins the length cap specifically, not the other two rules.
  const words = Array.from({ length: 400 }, (_, i) => 'word' + i).join(' ');
  const out = harness()(failure(words));
  const field = out.html.match(/Error<\/td><td[^>]*>([^<]*)/)[1];
  assert.ok(field.length <= 300, 'error field was ' + field.length + ' chars');
});

test('the report names the workflow and the node that failed', () => {
  const out = harness()(failure('boom', { workflow: { name: 'demo-chat', id: 'wf2' } }));
  assert.match(out.subject, /demo-chat/);
  assert.match(out.subject, /Gemini Extract/);
});

test('a repeated failure at the same node is throttled, not re-sent', () => {
  const run = harness();
  assert.strictEqual(run(failure('boom')).send, true, 'first must send');
  assert.strictEqual(run(failure('boom')).send, false, 'second must be suppressed');
  assert.strictEqual(run(failure('boom')).send, false, 'third must be suppressed');
});

test('a different failing node alerts independently', () => {
  const run = harness();
  assert.strictEqual(run(failure('boom')).send, true);
  const other = failure('boom');
  other.execution.lastNodeExecuted = 'Embed Chunks';
  assert.strictEqual(run(other).send, true, 'a distinct node must not be throttled');
});

test('the throttle fails toward sending when static data does not persist', () => {
  // n8n does not persist static data for manual executions. Silence would be
  // the dangerous failure here, so a store that resets must still alert.
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(harness()(failure('boom')).send, true);
  }
});
