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

// db/demo_email_canonical.sql must be applied before these workflows run:
// the quota queries below call public.demo_canonical_email() and read the
// email_canonical generated columns it creates.

// Credentials as they exist on the target instance.
const PG_CRED = { id: '1Ig8IigY7ugDJKhy', name: 'Supabase' };
const SMTP_CRED = { id: 'BI2J0KgYoH5uWjln', name: 'SMTP account' };

// n8n's PREDEFINED Gemini credential, not a generic Query Auth one. The two
// are wired differently on an HTTP Request node -- see geminiNode below --
// and this is the one that exists on the instance.
const GEMINI_CRED = { id: 'b4Za1yxMULpynxXY', name: 'Google Gemini(PaLM) Api account' };

// Real ids read back from n8n exports, so a rebuild produces the files that
// are already deployed rather than a set that has to be re-wired by hand.
//
// The workflow ids are NOT decorative. demo-verify-session is called by id
// from four other workflows, and n8n assigns those ids on import -- so they
// cannot be guessed and every one below was read off the instance. The
// collision this table exists to prevent already happened once: the id
// originally pinned for demo-verify-session was later handed to demo-upload,
// which would have made every route call the upload workflow to check its
// session.
//
// webhookId only addresses a workflow's TEST url; production routes register
// by `path`. It is pinned anyway so a fresh export diffs clean against the
// repo instead of churning on every rebuild.
const N8N_IDS = {
  'demo-verify-session': { id: 'QWICxTnfbkvLtmFQ' },
  'error-handling-demo': { id: 'GaXoZRqkR8ghodgY' },
  'demo-request-code': {
    id: '5ZNd32OKMgsNX2nE',
    webhooks: { Webhook: '239e6594-8140-4ed5-ad7b-9340452f7a51' },
  },
  'demo-verify-code': {
    id: 'mbuQUEIfcw9xu5es',
    webhooks: { Webhook: '47d799d5-0555-48d4-ae9d-14106e99cfa3' },
  },
  'demo-upload': {
    id: 'qBScjzp3KtIuZJhy',
    webhooks: { Webhook: 'b8066e2c-cbdc-4e31-9e0f-68c61f40636a' },
  },
  'demo-chat': {
    id: 'EVSG42B2rszYbvID',
    webhooks: { Webhook: '7fb4e91f-4842-4e94-9394-f92f439495ec' },
  },
  'demo-upload-status': {
    id: 'NjQwVYmXFTdJQACc',
    webhooks: { Webhook: '38157711-a3c1-4ec3-b521-ea96efd01009' },
  },
};

// Called by id from demo-upload, demo-upload-status, demo-search and
// demo-chat. Read from the table above so it cannot drift from it.
const VERIFY_SESSION_WORKFLOW_ID = N8N_IDS['demo-verify-session'].id;

// Per-workflow execution retention.
//
// n8n archives EVERY node's output for a saved execution, and three of these
// workflows make that ruinous in different ways:
//
//   demo-upload         one 10 MB PDF becomes a 13 MB base64 string plus
//                       ~18 MB of embedding vectors, carried across 25 nodes
//                       -- tens of megabytes written to Postgres per upload,
//                       for data nothing ever reads back.
//   demo-upload-status  polled every 5s for up to 5 minutes, so ~60
//                       executions per upload, each of them trivial.
//   demo-verify-session called by every authenticated route, and once more
//                       for each of those polls.
//
// Between them they evict the executions that are actually worth reading.
// Errors still save in full on all three -- that is the half you would ever
// open -- and every other workflow keeps n8n's default.
const WORKFLOW_SETTINGS = {
  'demo-upload': { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
  'demo-upload-status': { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
  'demo-verify-session': { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
};

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

/** A UUID derived from a string rather than from randomness.
 *
 *  Every id in a generated workflow used to be crypto.randomUUID(), which
 *  made each rebuild produce a file that LOOKED like a different workflow to
 *  n8n. Re-importing after a rebuild then landed as a new workflow instead of
 *  an update: the copy arrives inactive (active: false below), it collides
 *  with the original on its webhook path, and the route starts answering
 *  500 "webhook is not registered" -- with the old workflow still sitting
 *  there looking fine. Deriving ids from names makes a rebuild idempotent.
 */
function stableId(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  // Shaped as a v4 UUID. n8n only needs a unique string, but anything that
  // reads these expects the canonical form.
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16),
    variant + h.slice(17, 20), h.slice(20, 32),
  ].join('-');
}

const workflow = (name, nodes, connections) => {
  // Assigned here rather than in each constructor because this is the only
  // place that knows the workflow name -- two workflows may hold nodes with
  // the same name, and their ids must still differ.
  const pinned = N8N_IDS[name] || {};

  for (const n of nodes) {
    const seed = name + '|' + n.name;
    n.id = stableId(seed);
    // Prefer the id n8n actually assigned; fall back to a derived one for a
    // workflow that has not been imported yet.
    if (n.webhookId) {
      n.webhookId = (pinned.webhooks && pinned.webhooks[n.name])
        || stableId(seed + '|webhook');
    }
    const conds = n.parameters && n.parameters.conditions
      && n.parameters.conditions.conditions;
    if (Array.isArray(conds)) {
      conds.forEach((c, i) => { c.id = stableId(seed + '|condition|' + i); });
    }
  }

  const settings = { executionOrder: 'v1', binaryMode: 'separate' };

  // Point every demo workflow at the shared error handler -- but only once
  // that handler has an id, and never at itself. Until then the field is
  // omitted rather than filled with a guess: a settings.errorWorkflow naming
  // a workflow that does not exist means failures go nowhere at all, which
  // is worse than the honest default of nowhere-but-the-executions-list.
  const errorWorkflowId = (N8N_IDS['error-handling-demo'] || {}).id;
  if (errorWorkflowId && name !== 'error-handling-demo') {
    settings.errorWorkflow = errorWorkflowId;
  }

  Object.assign(settings, WORKFLOW_SETTINGS[name] || {});

  const wf = {
    name,
    nodes,
    pinData: {},
    connections,
    active: false,
    settings: settings,
    tags: [],
  };
  // Carried so the file matches a fresh export from the instance. Import
  // through the UI assigns its own id regardless; this keeps the repo honest
  // and lets the n8n CLI update in place.
  if (pinned.id) wf.id = pinned.id;
  return wf;
};

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

// floor(...)::bigint, not a bare multiply: extract(epoch ...) * 1000 yields a
// NUMERIC with a fractional part, and a fractional expiry in a token payload
// fails verifyToken's /^\d+$/ check -- minting a token that verifies nowhere.
const loadSessionSql =
  'SELECT id::text AS session_id,\n' +
  '       email,\n' +
  '       files_uploaded,\n' +
  '       messages_used,\n' +
  '       input_tokens,\n' +
  '       output_tokens,\n' +
  '       floor(extract(epoch FROM expires_at) * 1000)::bigint AS expires_ms\n' +
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
// demo-verify-session-test
//
// A harness, not a deliverable. It seeds its own session if none is live, so
// there is nothing to paste by hand and nothing that goes stale when the 2h
// expiry lapses -- run it again tomorrow and it just works.
//
// It calls demo-verify-session by VERIFY_SESSION_WORKFLOW_ID, which is
// defined once at the top of this file from N8N_IDS. It used to be redeclared
// here with a stale value, and that value later became demo-upload's id --
// so this harness was calling the upload workflow to verify a session.
// ---------------------------------------------------------------------------

const seedSessionSql =
  "WITH live AS (\n" +
  "  SELECT id, expires_at\n" +
  "  FROM demo_sessions\n" +
  "  WHERE email = 'verify-session-test@x.test' AND expires_at > now()\n" +
  "  ORDER BY created_at DESC\n" +
  "  LIMIT 1\n" +
  "), seeded AS (\n" +
  "  INSERT INTO demo_sessions (email, expires_at)\n" +
  "  SELECT 'verify-session-test@x.test', now() + interval '2 hours'\n" +
  "  WHERE NOT EXISTS (SELECT 1 FROM live)\n" +
  "  RETURNING id, expires_at\n" +
  ")\n" +
  "SELECT id::text AS session_id,\n" +
  "       floor(extract(epoch FROM expires_at) * 1000)::bigint AS expires_ms\n" +
  "FROM live\n" +
  "UNION ALL\n" +
  "SELECT id::text, floor(extract(epoch FROM expires_at) * 1000)::bigint\n" +
  "FROM seeded";

const mintTokenCode = `const crypto = require('crypto');

const row = $input.first().json;
const secret = $env.DEMO_SESSION_SECRET;
if (!secret) {
  throw new Error('DEMO_SESSION_SECRET is not set on the n8n container');
}

// expires_ms arrives already floored from SQL. Concatenating rather than
// arithmetic keeps it exact whether the driver hands back a bigint as a
// number or a string.
const payload = row.session_id + '.' + row.expires_ms;

const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64')
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

const token = payload + '.' + mac;

// Flip one character of the MAC to get a token that must be REJECTED. Swap
// which line is returned to test the unhappy path -- verify-session should
// throw SESSION_INVALID, and a session coming back instead would mean the
// signature check is not doing its job.
const tampered = payload + '.' + (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);

return [{
  json: {
    cookie_header: 'demo_session=' + token,
    // cookie_header: 'demo_session=' + tampered,
    expected_session_id: row.session_id,
  },
}];
`;

const verifySessionTest = workflow(
  'demo-verify-session-test',
  [
    node("When clicking 'Execute workflow'", 'n8n-nodes-base.manualTrigger', 1,
      {}, [0, 0]),

    node('Seed Or Reuse A Session', 'n8n-nodes-base.postgres', 2.6,
      { operation: 'executeQuery', query: seedSessionSql, options: {} },
      [208, 0],
      { credentials: { postgres: PG_CRED } }),

    node('Mint Token', 'n8n-nodes-base.code', 2,
      { jsCode: mintTokenCode }, [416, 0]),

    node("Call demo-verify-session", 'n8n-nodes-base.executeWorkflow', 1.3,
      {
        workflowId: {
          __rl: true,
          value: VERIFY_SESSION_WORKFLOW_ID,
          mode: 'list',
          cachedResultUrl: '/workflow/' + VERIFY_SESSION_WORKFLOW_ID,
          cachedResultName: 'demo-verify-session',
        },
        workflowInputs: {
          mappingMode: 'defineBelow',
          value: {},
          matchingColumns: [],
          schema: [],
          attemptToConvertTypes: false,
          convertFieldsToString: true,
        },
        options: {},
      },
      [624, 0]),
  ],
  {
    "When clicking 'Execute workflow'": {
      main: [[{ node: 'Seed Or Reuse A Session', type: 'main', index: 0 }]],
    },
    'Seed Or Reuse A Session': {
      main: [[{ node: 'Mint Token', type: 'main', index: 0 }]],
    },
    'Mint Token': {
      main: [[{ node: 'Call demo-verify-session', type: 'main', index: 0 }]],
    },
  }
);

// ---------------------------------------------------------------------------
// Shared helpers for the public webhook routes.
// ---------------------------------------------------------------------------

/** A public route. Caddy rewrites /api/demo/<x> to /webhook/demo/<x>. */
function webhookNode(name, method, routePath, position) {
  const id = crypto.randomUUID();
  return Object.assign(
    node(name, 'n8n-nodes-base.webhook', 2.1,
      {
        httpMethod: method,
        path: 'demo/' + routePath,
        // responseNode: this workflow decides the status and body itself,
        // rather than n8n echoing the last node's output.
        responseMode: 'responseNode',
        options: {},
      },
      position),
    { webhookId: id }
  );
}

function respondNode(name, bodyExpression, statusCode, position) {
  return node(name, 'n8n-nodes-base.respondToWebhook', 1.5,
    {
      respondWith: 'json',
      responseBody: bodyExpression,
      options: statusCode === 200 ? {} : { responseCode: statusCode },
    },
    position);
}

/** An If on a single boolean field. typeValidation is loose so a NULL or a
 *  string 'true' from Postgres does not error the node instead of routing. */
function ifBooleanNode(name, leftValue, position) {
  return node(name, 'n8n-nodes-base.if', 2.3,
    {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 3,
        },
        conditions: [
          {
            id: crypto.randomUUID(),
            leftValue: leftValue,
            rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    position);
}

/** An HTTP Request node calling a Gemini endpoint.
 *
 *  authentication: 'predefinedCredentialType' with nodeCredentialType, NOT
 *  the genericCredentialType/genericAuthType pair a Query Auth credential
 *  needs. Mixing the two leaves the node unauthenticated and Gemini answers
 *  403 with no hint that the credential was simply ignored.
 *
 *  The body is always JSON.stringify($json.requestBody), so every payload
 *  decision lives in a Code node where it can be read and reasoned about
 *  rather than in an expression field.
 */
function geminiNode(name, model, method, position, options, extra) {
  return node(name, 'n8n-nodes-base.httpRequest', 4.2,
    {
      method: 'POST',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/' +
           model + ':' + method,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googlePalmApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.requestBody) }}',
      options: options || {},
    },
    position,
    Object.assign({ credentials: { googlePalmApi: GEMINI_CRED } }, extra || {}));
}

