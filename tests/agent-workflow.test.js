'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sharedBlock } = require('./helpers/shared-block.js');
const { extractSigilii } = require('../lib/sigiliu.js');

const ROOT = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/agent.json'), 'utf8'));
const byName = (name) => wf.nodes.find((n) => n.name === name);
const targets = (name) => ((wf.connections[name] || {}).main || [])
  .map((out) => (out || []).map((c) => c.node));

test('Validate Phone is replaced by a three-way Switch', () => {
  assert.strictEqual(byName('Validate Phone'), undefined);
  const sw = byName('Route Validation');
  assert.ok(sw, 'Route Validation must exist');
  assert.strictEqual(sw.type, 'n8n-nodes-base.switch');
  assert.strictEqual(sw.parameters.rules.values.length, 2, 'two rules plus a fallback');
  assert.strictEqual(sw.parameters.options.fallbackOutput, 'extra');
});

test('the Switch routes active, revoked and unknown separately', () => {
  assert.deepStrictEqual(targets('Route Validation'), [
    ['Route By Message Type'],
    ['Send "Not Validated"'],
    ['Extract Sigiliu'],
  ]);
});

// Every message crosses this edge. wf.connections['Get valid numbers'] was
// assigned wholesale when this workflow was spliced together -- if that
// assignment were ever lost, the JSON would still parse and every other test
// would still pass while the bot silently stopped routing anything.
test('Get valid numbers feeds directly into Route Validation', () => {
  assert.deepStrictEqual(targets('Get valid numbers'), [['Route Validation']]);
});

test('Route Validation rules are bound to the correct outputs', () => {
  // Swapping these two rule objects (one drag in the n8n editor) would route every
  // active technician to Send "Not Validated" and invert the revocation semantics --
  // and since the Switch sends to the first matching output, rule 1 ("revoked") is
  // only correct because rule 0 ("active") already claimed the active rows first.
  const rules = byName('Route Validation').parameters.rules.values;
  assert.strictEqual(rules[0].outputKey, 'active');
  assert.strictEqual(rules[1].outputKey, 'revoked');

  const conditionFields = (rule) => rule.conditions.conditions.map((c) => c.leftValue);
  assert.ok(conditionFields(rules[0]).some((v) => /is_active/.test(v)),
    'rule 0 (active) must require is_active');
  assert.ok(!conditionFields(rules[1]).some((v) => /is_active/.test(v)),
    'rule 1 (revoked) must not require is_active -- it relies on rule 0 claiming actives first');
});

test('Get valid numbers no longer filters on is_active', () => {
  const cols = byName('Get valid numbers').parameters.where.values.map((v) => v.column);
  assert.deepStrictEqual(cols, ['phone_e164'],
    'filtering is_active here would make a revoked row look like no row, and it could re-validate itself');
});

test('the verification branch is wired end to end', () => {
  assert.deepStrictEqual(targets('Extract Sigiliu'), [['Sigiliu Candidates?']]);
  assert.deepStrictEqual(targets('Sigiliu Candidates?'), [['Lookup Sigiliu'], ['Send "Ask Sigiliu"']]);
  assert.deepStrictEqual(targets('Lookup Sigiliu'), [['Sigiliu Found?']]);
  assert.deepStrictEqual(targets('Sigiliu Found?'), [['Insert Validated Number'], ['Send "Ask Sigiliu"']]);
  assert.deepStrictEqual(targets('Insert Validated Number'), [['Send "Validated"']]);
});

test('Extract Sigiliu embeds lib/sigiliu.js verbatim', () => {
  assert.ok(byName('Extract Sigiliu').parameters.jsCode.includes(sharedBlock('lib/sigiliu.js')),
    'Code node has drifted from lib/sigiliu.js');
});

test('candidate list is capped against batch brute-force', () => {
  const code = byName('Extract Sigiliu').parameters.jsCode;
  const glue = code.slice(code.indexOf('// ---- n8n glue ----'));
  assert.ok(/MAX_SIGILIU_CANDIDATES\s*=\s*3/.test(glue), 'cap must be a named constant set to 3');
  assert.ok(/extractSigilii\(body\)\.slice\(0,\s*MAX_SIGILIU_CANDIDATES\)/.test(glue),
    'candidates must actually be sliced to the cap -- Lookup Sigiliu tests every candidate ' +
    'with sigiliu = ANY(...), so an uncapped list lets one message brute-force many codes');
});

