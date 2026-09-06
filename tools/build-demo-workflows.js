'use strict';

// Generates the demo's n8n workflow JSON.
//
// The Code nodes must contain the SHARED blocks from lib/ byte for byte --
// tests/demo-workflow.test.js asserts it, and a hand-copied block drifts the
// first time someone edits one side. Generating the workflow from lib/ makes
// that impossible rather than merely tested.
//
// Node types and typeVersions below were taken from real exports off the
// target instance (n8n 2.28.3), not from memory:
//   executeWorkflowTrigger @1.1   postgres @2.6   code @2
//
// Usage:  node tools/build-demo-workflows.js
// Then import the file(s) it writes into n8n and run them.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'workflows');

// The Postgres credential as it exists on the target instance.
const PG_CRED = { id: '1Ig8IigY7ugDJKhy', name: 'Supabase' };

/** Pull the ---8<--- SHARED block out of a lib module, verbatim. */
function shared(libFile) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', libFile), 'utf8');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  if (start === -1 || end <= start) {
    throw new Error('SHARED markers missing or inverted in lib/' + libFile);
  }
  return src.slice(start, end);
}

const node = (name, type, typeVersion, parameters, position, extra) =>
  Object.assign(
    { parameters, type, typeVersion, position, id: crypto.randomUUID(), name },
    extra || {}
  );

const workflow = (name, nodes, connections) => ({
  name,
  nodes,
  pinData: {},
  connections,
  active: false,
  settings: { executionOrder: 'v1', binaryMode: 'separate' },
  tags: [],
});

// ---------------------------------------------------------------------------
// demo-verify-session
//
// Every route that touches session data calls this and nothing else, so the
// session_id has exactly one origin: the verified token. It is deliberately
// the smallest workflow in the set -- it proves the import shape before seven
// more are written against the same pattern.
// ---------------------------------------------------------------------------
const verifySessionGlue = `
// --- node glue below the shared block -------------------------------------
// The caller passes the raw Cookie header. The session id is read from the
// signed token inside it and NEVER from a request body -- that is the whole
// isolation guarantee, and it lives here so there is one place to audit.

const input = $('When Executed by Another Workflow').first().json || {};
const cookieHeader = String(input.cookie_header || '');

const secret = $env.DEMO_SESSION_SECRET;
if (!secret) {
  throw new Error('DEMO_SESSION_SECRET is not set on the n8n container');
}

// Parse the demo_session cookie out of the header. Split on the first '='
// only: base64url can contain '=' padding, though signToken strips it.
let token = '';
for (const part of cookieHeader.split(';')) {
  const eq = part.indexOf('=');
  if (eq === -1) continue;
  if (part.slice(0, eq).trim() === 'demo_session') {
    token = part.slice(eq + 1).trim();
    break;
  }
}

const claims = verifyToken(token, secret, Date.now());
if (!claims) {
  // One error for every rejection reason -- a forged signature, an expired
  // claim and a malformed token are indistinguishable to the caller by design.
  throw new Error('SESSION_INVALID');
}

return [{ json: { session_id: claims.sessionId } }];
`;

const assertLiveCode = `// The token verified, but the row may be gone: the hourly purge deletes
// expired sessions, and a token outlives its row until its own TTL elapses.
// Same outcome as a bad token -- the caller learns nothing either way.
const rows = $input.all();
const row = rows.length ? rows[0].json : null;

if (!row || !row.session_id) {
  throw new Error('SESSION_INVALID');
}

return [{ json: row }];
`;

const loadSessionSql =
  'SELECT id AS session_id,\n' +
  '       email,\n' +
  '       files_uploaded,\n' +
  '       messages_used,\n' +
  '       input_tokens,\n' +
  '       output_tokens,\n' +
  '       extract(epoch FROM expires_at) * 1000 AS expires_ms\n' +
  'FROM demo_sessions\n' +
  'WHERE id = $1::uuid\n' +
  '  AND expires_at > now()';

const verifySession = workflow(
  'demo-verify-session',
  [
    node('When Executed by Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', 1.1,
      { inputSource: 'passthrough' }, [0, 0]),

    node('Verify Token', 'n8n-nodes-base.code', 2,
      { jsCode: shared('demo-session.js') + verifySessionGlue }, [208, 0]),

    node('Load Session', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: loadSessionSql,
        // Parameterised, never interpolated: the id came from a verified
        // token, but the habit is what keeps the next query safe too.
        options: { queryReplacement: '={{ [$json.session_id] }}' },
      },
      [416, 0],
      { credentials: { postgres: PG_CRED }, retryOnFail: true }),

    node('Assert Session Live', 'n8n-nodes-base.code', 2,
      { jsCode: assertLiveCode }, [624, 0]),
  ],
  {
    'When Executed by Another Workflow': {
      main: [[{ node: 'Verify Token', type: 'main', index: 0 }]],
    },
    'Verify Token': {
      main: [[{ node: 'Load Session', type: 'main', index: 0 }]],
    },
    'Load Session': {
      main: [[{ node: 'Assert Session Live', type: 'main', index: 0 }]],
    },
  }
);

// ---------------------------------------------------------------------------

const built = [['demo-verify-session.json', verifySession]];

for (const [file, wf] of built) {
  const target = path.join(OUT, file);
  fs.writeFileSync(target, JSON.stringify(wf, null, 2) + '\n');
  console.log('wrote workflows/' + file + '  (' + wf.nodes.length + ' nodes)');
}
