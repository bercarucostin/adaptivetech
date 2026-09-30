'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sharedBlock } = require('./helpers/shared-block.js');
const { SEARCH_SQL, EMBED_DIMS } = require('../lib/semantic-search.js');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows/hybrid-search-tool.json'), 'utf8'));
const byName = (name) => wf.nodes.find((n) => n.name === name);
const targets = (name) => ((wf.connections[name] || {}).main || []).map((out) => (out || []).map((c) => c.node));

function runCode(name, input, nodes = {}) {
  const $ = (n) => ({ first: () => ({ json: nodes[n] }) });
  return new Function('$', '$json', byName(name).parameters.jsCode)($, input);
}

test('the search runs trigger, embed request, embed, SQL params, search, format in order', () => {
  assert.deepStrictEqual(targets('When Executed by Another Workflow'), [['Build Embed Request']]);
  assert.deepStrictEqual(targets('Build Embed Request'), [['Embed Query']]);
  assert.deepStrictEqual(targets('Embed Query'), [['Build Search SQL']]);
  assert.deepStrictEqual(targets('Build Search SQL'), [['Run Semantic Search']]);
  assert.deepStrictEqual(targets('Run Semantic Search'), [['Format Results']]);
  assert.strictEqual(byName('Run Hybrid Search'), undefined);
});

test('Build Embed Request embeds lib/semantic-search.js and asks for one or two embeddings', () => {
  const code = byName('Build Embed Request').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/semantic-search.js')), 'Code node has drifted from lib/semantic-search.js');
  const one = runCode('Build Embed Request', { query: 'Eroare 40?' });
  assert.strictEqual(one[0].json.request.requests.length, 1);
  const two = runCode('Build Embed Request', { query: 'partner 200 am', context_query: 'sertar?\npartner 200 am' });
  assert.deepStrictEqual(two[0].json.request.requests.map((r) => r.content.parts[0].text), ['partner 200 am', 'sertar?\npartner 200 am']);
});

test('Embed Query calls batchEmbedContents with the prepared body', () => {
  const p = byName('Embed Query').parameters;
  assert.ok(p.url.endsWith('/models/gemini-embedding-001:batchEmbedContents'));
  assert.strictEqual(p.jsonBody, '={{ JSON.stringify($json.request) }}');
});

test('Build Search SQL turns the embeddings and the trigger filter into the three parameters', () => {
  const code = byName('Build Search SQL').parameters.jsCode;
  assert.ok(code.includes(sharedBlock('lib/semantic-search.js')), 'Code node has drifted from lib/semantic-search.js');
  const values = Array.from({ length: EMBED_DIMS }, () => 1);
  const out = runCode('Build Search SQL', { embeddings: [{ values }] },
    { 'When Executed by Another Workflow': { query: 'Eroare 40?' } })[0].json;
  assert.strictEqual(out.context_vector, '');
  assert.strictEqual(out.filter, '{}');
  assert.strictEqual(out.keywords, 'Eroare or 40', 'keywords come from the question as typed');
  assert.strictEqual(JSON.parse(out.vector).length, EMBED_DIMS);
});

test('Run Semantic Search runs SEARCH_SQL with the four parameters', () => {
  const node = byName('Run Semantic Search');
  assert.strictEqual(node.parameters.query, SEARCH_SQL);
  assert.strictEqual(node.parameters.options.queryReplacement,
    '={{ [$json.vector, $json.context_vector, $json.filter, $json.keywords] }}');
});