/** Fails the execution on purpose, AFTER the caller has been answered.
 *
 *  This exists because of a real conflict between two things the routes both
 *  need. `onError: continueErrorOutput` is mandatory on a webhook route --
 *  without it a thrown error ends the execution, Respond to Webhook never
 *  runs, and the caller gets an empty body with no status. But it also marks
 *  the execution SUCCESSFUL, and n8n only invokes settings.errorWorkflow for
 *  a failed one. So handling an error well is precisely what stopped it from
 *  ever being reported.
 *
 *  Placing this after the responder gets both: the client already has its
 *  status and body, and the throw then fails the execution so the alert
 *  fires. Nothing downstream of a responder can affect the response.
 *
 *  It is wired ONLY to genuine failures. Business rejections -- a forged
 *  cookie, a spent quota, a scanned PDF, an exhausted message limit -- reach
 *  their own responders and end there, because a demo working exactly as
 *  designed must not page anyone.
 */
function raiseForAlertNode(where, position) {
  return node('Raise For Alert', 'n8n-nodes-base.code', 2,
    {
      jsCode:
        '// The caller already has its response; this only fails the execution\n' +
        '// so that settings.errorWorkflow is invoked. See raiseForAlertNode.\n' +
        'const item = $input.first().json || {};\n' +
        '// The error item\'s shape varies by node type, so read it defensively\n' +
        '// and fall back to naming the stage. The alert email links to this\n' +
        '// execution, where the untruncated error already is.\n' +
        'const raw = item.error;\n' +
        "const detail = (raw && raw.message) || (typeof raw === 'string' ? raw : '') ||\n" +
        "  'see the failed node in this execution';\n" +
        "throw new Error(" + JSON.stringify(where) + " + ': ' + detail);\n",
    },
    position);
}

/** Calls demo-verify-session with the request's Cookie header.
 *
 *  onError: continueErrorOutput is not optional on a webhook route. Without
 *  it, a thrown SESSION_INVALID ends the execution, Respond to Webhook never
 *  runs, and the caller receives an empty body with no status code -- which
 *  the frontend cannot map to a message. The node gets a second main output
 *  (index 1) carrying the error, wired to a 401 responder.
 */