test('an empty phone yields no candidates, so nothing is inserted under a blank key', () => {
  const code = byName('Extract Sigiliu').parameters.jsCode;
  const glue = code.slice(code.indexOf('// ---- n8n glue ----'));
  assert.ok(/phone\s*\?\s*extractSigilii\(body\)/.test(glue),
    'candidates must be gated on a truthy phone, not computed unconditionally');
});

test('phone identity is wa_id, matching the lookup', () => {
  const code = byName('Extract Sigiliu').parameters.jsCode;
  assert.ok(code.includes('contacts[0].wa_id') || code.includes("contacts'][0]"),
    'inserting messages[0].from would make the row unfindable by the wa_id lookup');
  const repl = byName('Insert Validated Number').parameters.options.queryReplacement;
  assert.ok(repl.includes("$('Extract Sigiliu')"), 'insert must reuse the extracted phone');
});

test('Lookup Sigiliu tie-breaks deterministically and always emits', () => {
  const node = byName('Lookup Sigiliu');
  assert.strictEqual(node.alwaysOutputData, true, 'a no-match must still emit an item for the IF');
  assert.strictEqual(node.retryOnFail, true);
  assert.ok(node.parameters.query.includes('array_position'), 'first candidate in the message wins');
  assert.ok(/ORDER BY.*nr_crt/s.test(node.parameters.query), 'MA 050 needs a tie-break');
});

test('the insert never resurrects a revoked row', () => {
  const q = byName('Insert Validated Number').parameters.query;
  assert.ok(q.includes('ON CONFLICT (phone_e164) DO UPDATE'));
  assert.ok(!/is_active/.test(q), 'ON CONFLICT must not touch is_active');
});

// SECURITY: this message is sent before the sender is known.
test('the Ask Sigiliu message leaks nothing about the sigiliu', () => {
  const body = byName('Send "Ask Sigiliu"').parameters.textBody;
  assert.deepStrictEqual(extractSigilii(body), [], 'no extractable token may appear pre-auth');
  assert.ok(!/\bXX\b|\b999\b|exemplu|format/i.test(body),
    'no example, placeholder, or format description');
});

test('the confirmation names the technician', () => {
  const body = byName('Send "Validated"').parameters.textBody;
  assert.ok(body.includes('technician_name') && body.includes('service_unit'));
});

test('Build Prompt explains the [FOLDER] chunk label and names the user\'s product', () => {
  // Run the Code node and read the real prompt it builds.
  const code = byName('Build Prompt').parameters.jsCode;
  const FOLDERS = [
    { folder: 'DOCUMENTATIE COMUNA', kind: 'shared' },
    { folder: 'PARTNER 200', kind: 'product' },
  ];
  const nodes = {
    'Unified Input': { first: { question: 'q', sessionId: 's', from: 'f' }, all: [] },
    'Load Chat History': { first: {}, all: [] },
    'Retrieve Docs': { first: { response: '[PARTNER 200] docs' }, all: [] },
    'Parse Optimized Query': { first: { query: 'q', lexical: 'q', scope: 'PARTNER 200' }, all: [] },
    'Load KB Folders': { first: FOLDERS[0], all: FOLDERS },
  };
  const stub = (name) => ({
    first: () => ({ json: nodes[name].first }),
    all: () => nodes[name].all.map((json) => ({ json })),
  });
  const out = new Function('$', code)(stub)[0].json;
  assert.ok(out.system.includes('3. Each document begins with the folder it came from in square brackets'));
  assert.ok(out.system.includes('Documents from [DOCUMENTATIE COMUNA], and documents with no folder label, apply to every product.'));
  const last = out.messages[out.messages.length - 1].content;
  assert.ok(last.startsWith("USER'S PRODUCT: PARTNER 200\n\nRELEVANT DOCUMENTATION:\n[PARTNER 200] docs"));
});

