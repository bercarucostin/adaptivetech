'use strict';
// n8n invokes settings.errorWorkflow only for a FAILED execution. Every
// webhook route here carries onError: continueErrorOutput -- mandatory, or a
// throw kills the execution before Respond to Webhook runs and the caller
// gets an empty body with no status -- and that flag marks the execution
// SUCCESSFUL. So handling an error well is exactly what stopped it from ever
// being reported, and the error workflow sat there never firing.
//
// The fix is a Raise For Alert node placed AFTER the responder: the caller
// already has its status and body, then the throw fails the execution.
//
// Both halves of that need pinning, because each fails silently in its own
// direction. Wire it too early and the caller hangs. Wire it to a business
// rejection and a forged cookie pages someone at 3am, which is how an alert
// mailbox becomes a filter rule.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'workflows');
const ALERT = 'Raise For Alert';

const demoWorkflows = () =>
  fs.readdirSync(DIR)
    .filter((f) => f.startsWith('demo-'))
    .map((f) => ({ file: f, wf: JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) }));

const nodeByName = (wf, name) => wf.nodes.find((n) => n.name === name);

/** Every node with an edge into Raise For Alert. */
function feeders(wf) {
  const out = [];
  for (const [src, conn] of Object.entries(wf.connections || {})) {
    for (const branch of conn.main || []) {
      for (const edge of branch || []) if (edge.node === ALERT) out.push(src);
    }
  }
  return out;
}

test('every demo workflow points at the shared error handler', () => {
  for (const { file, wf } of demoWorkflows()) {
    assert.ok(
      wf.settings && wf.settings.errorWorkflow,
      file + ' has no settings.errorWorkflow, so its failures reach nobody'
    );
  }
});

test('the routes that can fail on infrastructure all raise', () => {
  // demo-upload-status and demo-verify-session have no node that can fail on
  // anything but a verdict, so they are deliberately absent here.
  const MUST_ALERT = [
    'demo-request-code.json',
    'demo-verify-code.json',
    'demo-upload.json',
    'demo-chat.json',
    'demo-unsubscribe-confirm.json',
  ];
  for (const name of MUST_ALERT) {
    const wf = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
    assert.ok(nodeByName(wf, ALERT), name + ' has no ' + ALERT + ' node');
    assert.ok(feeders(wf).length > 0, name + ': ' + ALERT + ' is unreachable');
  }
});

test('the alert is always downstream of the response, never before it', () => {
  // The ordering that keeps the caller unaffected. If this ever inverts, the
  // throw happens first, Respond to Webhook never runs, and the visitor gets
  // an empty body -- while the alert still fires, so it looks fixed.
  for (const { file, wf } of demoWorkflows()) {
    if (!nodeByName(wf, ALERT)) continue;
    for (const src of feeders(wf)) {
      const node = nodeByName(wf, src);
      const answered =
        node.type === 'n8n-nodes-base.respondToWebhook' ||
        // demo-upload has already responded 202 long before this point; its
        // alert hangs off the node that records the failure on the row the
        // client is polling.
        /^Mark Failed/.test(src);
      assert.ok(
        answered,
        file + ': ' + ALERT + ' is fed by "' + src + '", which does not answer the caller first'
      );
    }
  }
});

test('no business rejection reaches the alert', () => {
  // A forged cookie, a spent quota, a failed challenge, a scanned PDF, an
  // exhausted message limit: all of these are the demo working as designed.
  const QUIET = {
    'demo-request-code.json': ['Respond Accepted', 'Respond Accepted (rejected)'],
    'demo-verify-code.json': ['Respond With Cookie', 'Respond Bad Code'],
    'demo-chat.json': ['Respond', 'Respond Session Invalid', 'Respond Message Limit'],
    'demo-upload.json': [
      'Respond Accepted', 'Respond Upload Limit', 'Respond Session Invalid',
      'Respond Bad File', 'Mark Ready', 'Mark Failed No Text',
    ],
    'demo-upload-status.json': ['Respond', 'Respond Unauthorized'],
    // The GET only offers; it has no alert path and nothing to suppress.
    'demo-unsubscribe.json': ['Respond Confirm', 'Respond Invalid'],
    'demo-unsubscribe-confirm.json': ['Respond Done', 'Respond Invalid'],
  };
  for (const [file, names] of Object.entries(QUIET)) {
    const wf = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    for (const name of names) {
      assert.ok(nodeByName(wf, name), file + ': expected node "' + name + '" is missing');
      const conn = wf.connections[name];
      const raises =
        conn && (conn.main || []).some((b) => (b || []).some((e) => e.node === ALERT));
      assert.ok(!raises, file + ': "' + name + '" is a business outcome and must not alert');
    }
  }
});

test('nothing that can throw on a webhook route is left unhandled', () => {
  // The original bug in reverse. A node without onError ends the execution on
  // failure, so the caller gets no status at all -- which alerts, but leaves
  // the browser with nothing to show. Nodes are exempt only where the route
  // has already responded.
  const RESPONDED = {
    // Everything past Respond Accepted in demo-upload runs after the 202.
    'demo-upload.json': [
      'Mark Extracting', 'Use Plain Text', 'Chunk Document', 'Mark Ready',
      'Mark Failed No Text', 'Mark Failed Unavailable', ALERT,
    ],
    'demo-chat.json': [ALERT],
    'demo-request-code.json': [ALERT],
    'demo-verify-code.json': [ALERT],
    'demo-unsubscribe-confirm.json': [ALERT],
  };
  for (const { file, wf } of demoWorkflows()) {
    const exempt = RESPONDED[file] || [ALERT];
    const isWebhookRoute = wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook');
    if (!isWebhookRoute) continue;
    for (const node of wf.nodes) {
      const risky =
        node.type === 'n8n-nodes-base.httpRequest' ||
        node.type === 'n8n-nodes-base.executeWorkflow';
      if (!risky || exempt.includes(node.name)) continue;
      assert.strictEqual(
        node.onError, 'continueErrorOutput',
        file + ' / ' + node.name + ' can throw before the caller is answered'
      );
    }
  }
});