function callVerifySession(position) {
  return node('Verify Session', 'n8n-nodes-base.executeWorkflow', 1.3,
    {
      workflowId: {
        __rl: true,
        value: VERIFY_SESSION_WORKFLOW_ID,
        mode: 'list',
        cachedResultUrl: '/workflow/' + VERIFY_SESSION_WORKFLOW_ID,
        cachedResultName: 'demo-verify-session',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {},
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {},
    },
    position,
    { onError: 'continueErrorOutput' });
}

// ---------------------------------------------------------------------------
// demo-upload-status
//
// The simplest public route, and the one that proves the webhook round trip.
//
// It is also the route the final review flagged: it is the ONLY endpoint whose
// request body carries a record identifier. The query below pairs that
// client-supplied upload_id with the session_id from the VERIFIED token, so an
// id guessed from another visitor returns nothing. Dropping the session_id
// clause would still pass every structural test and would leak another
// visitor's filename, status and error string.
// ---------------------------------------------------------------------------
const shapeCookieCode = `// The sub-workflow takes the raw Cookie header and nothing else. Everything
// the route needs from the request is read later from $('Webhook'), so no
// client value can reach the session lookup.
const req = $input.first().json;
return [{ json: { cookie_header: (req.headers && req.headers.cookie) || '' } }];
`;

const uploadStatusSql =
  'SELECT status, error, chunk_count, page_count\n' +
  'FROM demo_uploads\n' +
  'WHERE id = $2::uuid\n' +
  '  AND session_id = $1::uuid';

const uploadStatus = workflow(
  'demo-upload-status',
  [
    webhookNode('Webhook', 'POST', 'upload-status', [0, 0]),
    node('Shape Cookie', 'n8n-nodes-base.code', 2, { jsCode: shapeCookieCode }, [208, 0]),
    callVerifySession([416, 0]),
    node('Load Status', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: uploadStatusSql,
        // $1 is the verified session, $2 the client's upload_id. Both, always.
        options: {
          queryReplacement:
            "={{ [$json.session_id, $('Webhook').first().json.body.upload_id] }}",
        },
      },
      [624, 0],
      {
        credentials: { postgres: PG_CRED },
        retryOnFail: true,
        // Zero rows is a LEGITIMATE outcome here -- a stale upload_id, or one
        // belonging to another session. Without this, a no-rows query emits no
        // items, n8n does not run the downstream node, Respond to Webhook
        // never fires, and the caller is left hanging on a request that n8n
        // reports as "Succeeded". alwaysOutputData emits one empty item so the
        // route still answers.
        alwaysOutputData: true,
      }),
    respondNode('Respond',
      '={{ JSON.stringify($json || {}) }}', 200, [832, 0]),
    // The error branch. A missing, forged or expired cookie lands here with a
    // typed code the page maps to a sentence -- never a bare empty body.
    respondNode('Respond Unauthorized',
      '={{ JSON.stringify({ code: "SESSION_INVALID" }) }}', 401, [832, 176]),
  ],
  {
    Webhook: { main: [[{ node: 'Shape Cookie', type: 'main', index: 0 }]] },
    'Shape Cookie': { main: [[{ node: 'Verify Session', type: 'main', index: 0 }]] },
    // Two outputs: index 0 is success, index 1 is the error branch created by
    // onError: continueErrorOutput.
    'Verify Session': {
      main: [
        [{ node: 'Load Status', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Load Status': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
  }
);

// ---------------------------------------------------------------------------
// demo-request-code
//
// The gate's first half. Turnstile is verified BEFORE anything else runs,
// because the attack this endpoint faces is scripted by definition.
//
// Both rejection paths return the same 202 as success. A different response
// for "over quota" or "failed Turnstile" tells an attacker which addresses
// tripped a limit, which is free reconnaissance. A visitor who genuinely hit
// a limit learns it when no email arrives.
// ---------------------------------------------------------------------------
const quotaSql =
  'SELECT\n' +
  '  (SELECT count(*) FROM demo_sessions\n' +
  "     WHERE email_canonical = public.demo_canonical_email($1::text)\n" +
  "       AND created_at > now() - interval '1 day') < 3\n" +
  '  AND\n' +
  '  (SELECT count(*) FROM demo_email_codes\n' +
  "     WHERE email_canonical = public.demo_canonical_email($1::text)\n" +
  "       AND created_at > now() - interval '1 hour') < 3\n" +
  '  AS allowed';

const generateCodeJs = `const crypto = require('crypto');

const body = $('Webhook').first().json.body || {};
const email = String(body.email || '').trim().toLowerCase();
const consent = body.consent === true || body.consent === 'true';

// Returned, not thrown. A malformed address and a missing tick are the
// visitor getting it wrong; a missing pepper below is us getting it wrong.
// Throwing for both would put them on the same wire, and the alert hanging
// off this node's error output would page someone every time somebody
// mistypes their email address.
//
// Shape check only. Deliverability is proven by the code arriving.
if (!/^[^@\\s]+@[^@\\s.]+\\.[^@\\s]+$/.test(email)) return [{ json: { ok: false } }];
if (!consent) return [{ json: { ok: false } }];

// randomInt is uniform and unpredictable; Math.random() is neither.
const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const pepper = $env.DEMO_CODE_PEPPER;
if (!pepper) throw new Error('DEMO_CODE_PEPPER is not set on the n8n container');
const codeHash = crypto.createHmac('sha256', pepper).update(code).digest('hex');

// The unsubscribe link is signed so it cannot be used to remove, or
// enumerate, anyone else's address.
const secret = $env.DEMO_SESSION_SECRET;
if (!secret) throw new Error('DEMO_SESSION_SECRET is not set on the n8n container');
const unsubMac = crypto.createHmac('sha256', secret).update('unsub:' + email).digest('base64')
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const unsubToken = Buffer.from(email).toString('base64url') + '.' + unsubMac;

return [{ json: { ok: true, email, code, code_hash: codeHash, unsub_token: unsubToken } }];
`;

const storeCodeSql =
  'INSERT INTO demo_email_codes (email, code_hash, expires_at)\n' +
  "VALUES ($1::citext, $2::text, now() + interval '10 minutes')";

const requestCode = workflow(
  'demo-request-code',
  [
    webhookNode('Webhook', 'POST', 'request-code', [0, 0]),

    node('Verify Turnstile', 'n8n-nodes-base.httpRequest', 4.2,
      {
        method: 'POST',
        url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          "={{ JSON.stringify({ secret: $env.TURNSTILE_SECRET, response: $json.body.turnstile_token, remoteip: $json.headers['cf-connecting-ip'] || '' }) }}",
        options: { timeout: 10000 },
      },
      [208, 0],
      { onError: 'continueErrorOutput' }),

    ifBooleanNode('Turnstile OK?', '={{ $json.success }}', [416, 0]),

    node('Check Quota', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: quotaSql,
        options: { queryReplacement: "={{ [$('Webhook').first().json.body.email] }}" },
      },
      [624, -96],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true, onError: 'continueErrorOutput' }),

    ifBooleanNode('Within Quota?', '={{ $json.allowed }}', [832, -96]),

    node('Generate Code', 'n8n-nodes-base.code', 2,
      { jsCode: generateCodeJs }, [1040, -192],
      { onError: 'continueErrorOutput' }),

    node('Store Code', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: storeCodeSql,
        options: { queryReplacement: '={{ [$json.email, $json.code_hash] }}' },
      },
      [1248, -192],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    node('Send Code Email', 'n8n-nodes-base.emailSend', 2.1,
      {
        fromEmail: 'no-reply@adaptivetech.ro',
        toEmail: "={{ $('Generate Code').first().json.email }}",
        subject: 'Codul tău pentru demo-ul Adaptive Technologies',
        emailFormat: 'text',
        text:
          "={{ 'Codul tău este: ' + $('Generate Code').first().json.code + " +
          "'\\n\\nExpiră în 10 minute.\\n\\nDacă nu ai cerut acest cod, ignoră acest mesaj.\\n\\n" +
          "Nu mai vrei emailuri de la noi? ' + $env.DEMO_PUBLIC_ORIGIN + " +
          "'/api/demo/unsubscribe?t=' + $('Generate Code').first().json.unsub_token }}",
        options: {},
      },
      [1456, -192],
      { credentials: { smtp: SMTP_CRED } }),

    respondNode('Respond Accepted',
      '={{ JSON.stringify({ ok: true }) }}', 202, [1664, -192]),

    // Every rejection lands here with the identical body and status. Turnstile
    // failure, over quota, bad email shape, missing consent -- all the same.
    respondNode('Respond Accepted (rejected)',
      '={{ JSON.stringify({ ok: true }) }}', 202, [1664, 96]),

    ifBooleanNode('Input OK?', '={{ $json.ok }}', [1144, -192]),

    // Byte-identical to the rejection response above. A caller still cannot
    // tell a broken Turnstile call from a spent quota from a mistyped
    // address -- that indistinguishability is the whole design. The only
    // difference is that this branch wakes someone up.
    respondNode('Respond Accepted (failed)',
      '={{ JSON.stringify({ ok: true }) }}', 202, [1664, 240]),

    raiseForAlertNode('demo-request-code could not issue a code', [1872, 240]),
  ],
  {
    Webhook: { main: [[{ node: 'Verify Turnstile', type: 'main', index: 0 }]] },
    // Throughout: output 0 is the business path, output 1 is the node
    // FAILING. Those are different events wearing the same 202, and only the
    // second one is worth waking someone for.
    'Verify Turnstile': {
      main: [
        [{ node: 'Turnstile OK?', type: 'main', index: 0 }],
        [{ node: 'Respond Accepted (failed)', type: 'main', index: 0 }],
      ],
    },
    // A visitor who fails the challenge is the gate working.
    'Turnstile OK?': {
      main: [
        [{ node: 'Check Quota', type: 'main', index: 0 }],
        [{ node: 'Respond Accepted (rejected)', type: 'main', index: 0 }],
      ],
    },
    'Check Quota': {
      main: [
        [{ node: 'Within Quota?', type: 'main', index: 0 }],
        [{ node: 'Respond Accepted (failed)', type: 'main', index: 0 }],
      ],
    },
    // A spent quota is the limit working.
    'Within Quota?': {
      main: [
        [{ node: 'Generate Code', type: 'main', index: 0 }],
        [{ node: 'Respond Accepted (rejected)', type: 'main', index: 0 }],
      ],
    },
    // Output 1 here is now only a missing DEMO_CODE_PEPPER or
    // DEMO_SESSION_SECRET -- a misconfiguration that silently sends nobody
    // an email, which is exactly the failure this alerting exists for.
    'Generate Code': {
      main: [
        [{ node: 'Input OK?', type: 'main', index: 0 }],
        [{ node: 'Respond Accepted (failed)', type: 'main', index: 0 }],
      ],
    },
    'Input OK?': {
      main: [
        [{ node: 'Store Code', type: 'main', index: 0 }],
        [{ node: 'Respond Accepted (rejected)', type: 'main', index: 0 }],
      ],
    },
    // Store Code and Send Code Email carry no onError at all, so a database
    // or SMTP failure fails the execution by itself and already alerts.
    'Store Code': { main: [[{ node: 'Send Code Email', type: 'main', index: 0 }]] },
    'Send Code Email': { main: [[{ node: 'Respond Accepted', type: 'main', index: 0 }]] },
    'Respond Accepted (failed)': { main: [[{ node: 'Raise For Alert', type: 'main', index: 0 }]] },
  }
);

// ---------------------------------------------------------------------------
// demo-verify-code
//
// The gate's second half, and the only place a session is created.
// ---------------------------------------------------------------------------
const loadCodeSql =
  'SELECT id AS code_id, code_hash, attempts,\n' +
  '       (expires_at > now()) AS not_expired\n' +
  'FROM demo_email_codes\n' +
  'WHERE email = $1::citext AND consumed_at IS NULL\n' +
  'ORDER BY created_at DESC\n' +
  'LIMIT 1';

const checkCodeJs = `const crypto = require('crypto');

const submitted = String($('Webhook').first().json.body.code || '').trim();
const row = $input.first().json || {};

const pepper = $env.DEMO_CODE_PEPPER;
if (!pepper) throw new Error('DEMO_CODE_PEPPER is not set on the n8n container');

// No unconsumed code for this address at all: alwaysOutputData gave us an
// empty item rather than ending the execution silently.
if (!row.code_id) {
  return [{ json: { ok: false, code_id: null } }];
}

const expected = crypto.createHmac('sha256', pepper).update(submitted).digest('hex');
const a = Buffer.from(expected);
const b = Buffer.from(String(row.code_hash || ''));

// Length first: timingSafeEqual throws on a mismatch. Both sides are fixed
// width hex, so the length is not a secret.
const macOk = a.length === b.length && crypto.timingSafeEqual(a, b);

const ok = macOk && row.not_expired === true && Number(row.attempts) < 5;

return [{ json: { ok, code_id: row.code_id } }];
`;

// The WHERE consumed_at IS NULL inside the UPDATE is what makes a replay fail:
// a second request finds nothing to consume, the INSERT..SELECT produces no
// row, and no session is created.
const consumeSql =
  'WITH consumed AS (\n' +
  '  UPDATE demo_email_codes SET consumed_at = now()\n' +
  '  WHERE id = $1::uuid AND consumed_at IS NULL\n' +
  '  RETURNING id\n' +
  ')\n' +
  'INSERT INTO demo_sessions (email, expires_at, ip)\n' +
  "SELECT $2::citext, now() + interval '2 hours', $3::inet\n" +
  'FROM consumed\n' +
  'RETURNING id::text AS session_id,\n' +
  '          floor(extract(epoch FROM expires_at) * 1000)::bigint AS expires_ms';

const signTokenGlue = `
// --- node glue below the shared block -------------------------------------
const row = $input.first().json || {};
if (!row.session_id) {
  // The code was already consumed by a concurrent request. Fail closed --
  // but RETURN rather than throw, so this node's error output carries only
  // real misconfiguration. A missing DEMO_SESSION_SECRET below would
  // otherwise be indistinguishable from a replayed code, and would 401
  // every visitor on the site while alerting nobody.
  return [{ json: { ok: false } }];
}

const secret = $env.DEMO_SESSION_SECRET;
if (!secret) throw new Error('DEMO_SESSION_SECRET is not set on the n8n container');

// expires_ms arrives floored from SQL; Number() keeps signToken's integer
// guard satisfied whether the driver hands back a bigint as string or number.
const expiresMs = Number(row.expires_ms);
const token = signToken(row.session_id, expiresMs, secret);

return [{ json: { ok: true, session_id: row.session_id, token, expires_ms: expiresMs } }];
`;

// Skipped for suppressed addresses: unsubscribing means "stop contacting me",
// not "revoke my access", so the session is still issued above.
const upsertLeadSql =
  'INSERT INTO demo_leads (email, consent_at, sessions_count, last_ip)\n' +
  'SELECT $1::citext, now(), 1, $2::inet\n' +
  '-- Canonical: someone who unsubscribed me@gmail.com asked not to be\n' +
  '-- contacted, and me+demo@gmail.com is the same inbox. Matching the\n' +
  '-- exact string would keep mailing them under any alias.\n' +
  'WHERE NOT EXISTS (\n' +
  '  SELECT 1 FROM demo_suppressions\n' +
  '  WHERE email_canonical = public.demo_canonical_email($1::text)\n' +
  ')\n' +
  'ON CONFLICT (email) DO UPDATE\n' +
  'SET last_seen_at = now(),\n' +
  '    sessions_count = demo_leads.sessions_count + 1,\n' +
  '    last_ip = excluded.last_ip';

const countAttemptSql =
  'UPDATE demo_email_codes SET attempts = attempts + 1\n' +
  'WHERE id = (SELECT id FROM demo_email_codes\n' +
  '            WHERE email = $1::citext AND consumed_at IS NULL\n' +
  '            ORDER BY created_at DESC LIMIT 1)';

const verifyCode = workflow(
  'demo-verify-code',
  [
    webhookNode('Webhook', 'POST', 'verify-code', [0, 0]),

    node('Load Latest Code', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: loadCodeSql,
        options: { queryReplacement: '={{ [$json.body.email] }}' },
      },
      [208, 0],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    node('Check Code', 'n8n-nodes-base.code', 2,
      { jsCode: checkCodeJs }, [416, 0]),

    ifBooleanNode('Code Valid?', '={{ $json.ok }}', [624, 0]),

    node('Consume And Create Session', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: consumeSql,
        options: {
          queryReplacement:
            "={{ [$json.code_id, $('Webhook').first().json.body.email, $('Webhook').first().json.headers['cf-connecting-ip'] || null] }}",
        },
      },
      [832, -96],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    node('Sign Token', 'n8n-nodes-base.code', 2,
      { jsCode: shared('demo-session.js') + signTokenGlue }, [1040, -96],
      { onError: 'continueErrorOutput' }),

    node('Upsert Lead', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: upsertLeadSql,
        options: {
          queryReplacement:
            "={{ [$('Webhook').first().json.body.email, $('Webhook').first().json.headers['cf-connecting-ip'] || null] }}",
        },
      },
      [1248, -96],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    // httpOnly keeps injected script from reading it; SameSite=Strict keeps
    // another site from riding it; Path=/api/demo keeps it off every other
    // request to this origin.
    node('Respond With Cookie', 'n8n-nodes-base.respondToWebhook', 1.5,
      {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ ok: true, messages_left: 10 }) }}',
        options: {
          responseHeaders: {
            entries: [
              {
                name: 'Set-Cookie',
                value:
                  "={{ 'demo_session=' + $('Sign Token').first().json.token + '; Path=/api/demo; HttpOnly; Secure; SameSite=Strict; Max-Age=7200' }}",
              },
            ],
          },
        },
      },
      [1456, -96]),

    node('Count Attempt', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: countAttemptSql,
        options: { queryReplacement: "={{ [$('Webhook').first().json.body.email] }}" },
      },
      [832, 128],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    respondNode('Respond Bad Code',
      '={{ JSON.stringify({ code: "BAD_CODE" }) }}', 401, [1040, 128]),

    ifBooleanNode('Token Signed?', '={{ $json.ok }}', [1144, -96]),

    // Same 401 the caller would get for a bad code -- they learn nothing
    // extra from our configuration being broken.
    respondNode('Respond Bad Code (failed)',
      '={{ JSON.stringify({ code: "BAD_CODE" }) }}', 401, [1040, 272]),

    raiseForAlertNode('demo-verify-code could not sign a session token', [1248, 272]),
  ],
  {
    Webhook: { main: [[{ node: 'Load Latest Code', type: 'main', index: 0 }]] },
    'Load Latest Code': { main: [[{ node: 'Check Code', type: 'main', index: 0 }]] },
    'Check Code': { main: [[{ node: 'Code Valid?', type: 'main', index: 0 }]] },
    'Code Valid?': {
      main: [
        [{ node: 'Consume And Create Session', type: 'main', index: 0 }],
        [{ node: 'Count Attempt', type: 'main', index: 0 }],
      ],
    },
    'Consume And Create Session': { main: [[{ node: 'Sign Token', type: 'main', index: 0 }]] },
    // Output 1 is now only a missing DEMO_SESSION_SECRET, never a replayed
    // code -- so it can alert without paging on ordinary replay attempts.
    'Sign Token': {
      main: [
        [{ node: 'Token Signed?', type: 'main', index: 0 }],
        [{ node: 'Respond Bad Code (failed)', type: 'main', index: 0 }],
      ],
    },
    'Token Signed?': {
      main: [
        [{ node: 'Upsert Lead', type: 'main', index: 0 }],
        [{ node: 'Respond Bad Code', type: 'main', index: 0 }],
      ],
    },
    'Respond Bad Code (failed)': { main: [[{ node: 'Raise For Alert', type: 'main', index: 0 }]] },
    'Upsert Lead': { main: [[{ node: 'Respond With Cookie', type: 'main', index: 0 }]] },
    'Count Attempt': { main: [[{ node: 'Respond Bad Code', type: 'main', index: 0 }]] },
  }
);

