'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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
  const src = fs.readFileSync(path.join(ROOT, 'lib/sigiliu.js'), 'utf8');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  assert.ok(start !== -1 && end > start, 'SHARED markers missing');
  assert.ok(byName('Extract Sigiliu').parameters.jsCode.includes(src.slice(start, end)),
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