test('the retrieval chain runs history, folders, optimizer, search, prompt in order', () => {
  assert.deepStrictEqual(targets('Unified Input'), [['Load Chat History']]);
  assert.deepStrictEqual(targets('Load Chat History'), [['Load KB Folders']]);
  assert.deepStrictEqual(targets('Load KB Folders'), [['Build Optimizer Request']]);
  assert.deepStrictEqual(targets('Build Optimizer Request'), [['Optimize Query']]);
  assert.deepStrictEqual(targets('Optimize Query'), [['Parse Optimized Query']]);
  assert.deepStrictEqual(targets('Parse Optimized Query'), [['Retrieve Docs']]);
  assert.deepStrictEqual(targets('Retrieve Docs'), [['Build Prompt']]);
});

test('Merge History + RAG is gone without a trace', () => {
  assert.strictEqual(byName('Merge History + RAG'), undefined);
  assert.ok(!JSON.stringify(wf).includes('Merge History + RAG'));
});

test('a new user with no history or an empty knowledge base still reaches the optimizer', () => {
  assert.strictEqual(byName('Load Chat History').alwaysOutputData, true);
  assert.strictEqual(byName('Load KB Folders').alwaysOutputData, true);
});

test('Load KB Folders runs once and reads kinds from kb_folders', () => {
  const node = byName('Load KB Folders');
  assert.strictEqual(node.executeOnce, true, 'it receives one item per history row');
  const q = node.parameters.query;
  assert.ok(q.includes('left join kb_folders k using (folder)'));
  assert.ok(q.includes("coalesce(k.kind, 'product') as kind"));
  assert.ok(q.includes("metadata->>'source' = 'knowledge_base'"));
  assert.deepStrictEqual(node.credentials, byName('Load Chat History').credentials);
});

test('the optimizer sends the request built from lib/retrieval-scope.js', () => {
  const build = byName('Build Optimizer Request').parameters.jsCode;
  assert.ok(build.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(build.includes('buildOptimizerRequest(question, history, folders)'));
  const oq = byName('Optimize Query');
  assert.strictEqual(oq.parameters.jsonBody, '={{ JSON.stringify($json.request) }}');
  assert.strictEqual(oq.retryOnFail, true);
});

test('Parse Optimized Query validates the scope with lib/retrieval-scope.js', () => {
  const code = byName('Parse Optimized Query').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(code.includes('parseOptimizedQuery(raw, question, folders)'));
});

test('Build Prompt gives the answer model the product and the generated folder rule', () => {
  const code = byName('Build Prompt').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(code.includes('const scope = scopePrompt(optimized.scope, kbFolders);'));
  assert.ok(code.includes("content: scope.productLine + '\\n\\nRELEVANT DOCUMENTATION:\\n' + chunks"));
  assert.ok(code.includes("'3. ' + scope.rule,"));
  assert.ok(!code.includes('never apply it to another machine'), 'the old hard-coded folder rule is gone');
  assert.ok(!code.includes('DOCUMENTATIE COMUNA'), 'no folder name in the prompt code');
});

test('the fallback agent gets the same product line and folder rule', () => {
  const norm = byName('Normalize For Agent').parameters.jsCode;
  assert.ok(norm.includes(sharedBlock('lib/retrieval-scope.js')), 'Code node has drifted from lib/retrieval-scope.js');
  assert.ok(norm.includes('productLine: scope.productLine,'));
  assert.ok(norm.includes('folderRule: scope.rule'));
  const agent = byName('AI Agent1').parameters;
  assert.ok(agent.text.includes('$json.productLine'));
  assert.ok(agent.text.includes("'\\n\\nFOLDER RULE:\\n' + $json.folderRule"));
  assert.ok(agent.options.systemMessage.includes('4. Follow the FOLDER RULE given with the question'));
  assert.ok(!agent.options.systemMessage.includes('DOCUMENTATIE COMUNA'));
});

test('the fallback agent is not told to search once per product', () => {
  // The tool query now leaves product names out; a per-product search would
  // either put them back or repeat the same query.
  const message = byName('AI Agent1').parameters.options.systemMessage;
  assert.ok(!/one call per product/i.test(message));
  assert.ok(!/Partner 200 vs Partner 600/.test(message));
  assert.ok(message.includes('call it again with a different description of the task'));
});

test('the knowledge base tool no longer asks for product names', () => {
  const p = byName('Knowledge Base (Hybrid Search)').parameters;
  assert.ok(!/include product name/i.test(p.description));
  assert.ok(!/once PER product/i.test(p.description));
  assert.ok(p.workflowInputs.value.query.includes('Leave out product and model names'));
});