// ---------------------------------------------------------------------------
// demo-upload  (part 1 of 2: accept, validate, claim the slot, respond)
//
// Extraction and embedding are deliberately not here yet. This half carries
// the unknowns -- reading a multipart upload out of binary storage, and the
// atomic slot claim -- and those are worth proving on the live instance
// before a Gemini pipeline is stacked on top of them.
//
// Until part 2 lands the upload sits at status 'pending' and the frontend
// polls upload-status forever, then gives up with STALLED. That is the
// honest intermediate state, not a broken one.
// ---------------------------------------------------------------------------

// 10 MB. The frontend's FILE_TOO_LARGE copy promises exactly this number, so
// the two must not drift.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const validateUploadGlue = `
// --- node glue below the shared block -------------------------------------
// This node sits FIRST, ahead of the session check, for one mechanical
// reason: this.helpers.getBinaryDataBuffer reads the binary attached to the
// CURRENT input item, and the only item carrying the file is the webhook's.
// Verify Session is a sub-workflow whose output is plain JSON, so the file
// would already be gone by the time this ran downstream of it.
//
// The cost is that an unauthenticated caller can make us hash a buffer we
// have already received in full. That is CPU on bytes already paid for, it
// touches no database and no provider, and it fails closed.

const MAX_BYTES = ${MAX_UPLOAD_BYTES};

const req = $('Webhook').first().json;
const cookieHeader = (req.headers && req.headers.cookie) || '';

// Rejections are returned, not thrown. A returned item routes through a
// plain If, where a thrown one would depend on the exact shape of n8n's
// error item -- which differs between node types and is not worth guessing.
function reject(code) {
  return [{ json: { ok: false, code: code, cookie_header: cookieHeader } }];
}

const item = $input.first();
const binary = item.binary || {};
const keys = Object.keys(binary);
// Whatever the multipart field is called. The frontend sends "file", but the
// property name is n8n's to choose and is not worth coupling to.
if (!keys.length) return reject('UNSUPPORTED_TYPE');

const key = keys[0];
const meta = binary[key] || {};

// N8N_DEFAULT_BINARY_DATA_MODE is filesystem, so the bytes are NOT inline on
// the item -- meta.data is empty and this helper is the only way to them.
const buffer = await this.helpers.getBinaryDataBuffer(0, key);

if (!buffer || !buffer.length) return reject('UNSUPPORTED_TYPE');
if (buffer.length > MAX_BYTES) return reject('FILE_TOO_LARGE');

// Against the bytes, never the declared Content-Type, which the caller owns.
const fileType = detectFileType(buffer);
if (!fileType) return reject('UNSUPPORTED_TYPE');

const filename = String(meta.fileName || 'document');

// Materialised here so part 2 is a pure addition: after Verify Session the
// binary is gone (a sub-workflow returns JSON), so the content has to cross
// that boundary as JSON or not at all. Text decodes now; PDF and DOCX go to
// Gemini as base64 anyway, which is the same encoding.
const isText = fileType === 'txt';

return [{
  json: {
    ok: true,
    cookie_header: cookieHeader,
    filename: filename,
    size: buffer.length,
    file_type: fileType,
    text: isText ? buffer.toString('utf8') : '',
    content_b64: isText ? '' : buffer.toString('base64'),
  },
}];
`;

// Models. Extraction and embedding are pinned from the working nodes in the
// WhatsApp bot's ingestion.json, which lives on main -- not on this branch --
// rather than written from memory.
//
// ANSWER_MODEL is the one to change if the account 404s on it: extraction is
// mechanical and runs on the cheap lite model, but the answer is the thing
// the demo is actually selling, so it gets the full flash model.
const EXTRACT_MODEL = 'gemini-2.5-flash-lite';
const EMBED_MODEL = 'gemini-embedding-001';
const ANSWER_MODEL = 'gemini-2.5-flash';

// gemini-embedding-001 caps a batchEmbedContents call at 100 requests, and
// this is also the insert batch: one HTTP call, one INSERT, per group.
const EMBED_BATCH_SIZE = 100;

const prepareExtractionGlue = `
// --- node glue below the shared block -------------------------------------
const file = $('Validate Upload').first().json;

// Gemini's inline_data takes the base64 Validate Upload already produced.
// DOCX is sent with its real Office mime type; if the model rejects it the
// error output marks the upload failed rather than half-succeeding.
const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

return [{
  json: {
    requestBody: {
      contents: [{
        parts: [
          { inline_data: { mime_type: MIME[file.file_type] || 'application/pdf',
                           data: file.content_b64 } },
          { text: 'Extract the contents of this document following the system instructions.' },
        ],
      }],
      systemInstruction: { parts: [{ text: EXTRACTION_PROMPT }] },
      generationConfig: {
        maxOutputTokens: 65536,
        // Extraction, not authorship. Anything higher invents structure.
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    },
  },
}];
`;

const parseExtractionCode = `// Gemini returns the text split across parts. Joining every part matters:
// taking parts[0] alone silently truncates a long document to its first
// fragment, and the loss looks exactly like a short source file.
const res = $input.first().json || {};

const candidate = (res.candidates || [])[0];
if (!candidate) {
  // A safety block or a quota refusal lands here with no candidate at all.
  throw new Error('Gemini returned no candidate: ' + JSON.stringify(res).slice(0, 400));
}

const parts = (candidate.content && candidate.content.parts) || [];
const text = parts.map(function (p) { return p.text || ''; }).join('');

return [{ json: { text: text } }];
`;

const chunkDocumentGlue = `
// --- node glue below the shared block -------------------------------------
// Reached from either extraction branch, which both hand over { text }.
const text = ($input.first().json || {}).text || '';
const file = $('Validate Upload').first().json;
const sessionId = $('Verify Session').first().json.session_id;

// Returned, not thrown, so the caller routes through an If rather than
// depending on the shape of an n8n error item.
function fail(code) {
  return [{ json: { ok: false, code: code, total_chunks: 0 } }];
}

if (!text.trim()) return fail('NO_TEXT_LAYER');

let chunks;
try {
  chunks = chunkDocument(file.filename, text);
} catch (e) {
  // chunkDocument throws past MAX_CHUNKS. A scanned PDF is the common case
  // for empty output; an oversized one is the common case for this.
  return fail('NO_TEXT_LAYER');
}

// A document that produced text but no chunks is text-free in every way
// that matters here -- whitespace, or headings with nothing under them.
if (!chunks.length) return fail('NO_TEXT_LAYER');

// One item per batch: each becomes one embed call and one INSERT.
const out = [];
for (let i = 0; i < chunks.length; i += ${EMBED_BATCH_SIZE}) {
  const batch = chunks.slice(i, i + ${EMBED_BATCH_SIZE});
  out.push({
    json: {
      ok: true,
      session_id: sessionId,
      total_chunks: chunks.length,
      chunks: batch,
      requestBody: {
        requests: batch.map(function (c) {
          return {
            model: 'models/gemini-embedding-001',
            content: { parts: [{ text: c.text }] },
            // RETRIEVAL_DOCUMENT, paired with RETRIEVAL_QUERY at search
            // time. Mismatching the two costs real retrieval quality.
            taskType: 'RETRIEVAL_DOCUMENT',
            title: c.original_file_name.replace(/\\.[^.]+$/, '') + ' \\u2014 ' + c.section_heading,
            outputDimensionality: 1536,
          };
        }),
      },
    },
  });
}

return out;
`;

const formatForInsertCode = `// Pairs each embedding back with its chunk and hands the batch over as a
// single JSON parameter.
//
// L2 normalisation is NOT optional: gemini-embedding-001 returns
// pre-normalised vectors only at 3072 dimensions. At the 1536 used here the
// vectors come back unnormalised, and demo_hybrid_search assumes unit length
// -- skip this and cosine distance silently ranks by magnitude.
function l2normalize(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm > 0 ? v.map(function (x) { return x / norm; }) : v;
}

// This node runs ONCE for all items, not once per item, so it must loop.
// Chunk Document emits one item per batch and Embed Chunks preserves that
// count, so the two lists line up index for index -- the same pairing
// the bot's own Format for Insert does (workflows/ingestion.json on main).
const items = $input.all();
const batches = $('Chunk Document').all();
const out = [];

for (let i = 0; i < items.length; i++) {
  const res = items[i].json || {};
  const embeddings = res.embeddings;
  if (!Array.isArray(embeddings)) {
    throw new Error('Embedding response ' + i + ' had no embeddings array: ' +
      JSON.stringify(res).slice(0, 400));
  }

  const src = batches[i].json;
  const chunks = src.chunks;

  if (embeddings.length !== chunks.length) {
    // Silently zipping mismatched arrays would attach each chunk's text to
    // another chunk's vector -- retrieval would then return confidently
    // wrong passages with nothing in the data to show why.
    throw new Error('Batch ' + i + ': embedding count ' + embeddings.length +
      ' does not match chunk count ' + chunks.length);
  }

  const rows = chunks.map(function (c, j) {
    const vec = l2normalize(embeddings[j].values);
    return {
      content: c.text,
      metadata: {
        file_name: c.original_file_name,
        section_heading: c.section_heading,
        chunk_index: c.chunk_index,
      },
      // pgvector's text input format.
      embedding: '[' + vec.join(',') + ']',
    };
  });

  out.push({ json: { session_id: src.session_id, rows_json: JSON.stringify(rows) } });
}

return out;
`;

// One statement per batch, and both parameters are scalars -- the batch
// travels as a single jsonb value rather than as an array parameter or as
// interpolated SQL. Nothing from the document is ever concatenated into the
// query text.
const insertChunksSql =
  'INSERT INTO demo_documents (session_id, content, metadata, embedding)\n' +
  "SELECT $1::uuid,\n" +
  "       r->>'content',\n" +
  "       (r->'metadata')::jsonb,\n" +
  "       (r->>'embedding')::vector\n" +
  'FROM jsonb_array_elements($2::jsonb) AS r';

const markFailedSql =
  "UPDATE demo_uploads SET status = 'failed', error = $2::text\n" +
  'WHERE id = $1::uuid';

// One statement, so the limit check and the increment cannot be separated by
// a concurrent request. A second upload finds files_uploaded already at 1,
// `claimed` is empty, the INSERT..SELECT inserts nothing, and no upload_id
// comes back -- the same shape as the code-consumption guard in verify-code.
const claimUploadSql =
  'WITH claimed AS (\n' +
  '  UPDATE demo_sessions SET files_uploaded = files_uploaded + 1\n' +
  '  WHERE id = $1::uuid AND files_uploaded < 1\n' +
  '  RETURNING id\n' +
  ')\n' +
  'INSERT INTO demo_uploads (session_id, filename, status)\n' +
  "SELECT $1::uuid, $2::text, 'pending'\n" +
  'FROM claimed\n' +
  'RETURNING id::text AS upload_id';

const upload = workflow(
  'demo-upload',
  [
    webhookNode('Webhook', 'POST', 'upload', [0, 0]),

    node('Validate Upload', 'n8n-nodes-base.code', 2,
      { jsCode: shared('demo-filetype.js') + validateUploadGlue }, [208, 0]),

    ifBooleanNode('File OK?', '={{ $json.ok }}', [416, 0]),

    callVerifySession([624, -96]),

    node('Claim Upload Slot', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: claimUploadSql,
        options: {
          queryReplacement:
            "={{ [$json.session_id, $('Validate Upload').first().json.filename] }}",
        },
      },
      [832, -192],
      {
        credentials: { postgres: PG_CRED },
        // Zero rows is the LIMIT being enforced, not a failure. Without this
        // the route would answer nothing at all to a second upload.
        alwaysOutputData: true,
      }),

    ifBooleanNode('Slot Claimed?', '={{ !!$json.upload_id }}', [1040, -192]),

    // 202, not 200: the row exists at status 'pending' and the work has not
    // happened yet. The frontend takes upload_id and starts polling.
    respondNode('Respond Accepted',
      '={{ JSON.stringify({ upload_id: $json.upload_id }) }}', 202, [1248, -288]),

    respondNode('Respond Upload Limit',
      '={{ JSON.stringify({ code: "UPLOAD_LIMIT" }) }}', 403, [1248, -96]),

    respondNode('Respond Session Invalid',
      '={{ JSON.stringify({ code: "SESSION_INVALID" }) }}', 401, [832, 96]),

    // FILE_TOO_LARGE or UNSUPPORTED_TYPE, both of which the frontend already
    // has copy for. The code comes from Validate Upload's own vocabulary, so
    // no internal message can reach the client through here.
    respondNode('Respond Bad File',
      '={{ JSON.stringify({ code: $json.code }) }}', 400, [624, 224]),

    // --- part 2: everything below runs AFTER the client has its 202 -------
    //
    // n8n keeps executing past Respond to Webhook, so this is the whole
    // point of the 202: the browser is already polling upload-status while
    // this runs. Nothing down here can talk to the client, so every failure
    // path must WRITE demo_uploads.status -- an unhandled throw would leave
    // the row on 'pending' and the visitor watching a spinner for five
    // minutes before the frontend gives up with STALLED.

    node('Mark Extracting', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: "UPDATE demo_uploads SET status = 'extracting' WHERE id = $1::uuid",
        options: { queryReplacement: '={{ [$json.upload_id] }}' },
      },
      [1456, -288],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    ifBooleanNode('Is Plain Text?',
      "={{ $('Validate Upload').first().json.file_type === 'txt' }}", [1664, -288]),

    node('Use Plain Text', 'n8n-nodes-base.code', 2,
      {
        jsCode:
          '// Already decoded in Validate Upload. No model call for a .txt file:\n' +
          '// it costs tokens and can only lose fidelity against bytes we can read.\n' +
          "return [{ json: { text: $('Validate Upload').first().json.text || '' } }];\n",
      },
      [1872, -400]),

    node('Prepare Extraction', 'n8n-nodes-base.code', 2,
      { jsCode: shared('demo-extraction-prompt.js') + prepareExtractionGlue },
      [1872, -192]),

    // 10 minutes, matching the bot's ingestion on main. A long PDF genuinely takes
    // minutes, and the client is polling rather than waiting on a socket.
    geminiNode('Gemini Extract', EXTRACT_MODEL, 'generateContent',
      [2080, -192], { timeout: 600000 }, { onError: 'continueErrorOutput' }),

    node('Parse Extraction', 'n8n-nodes-base.code', 2,
      { jsCode: parseExtractionCode }, [2288, -192],
      { onError: 'continueErrorOutput' }),

    node('Chunk Document', 'n8n-nodes-base.code', 2,
      { jsCode: shared('demo-chunker.js') + chunkDocumentGlue }, [2496, -288]),

    ifBooleanNode('Has Chunks?', '={{ $json.ok }}', [2704, -288]),

    // One batch at a time with a gap between them: the free tier's rate
    // limit is the binding constraint, not throughput.
    geminiNode('Embed Chunks', EMBED_MODEL, 'batchEmbedContents', [2912, -400],
      { timeout: 120000, batching: { batch: { batchSize: 1, batchInterval: 2000 } } },
      { onError: 'continueErrorOutput' }),

    node('Format For Insert', 'n8n-nodes-base.code', 2,
      { jsCode: formatForInsertCode }, [3120, -400],
      { onError: 'continueErrorOutput' }),

    node('Insert Chunks', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: insertChunksSql,
        options: {
          queryReplacement: '={{ [$json.session_id, $json.rows_json] }}',
        },
      },
      [3328, -400],
      { credentials: { postgres: PG_CRED }, onError: 'continueErrorOutput' }),

    node('Mark Ready', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query:
          "UPDATE demo_uploads SET status = 'ready', chunk_count = $2::int\n" +
          'WHERE id = $1::uuid',
        options: {
          queryReplacement:
            "={{ [$('Claim Upload Slot').first().json.upload_id, " +
            "$('Chunk Document').first().json.total_chunks] }}",
        },
      },
      [3536, -400],
      {
        credentials: { postgres: PG_CRED },
        // Insert Chunks emits one item per batch; the row is marked ready
        // once, not once per batch.
        executeOnce: true,
        alwaysOutputData: true,
      }),

    // Two failure writers rather than one, so neither has to read the shape
    // of an n8n error item -- which differs by node type and is not worth
    // guessing. Which node failed decides which code the visitor sees.
    node('Mark Failed No Text', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: markFailedSql,
        options: {
          queryReplacement:
            "={{ [$('Claim Upload Slot').first().json.upload_id, 'NO_TEXT_LAYER'] }}",
        },
      },
      [2912, -160],
      { credentials: { postgres: PG_CRED }, executeOnce: true, alwaysOutputData: true }),

    node('Mark Failed Unavailable', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: markFailedSql,
        options: {
          queryReplacement:
            "={{ [$('Claim Upload Slot').first().json.upload_id, 'UNAVAILABLE'] }}",
        },
      },
      [3120, 0],
      { credentials: { postgres: PG_CRED }, executeOnce: true, alwaysOutputData: true }),

    // Only the UNAVAILABLE writer raises. Mark Failed No Text is a scanned
    // PDF -- the demo working correctly on a document it cannot read.
    raiseForAlertNode('demo-upload failed while processing an upload', [3328, 0]),
  ],
  {
    Webhook: { main: [[{ node: 'Validate Upload', type: 'main', index: 0 }]] },
    'Validate Upload': { main: [[{ node: 'File OK?', type: 'main', index: 0 }]] },
    'File OK?': {
      main: [
        [{ node: 'Verify Session', type: 'main', index: 0 }],
        [{ node: 'Respond Bad File', type: 'main', index: 0 }],
      ],
    },
    'Verify Session': {
      main: [
        [{ node: 'Claim Upload Slot', type: 'main', index: 0 }],
        [{ node: 'Respond Session Invalid', type: 'main', index: 0 }],
      ],
    },
    'Claim Upload Slot': { main: [[{ node: 'Slot Claimed?', type: 'main', index: 0 }]] },
    'Slot Claimed?': {
      main: [
        [{ node: 'Respond Accepted', type: 'main', index: 0 }],
        [{ node: 'Respond Upload Limit', type: 'main', index: 0 }],
      ],
    },
    // Part 2 hangs off Respond Accepted, so the client is never waiting on it.
    'Respond Accepted': { main: [[{ node: 'Mark Extracting', type: 'main', index: 0 }]] },
    'Mark Extracting': { main: [[{ node: 'Is Plain Text?', type: 'main', index: 0 }]] },
    'Is Plain Text?': {
      main: [
        [{ node: 'Use Plain Text', type: 'main', index: 0 }],
        [{ node: 'Prepare Extraction', type: 'main', index: 0 }],
      ],
    },
    // Both extraction routes converge on the chunker: whichever branch ran,
    // it hands over the same { text } shape.
    'Use Plain Text': { main: [[{ node: 'Chunk Document', type: 'main', index: 0 }]] },
    'Prepare Extraction': { main: [[{ node: 'Gemini Extract', type: 'main', index: 0 }]] },
    'Gemini Extract': {
      main: [
        [{ node: 'Parse Extraction', type: 'main', index: 0 }],
        [{ node: 'Mark Failed Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Parse Extraction': {
      main: [
        [{ node: 'Chunk Document', type: 'main', index: 0 }],
        [{ node: 'Mark Failed Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Chunk Document': { main: [[{ node: 'Has Chunks?', type: 'main', index: 0 }]] },
    'Has Chunks?': {
      main: [
        [{ node: 'Embed Chunks', type: 'main', index: 0 }],
        [{ node: 'Mark Failed No Text', type: 'main', index: 0 }],
      ],
    },
    'Embed Chunks': {
      main: [
        [{ node: 'Format For Insert', type: 'main', index: 0 }],
        [{ node: 'Mark Failed Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Format For Insert': {
      main: [
        [{ node: 'Insert Chunks', type: 'main', index: 0 }],
        [{ node: 'Mark Failed Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Insert Chunks': {
      main: [
        [{ node: 'Mark Ready', type: 'main', index: 0 }],
        [{ node: 'Mark Failed Unavailable', type: 'main', index: 0 }],
      ],
    },
    // The row is already marked failed and the client is already polling it;
    // this only fails the execution so the alert fires.
    'Mark Failed Unavailable': { main: [[{ node: 'Raise For Alert', type: 'main', index: 0 }]] },
  }
);

// ---------------------------------------------------------------------------
// demo-chat
//
// The only route that spends model tokens on free-form visitor input, so the
// order of the gates matters: the message slot is claimed BEFORE the query is
// embedded, and retrieval decides whether Claude is called at all.
// ---------------------------------------------------------------------------

// Matches MESSAGE_LIMIT in website/demo/demo.js. The two must not drift --
// the frontend disables the composer at zero, the server enforces it.
const MESSAGE_LIMIT = 10;

// Below this cosine similarity the document has nothing to say about the
// question, and calling Claude buys a confident paragraph of nothing. This is
// what best_similarity exists for: the `similarity` column is an RRF score
// and always ranks something first, however unrelated. Deliberately generous
// -- a false "not in the document" is worse for a demo than a wasted call.
const RELEVANCE_FLOOR = 0.25;

const claimMessageSql =
  'UPDATE demo_sessions SET messages_used = messages_used + 1\n' +
  'WHERE id = $1::uuid AND messages_used < ' + MESSAGE_LIMIT + '\n' +
  'RETURNING id::text AS session_id,\n' +
  '          (' + MESSAGE_LIMIT + ' - messages_used) AS messages_left';

const prepareQueryCode = `const message = String(($('Webhook').first().json.body || {}).message || '').trim();

// A 4000-character "question" is not a question; it is an attempt to make us
// embed a document. The composer cannot produce one.
if (!message) throw new Error('EMPTY_MESSAGE');
const query = message.slice(0, 1000);

return [{
  json: {
    query: query,
    requestBody: {
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: query }] },
      // RETRIEVAL_QUERY here against RETRIEVAL_DOCUMENT at ingest. Using the
      // same task type on both sides measurably degrades retrieval.
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 1536,
    },
  },
}];
`;

const normaliseQueryCode = `// Same normalisation as ingest, for the same reason: gemini-embedding-001
// returns unit vectors only at 3072 dimensions, and demo_hybrid_search
// assumes unit length on both sides of the comparison.
function l2normalize(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm > 0 ? v.map(function (x) { return x / norm; }) : v;
}

const res = $input.first().json || {};
const values = res.embedding && res.embedding.values;
if (!Array.isArray(values)) {
  throw new Error('Embedding response had no values: ' + JSON.stringify(res).slice(0, 300));
}

return [{ json: { embedding: '[' + l2normalize(values).join(',') + ']' } }];
`;

const searchSql =
  'SELECT content, metadata, best_similarity\n' +
  'FROM demo_hybrid_search($1::text, $2::vector, $3::uuid, 8)';

const historySql =
  'SELECT role, content FROM demo_messages\n' +
  'WHERE session_id = $1::uuid\n' +
  'ORDER BY id DESC\n' +
  'LIMIT 10';

const buildPromptCode = `const SYSTEM = [
  'You answer questions about one document that the user uploaded.',
  '',
  'Rules:',
  '- Answer ONLY from the excerpts provided below. They are the whole of what',
  '  you know about this document.',
  '- If the excerpts do not contain the answer, say so plainly and stop. Do',
  '  not fall back on general knowledge, and do not speculate.',
  '- Answer in the language the question is written in.',
  '- Be concise. Two or three sentences unless the question needs more.',
].join('\\n');

// alwaysOutputData means a search with no hits still emits one item, so rows
// without content are filtered rather than trusted.
const hits = $('Hybrid Search').all()
  .map(function (i) { return i.json; })
  .filter(function (r) { return r && r.content; });

const top = hits.length ? Number(hits[0].best_similarity || 0) : 0;

// Nothing relevant: answered without a model call. The route still records
// the message and returns normally -- this is an answer, not an error.
if (!hits.length || top < ${RELEVANCE_FLOOR}) {
  return [{ json: { grounded: false, sources: [], input_tokens: 0, output_tokens: 0 } }];
}

const context = hits.map(function (r, i) {
  const m = r.metadata || {};
  return '[' + (i + 1) + '] ' + (m.section_heading || m.file_name || 'excerpt') +
    '\\n' + r.content;
}).join('\\n\\n');

// Oldest first: the history query orders newest first so LIMIT takes the
// most recent, and the model needs them the other way round.
//
// Gemini names the assistant turn 'model', not 'assistant', and rejects the
// Anthropic spelling. It also requires the conversation to START on a user
// turn, so any leading model turn is dropped -- that can only happen if a
// write was interrupted mid-pair, but it would 400 the whole request.
let history = $input.all()
  .map(function (i) { return i.json; })
  .filter(function (r) { return r && r.role && r.content; })
  .reverse()
  .map(function (r) {
    return {
      role: r.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(r.content) }],
    };
  });
while (history.length && history[0].role !== 'user') history.shift();

const question = $('Prepare Query').first().json.query;

// One source chip per file+section pair, in retrieval order.
const seen = new Set();
const sources = [];
for (const r of hits) {
  const m = r.metadata || {};
  const file = m.file_name || 'document';
  let section = m.section_heading || '';
  // The chunker falls back to the document title when a file has no "##"
  // headings, which renders as "notes.txt — notes". Drop the section in that
  // case; the frontend already shows the filename alone when section is ''.
  if (section && section === file.replace(/\\.[^.]+$/, '')) section = '';
  const key = file + '|' + section;
  if (seen.has(key)) continue;
  seen.add(key);
  sources.push({ file: file, section: section });
}

return [{
  json: {
    grounded: true,
    sources: sources,
    requestBody: {
      contents: history.concat([{ role: 'user', parts: [{ text: question }] }]),
      // The excerpts ride in the system instruction rather than in the user
      // turn, so a visitor's question can never be mistaken for part of the
      // document -- or the other way round.
      systemInstruction: {
        parts: [{ text: SYSTEM + '\\n\\nExcerpts from the document:\\n\\n' + context }],
      },
      generationConfig: {
        maxOutputTokens: 1024,
        // Grounded answering, not writing. Higher and it starts smoothing
        // over gaps in the excerpts with plausible invention.
        temperature: 0.2,
      },
    },
  },
}];
`;

const parseAnswerCode = `const res = $input.first().json || {};

const candidate = (res.candidates || [])[0];
if (!candidate) {
  // No candidate at all means a safety block or a quota refusal. The reason
  // is in promptFeedback, which is worth keeping in the execution log.
  throw new Error('Gemini returned no candidate: ' + JSON.stringify(res).slice(0, 400));
}

// Gemini splits an answer across parts. Join them; taking parts[0] alone
// truncates a long answer to its first fragment.
const parts = (candidate.content && candidate.content.parts) || [];
const answer = parts.map(function (p) { return p.text || ''; }).join('').trim();

if (!answer) {
  throw new Error('Gemini returned an empty answer (finishReason: ' +
    (candidate.finishReason || 'unknown') + ')');
}

// promptTokenCount / candidatesTokenCount, not Anthropic's input_tokens /
// output_tokens. Reading the wrong names records every turn as costing zero.
const usage = res.usageMetadata || {};
return [{
  json: {
    answer: answer,
    input_tokens: usage.promptTokenCount || 0,
    output_tokens: usage.candidatesTokenCount || 0,
  },
}];
`;

const noAnswerCode = `// The retrieval floor rejected every hit. Answered in the visitor's own
// language without spending a model call.
const q = $('Prepare Query').first().json.query;
const romanian = /[ăâîșțĂÂÎȘȚ]/.test(q) || /\\b(ce|cum|care|unde|cand|când|este|sunt)\\b/i.test(q);

return [{
  json: {
    answer: romanian
      ? 'Nu am găsit nimic despre asta în documentul încărcat.'
      : "I couldn't find anything about that in the uploaded document.",
    input_tokens: 0,
    output_tokens: 0,
  },
}];
`;

// One statement: both messages and the token accounting land together, so a
// recorded answer always has its cost recorded with it.
const recordTurnSql =
  'WITH m AS (\n' +
  '  INSERT INTO demo_messages (session_id, role, content)\n' +
  "  VALUES ($1::uuid, 'user', $2::text), ($1::uuid, 'assistant', $3::text)\n" +
  ')\n' +
  'UPDATE demo_sessions\n' +
  'SET input_tokens = input_tokens + $4::bigint,\n' +
  '    output_tokens = output_tokens + $5::bigint\n' +
  'WHERE id = $1::uuid\n' +
  // Echoed back so the responder reads one field off its own input. The
  // answer arrives from either Claude or the not-found branch, and only one
  // of those nodes ran -- referencing the wrong one by name throws.
  'RETURNING $3::text AS answer';

const chat = workflow(
  'demo-chat',
  [
    webhookNode('Webhook', 'POST', 'chat', [0, 0]),
    node('Shape Cookie', 'n8n-nodes-base.code', 2, { jsCode: shapeCookieCode }, [208, 0]),
    callVerifySession([416, 0]),

    // Claimed BEFORE anything is embedded or generated, so a caller cannot
    // spend tokens faster than the limit by firing requests in parallel.
    node('Claim Message Slot', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: claimMessageSql,
        options: { queryReplacement: '={{ [$json.session_id] }}' },
      },
      [624, -96],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    ifBooleanNode('Under Limit?', '={{ !!$json.session_id }}', [832, -96]),

    node('Prepare Query', 'n8n-nodes-base.code', 2,
      { jsCode: prepareQueryCode }, [1040, -192],
      { onError: 'continueErrorOutput' }),

    geminiNode('Embed Query', EMBED_MODEL, 'embedContent', [1248, -192],
      { timeout: 30000 }, { onError: 'continueErrorOutput' }),

    node('Normalise Query', 'n8n-nodes-base.code', 2,
      { jsCode: normaliseQueryCode }, [1456, -192],
      { onError: 'continueErrorOutput' }),

    node('Hybrid Search', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: searchSql,
        // The session id comes from the claim, which came from the verified
        // token. The function refuses a null session id outright, so a
        // search across every visitor's documents is unrepresentable here.
        options: {
          queryReplacement:
            "={{ [$('Prepare Query').first().json.query, $json.embedding, " +
            "$('Claim Message Slot').first().json.session_id] }}",
        },
      },
      [1664, -192],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true,
        onError: 'continueErrorOutput' }),

    node('Load History', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: historySql,
        options: {
          queryReplacement:
            "={{ [$('Claim Message Slot').first().json.session_id] }}",
        },
      },
      [1872, -192],
      {
        credentials: { postgres: PG_CRED },
        // Hybrid Search emits one item per hit; without this the history
        // would be re-queried once per hit.
        executeOnce: true,
        // Empty on the first message of a session, which is normal.
        alwaysOutputData: true,
      }),

    node('Build Prompt', 'n8n-nodes-base.code', 2,
      { jsCode: buildPromptCode }, [2080, -192],
      { onError: 'continueErrorOutput' }),

    ifBooleanNode('Grounded?', '={{ $json.grounded }}', [2288, -192]),

    geminiNode('Generate Answer', ANSWER_MODEL, 'generateContent',
      [2496, -288], { timeout: 120000 }, { onError: 'continueErrorOutput' }),

    node('Parse Answer', 'n8n-nodes-base.code', 2,
      { jsCode: parseAnswerCode }, [2704, -288],
      { onError: 'continueErrorOutput' }),

    node('Answer Not Found', 'n8n-nodes-base.code', 2,
      { jsCode: noAnswerCode }, [2496, -64]),

    node('Record Turn', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: recordTurnSql,
        options: {
          queryReplacement:
            "={{ [$('Claim Message Slot').first().json.session_id, " +
            "$('Prepare Query').first().json.query, $json.answer, " +
            '$json.input_tokens, $json.output_tokens] }}',
        },
      },
      [2912, -192],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true }),

    respondNode('Respond',
      '={{ JSON.stringify({ answer: $json.answer, ' +
      "messages_left: $('Claim Message Slot').first().json.messages_left, " +
      "sources: $('Build Prompt').first().json.sources || [] }) }}",
      200, [3120, -192]),

    respondNode('Respond Session Invalid',
      '={{ JSON.stringify({ code: "SESSION_INVALID" }) }}', 401, [624, 128]),

    respondNode('Respond Message Limit',
      '={{ JSON.stringify({ code: "MESSAGE_LIMIT", messages_left: 0 }) }}',
      429, [1040, 64]),

    // Every provider or database failure past the gate lands here. The slot
    // has already been consumed -- deliberately: refunding it on failure
    // would hand an attacker an unlimited retry loop.
    respondNode('Respond Unavailable',
      '={{ JSON.stringify({ code: "UNAVAILABLE" }) }}', 503, [2704, 128]),

    raiseForAlertNode('demo-chat failed after answering the caller', [2912, 128]),
  ],
  {
    Webhook: { main: [[{ node: 'Shape Cookie', type: 'main', index: 0 }]] },
    'Shape Cookie': { main: [[{ node: 'Verify Session', type: 'main', index: 0 }]] },
    'Verify Session': {
      main: [
        [{ node: 'Claim Message Slot', type: 'main', index: 0 }],
        [{ node: 'Respond Session Invalid', type: 'main', index: 0 }],
      ],
    },
    'Claim Message Slot': { main: [[{ node: 'Under Limit?', type: 'main', index: 0 }]] },
    'Under Limit?': {
      main: [
        [{ node: 'Prepare Query', type: 'main', index: 0 }],
        [{ node: 'Respond Message Limit', type: 'main', index: 0 }],
      ],
    },
    'Prepare Query': {
      main: [
        [{ node: 'Embed Query', type: 'main', index: 0 }],
        [{ node: 'Respond Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Embed Query': {
      main: [
        [{ node: 'Normalise Query', type: 'main', index: 0 }],
        [{ node: 'Respond Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Normalise Query': {
      main: [
        [{ node: 'Hybrid Search', type: 'main', index: 0 }],
        [{ node: 'Respond Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Hybrid Search': {
      main: [
        [{ node: 'Load History', type: 'main', index: 0 }],
        [{ node: 'Respond Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Load History': { main: [[{ node: 'Build Prompt', type: 'main', index: 0 }]] },
    'Build Prompt': {
      main: [
        [{ node: 'Grounded?', type: 'main', index: 0 }],
        [{ node: 'Respond Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Grounded?': {
      main: [
        [{ node: 'Generate Answer', type: 'main', index: 0 }],
        [{ node: 'Answer Not Found', type: 'main', index: 0 }],
      ],
    },
    'Generate Answer': {
      main: [
        [{ node: 'Parse Answer', type: 'main', index: 0 }],
        [{ node: 'Respond Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Parse Answer': {
      main: [
        [{ node: 'Record Turn', type: 'main', index: 0 }],
        [{ node: 'Respond Unavailable', type: 'main', index: 0 }],
      ],
    },
    'Answer Not Found': { main: [[{ node: 'Record Turn', type: 'main', index: 0 }]] },
    'Record Turn': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    // The caller has its 503 by now; this only fails the execution so the
    // error workflow is invoked. Session and limit rejections do NOT come
    // through here -- they have their own responders and end there.
    'Respond Unavailable': { main: [[{ node: 'Raise For Alert', type: 'main', index: 0 }]] },
  }
);

// ---------------------------------------------------------------------------
// demo-cleanup
//
// The workflow that makes the privacy policy true. Every interval below is a
// published commitment on /politica-de-confidentialitate, not a preference:
//
//   "Documentele încărcate si fragmentele extrase din ele sunt sterse automat
//    la expirarea sesiunii, la 2 ore de la incarcare. Stergerea propriu-zisa
//    ruleaza o data pe ora, deci un document poate ramane stocat pana la 3 ore."
//   "Intrebarile puse in demo sunt pastrate 30 de zile, complet separate de
//    sesiune."
//
// Hence hourly, not daily: the policy promises a 3 hour worst case, and a
// daily job would make that 26.
// ---------------------------------------------------------------------------

// Deleting the session is the whole document purge. demo_uploads and
// demo_documents cascade from it; demo_messages does NOT -- its FK is
// ON DELETE SET NULL, so questions survive detached, which is exactly the
// 30-day tier below.
const purgeSessionsSql =
  'DELETE FROM demo_sessions WHERE expires_at < now()\n' +
  'RETURNING id';

// Codes are single-use and expire in 10 minutes; a day is generous headroom
// for anyone debugging. They hold an email address, so they do not linger.
const purgeCodesSql =
  "DELETE FROM demo_email_codes WHERE created_at < now() - interval '1 day'\n" +
  'RETURNING id';

const purgeMessagesSql =
  "DELETE FROM demo_messages WHERE created_at < now() - interval '30 days'\n" +
  'RETURNING id';

const cleanup = workflow(
  'demo-cleanup',
  [
    node('Every Hour', 'n8n-nodes-base.scheduleTrigger', 1.3,
      { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } }, [0, 0]),

    node('Purge Expired Sessions', 'n8n-nodes-base.postgres', 2.6,
      { operation: 'executeQuery', query: purgeSessionsSql, options: {} },
      [208, 0],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true, retryOnFail: true }),

    node('Purge Old Codes', 'n8n-nodes-base.postgres', 2.6,
      { operation: 'executeQuery', query: purgeCodesSql, options: {} },
      [416, 0],
      {
        credentials: { postgres: PG_CRED },
        alwaysOutputData: true,
        retryOnFail: true,
        // Nothing to delete is the normal case on a quiet hour, and each step
        // must run regardless of what the one before it found.
        executeOnce: true,
      }),

    node('Purge Old Messages', 'n8n-nodes-base.postgres', 2.6,
      { operation: 'executeQuery', query: purgeMessagesSql, options: {} },
      [624, 0],
      {
        credentials: { postgres: PG_CRED },
        alwaysOutputData: true,
        retryOnFail: true,
        executeOnce: true,
      }),
  ],
  {
    'Every Hour': { main: [[{ node: 'Purge Expired Sessions', type: 'main', index: 0 }]] },
    'Purge Expired Sessions': { main: [[{ node: 'Purge Old Codes', type: 'main', index: 0 }]] },
    'Purge Old Codes': { main: [[{ node: 'Purge Old Messages', type: 'main', index: 0 }]] },
  }
);

// ---------------------------------------------------------------------------
// demo-unsubscribe
//
// The link at the bottom of every code email. It is a GET clicked from a mail
// client, so it answers HTML rather than JSON, and it is reached WITHOUT a
// session -- the token in the URL is the whole authorisation.
//
// That token is HMAC-signed over the address, so it cannot be edited into
// someone else's unsubscribe, and the address cannot be recovered from it
// without the key. Without the signature this endpoint would be a way to
// unsubscribe any address you can guess, and a way to test whether an
// address is in the database.
// ---------------------------------------------------------------------------
const verifyUnsubCode = `const crypto = require('crypto');

const token = String((($('Webhook').first().json.query) || {}).t || '');

const secret = $env.DEMO_SESSION_SECRET;
if (!secret) throw new Error('DEMO_SESSION_SECRET is not set on the n8n container');

function fail() {
  return [{ json: { ok: false, email: null } }];
}

// <base64url(email)>.<mac>, minted by demo-request-code's Generate Code node.
const parts = token.split('.');
if (parts.length !== 2 || !parts[0] || !parts[1]) return fail();

let email;
try {
  email = Buffer.from(parts[0], 'base64url').toString('utf8');
} catch (e) {
  return fail();
}
if (!email || email.length > 320) return fail();

const expected = crypto.createHmac('sha256', secret).update('unsub:' + email).digest('base64')
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

const a = Buffer.from(parts[1]);
const b = Buffer.from(expected);
// Length first: timingSafeEqual throws on a mismatch, and the MAC is a fixed
// width, so its length is not a secret.
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail();

return [{ json: { ok: true, email: email } }];
`;

// Suppression is recorded and the lead row is removed in one statement, so a
// suppressed address cannot survive as a lead if the second half failed.
// ON CONFLICT DO NOTHING makes a second click idempotent rather than an error.
const suppressSql =
  'WITH s AS (\n' +
  '  INSERT INTO demo_suppressions (email) VALUES ($1::citext)\n' +
  '  ON CONFLICT (email) DO NOTHING\n' +
  ')\n' +
  'DELETE FROM demo_leads\n' +
  'WHERE public.demo_canonical_email(email::text)\n' +
  '    = public.demo_canonical_email($1::text)';

// Served as a whole page because a mail client opens this in a browser tab.
// Inline styles only: this response does not pass through Caddy's file server
// and has no stylesheet to link to.
function unsubPage(title, body) {
  return (
    '<!doctype html><html lang="ro"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>' + title + ' — Adaptive Technologies</title></head>' +
    '<body style="margin:0;background:#E7E5DF;color:#0C3054;' +
    'font:17px/1.6 system-ui,-apple-system,sans-serif">' +
    '<main style="max-width:34rem;margin:12vh auto;padding:2.5rem;' +
    'background:#fff;border-radius:14px">' +
    '<h1 style="margin:0 0 .75rem;font-size:1.6rem;letter-spacing:-.02em">' +
    title + '</h1>' +
    '<p style="margin:0 0 1.5rem;color:#16406B">' + body + '</p>' +
    '<a href="https://adaptivetech.ro/" style="display:inline-block;' +
    'background:#0C3054;color:#E7E5DF;padding:.7rem 1.2rem;border-radius:999px;' +
    'text-decoration:none">adaptivetech.ro</a>' +
    '</main></body></html>'
  );
}

function unsubRespondNode(name, html, statusCode, position) {
  return node(name, 'n8n-nodes-base.respondToWebhook', 1.5,
    {
      respondWith: 'text',
      responseBody: html,
      options: {
        responseCode: statusCode,
        responseHeaders: {
          entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        },
      },
    },
    position);
}

const unsubscribe = workflow(
  'demo-unsubscribe',
  [
    webhookNode('Webhook', 'GET', 'unsubscribe', [0, 0]),
    node('Verify Token', 'n8n-nodes-base.code', 2,
      { jsCode: verifyUnsubCode }, [208, 0]),
    ifBooleanNode('Token Valid?', '={{ $json.ok }}', [416, 0]),

    node('Suppress Address', 'n8n-nodes-base.postgres', 2.6,
      {
        operation: 'executeQuery',
        query: suppressSql,
        options: { queryReplacement: '={{ [$json.email] }}' },
      },
      [624, -96],
      { credentials: { postgres: PG_CRED }, alwaysOutputData: true,
        onError: 'continueErrorOutput' }),

    unsubRespondNode('Respond Done',
      unsubPage('Te-am dezabonat',
        'Nu îți vom mai trimite emailuri. Adresa ta a fost ștearsă din lista noastră.'),
      200, [832, -192]),

    unsubRespondNode('Respond Failed',
      unsubPage('Ceva n-a mers',
        'Nu am putut procesa dezabonarea acum. Scrie-ne la contact@adaptivetech.ro ' +
        'și o rezolvăm manual.'),
      500, [832, 0]),

    raiseForAlertNode('demo-unsubscribe could not record a suppression', [1040, 0]),

    // Deliberately the same page for a malformed token and a forged one --
    // and it never says whether the address exists.
    unsubRespondNode('Respond Invalid',
      unsubPage('Link invalid',
        'Linkul de dezabonare nu este valid sau a fost modificat. ' +
        'Folosește linkul din cel mai recent email primit de la noi.'),
      400, [624, 128]),
  ],
  {
    Webhook: { main: [[{ node: 'Verify Token', type: 'main', index: 0 }]] },
    'Verify Token': { main: [[{ node: 'Token Valid?', type: 'main', index: 0 }]] },
    'Token Valid?': {
      main: [
        [{ node: 'Suppress Address', type: 'main', index: 0 }],
        [{ node: 'Respond Invalid', type: 'main', index: 0 }],
      ],
    },
    'Suppress Address': {
      main: [
        [{ node: 'Respond Done', type: 'main', index: 0 }],
        [{ node: 'Respond Failed', type: 'main', index: 0 }],
      ],
    },
    // A failed unsubscribe is a legal obligation not met. It alerts; an
    // invalid or forged token does not.
    'Respond Failed': { main: [[{ node: 'Raise For Alert', type: 'main', index: 0 }]] },
  }
);

// ---------------------------------------------------------------------------
// error-handling-demo
//
// Set as the error workflow on every demo-* workflow, so a failure anywhere
// in the demo reaches a human instead of sitting in the Executions list.
//
// Two things differ from error-handling-ingestion, and both come from this
// being a PUBLIC endpoint rather than an internal one:
//
//   1. It carries no visitor data. The ingestion handler can afford to paste
//      an error message straight into an email, because its inputs are the
//      team's own Drive files. Here the inputs are a stranger's document and
//      a stranger's questions, and error messages quote their subjects --
//      Parse Extraction and Parse Answer both stringify a slice of the model
//      response into the throw. The privacy policy promises those documents
//      are deleted within three hours; copying fragments of them into a
//      mailbox that keeps everything forever would quietly break that. So the
//      email says what failed and links to the execution, and the message
//      field is redacted on the way out.
//
//   2. It throttles. A public route fails for everyone at once -- if Gemini
//      is down, every visitor's upload fails, and an unthrottled handler
//      turns one outage into hundreds of identical emails, which is how a
//      team learns to filter the alert mailbox.
// ---------------------------------------------------------------------------
const ALERT_THROTTLE_MINUTES = 15;

const buildErrorReportCode = `// Build a report from the n8n Error Trigger, minus anything a visitor owns.
const t = $('Error Trigger').first().json || {};
const ex = t.execution || {};
const wf = t.workflow || {};
const err = ex.error || {};

const failedNode = (err.node && err.node.name) || ex.lastNodeExecuted || 'unknown';
const httpCode = err.httpCode || err.statusCode || (err.context && err.context.httpCode) || '';
const rawMessage = err.message || (typeof err === 'string' ? err : '') || 'Unknown error';
const when = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
const execUrl = ex.url || '';

// Defence in depth, not a guarantee. The execution itself holds everything
// and is one click away for whoever needs it -- this only keeps visitor
// content out of the mail spool.
function redact(s) {
  return String(s == null ? '' : s)
    // Long unbroken runs are base64 documents or embedding vectors.
    .replace(/[A-Za-z0-9+/=_-]{80,}/g, '[redacted:blob]')
    // A visitor's address can surface in a Postgres constraint error.
    .replace(/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/g, '[redacted:email]')
    .slice(0, 300);
}

const message = redact(rawMessage);

// --- throttle -------------------------------------------------------------
// Static data persists between production executions of THIS workflow, so no
// table and no credential is needed. If it ever stops persisting the throttle
// simply stops suppressing -- it fails toward sending, never toward silence.
const store = $getWorkflowStaticData('global');
const key = (wf.name || '?') + '|' + failedNode;
const now = Date.now();
const windowMs = ${ALERT_THROTTLE_MINUTES} * 60 * 1000;

store.alerts = store.alerts || {};
const prev = store.alerts[key];
let suppressed = 0;

if (prev && (now - prev.lastSentAt) < windowMs) {
  // Same failure, same node, still inside the window: count it and stop.
  prev.since = (prev.since || 0) + 1;
  return [{ json: { send: false } }];
}

if (prev) suppressed = prev.since || 0;
store.alerts[key] = { lastSentAt: now, since: 0 };

// Drop entries older than a day so this cannot grow without bound.
for (const k of Object.keys(store.alerts)) {
  if (now - store.alerts[k].lastSentAt > 86400000) delete store.alerts[k];
}
// --- end throttle ---------------------------------------------------------

const esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const subject = '⚠️ ' + (wf.name || 'Workflow') + ' — failed at "' + failedNode + '"' +
  (httpCode ? ' (' + httpCode + ')' : '');

const fields = [
  ['Workflow', (wf.name || '?') + ' (' + (wf.id || '?') + ')'],
  ['Failed node', failedNode],
  ['Error', message],
  httpCode ? ['HTTP code', String(httpCode)] : null,
  ['When', when + ' (Europe/Bucharest)'],
  ['Execution ID', String(ex.id || '?')],
  ex.mode ? ['Mode', ex.mode] : null,
  suppressed ? ['Also failed', suppressed + ' more time(s) in the last ' +
    ${ALERT_THROTTLE_MINUTES} + ' minutes'] : null,
].filter(Boolean);

const table = fields.map(function (r) {
  return '<tr><td style="padding:4px 12px;font-weight:600;vertical-align:top;' +
    'white-space:nowrap">' + esc(r[0]) + '</td><td style="padding:4px 12px">' +
    esc(r[1]) + '</td></tr>';
}).join('');

const html =
  '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#111;line-height:1.45">' +
  '<h2 style="margin:0 0 10px">' + esc(wf.name || 'Workflow') + ' error</h2>' +
  '<table style="border-collapse:collapse;background:#f7f7f8;border:1px solid #e2e2e2">' +
  table + '</table>' +
  (execUrl
    ? '<p style="margin:14px 0"><a href="' + esc(execUrl) +
      '" style="color:#2563eb">Open the failed execution in n8n →</a></p>'
    : '') +
  '<p style="margin:14px 0 4px;color:#666;font-size:12px">' +
  'Visitor content is deliberately not included here. The full execution, ' +
  'including the document and the question, is in n8n until it is pruned.' +
  '</p></div>';

return [{ json: { send: true, subject: subject, html: html } }];
`;

const errorHandlingDemo = workflow(
  'error-handling-demo',
  [
    node('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, {}, [0, 0]),

    node('Build Error Report', 'n8n-nodes-base.code', 2,
      { jsCode: buildErrorReportCode }, [208, 0]),

    ifBooleanNode('Send Alert?', '={{ $json.send }}', [416, 0]),

    node('Email Adaptive Tech Team', 'n8n-nodes-base.emailSend', 2.1,
      {
        fromEmail: 'no-reply@adaptivetech.ro',
        toEmail: 'service_account@adaptivetech.ro',
        subject: '=[Demo] {{ $json.subject }}',
        html: '={{ $json.html }}',
        options: {},
      },
      [624, -96],
      { credentials: { smtp: SMTP_CRED } }),
    // The false branch ends here on purpose: a throttled alert is a
    // no-op, not something to log or respond to.
  ],
  {
    'Error Trigger': { main: [[{ node: 'Build Error Report', type: 'main', index: 0 }]] },
    'Build Error Report': { main: [[{ node: 'Send Alert?', type: 'main', index: 0 }]] },
    'Send Alert?': {
      main: [
        [{ node: 'Email Adaptive Tech Team', type: 'main', index: 0 }],
        [],
      ],
    },
  }
);

// ---------------------------------------------------------------------------

const built = [
  ['demo-verify-session.json', verifySession],
  ['demo-verify-session-test.json', verifySessionTest],
  ['demo-upload-status.json', uploadStatus],
  ['demo-request-code.json', requestCode],
  ['demo-verify-code.json', verifyCode],
  ['demo-upload.json', upload],
  ['demo-chat.json', chat],
  ['demo-cleanup.json', cleanup],
  ['demo-unsubscribe.json', unsubscribe],
  ['error-handling-demo.json', errorHandlingDemo],
];

for (const [file, wf] of built) {
  const target = path.join(OUT, file);
  fs.writeFileSync(target, JSON.stringify(wf, null, 2) + '\n');
  console.log('wrote workflows/' + file + '  (' + wf.nodes.length + ' nodes)');
}
