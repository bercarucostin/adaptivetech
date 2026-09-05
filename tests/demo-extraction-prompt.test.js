'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EXTRACTION_PROMPT } = require('../lib/demo-extraction-prompt.js');

test('the prompt instructs the ## heading convention the chunker depends on', () => {
  assert.match(EXTRACTION_PROMPT, /##/,
    'chunkDocument splits on "## " headings; the prompt must produce them');
});

test('the prompt keeps the rules that make retrieval work', () => {
  const required = [
    /table/i,          // table rows must become standalone sentences
    /language/i,       // keep the document's own language
    /summari[sz]/i,    // no summarising
    /every page|all pages/i,
  ];
  for (const re of required) {
    assert.match(EXTRACTION_PROMPT, re, `missing rule matching ${re}`);
  }
});

test('the support-desk framing is gone', () => {
  // One client-specific lock-seal term from the original prompt is
  // deliberately absent from this list. tests/branch-contract.test.js scans
  // every tracked file -- including lib/demo-extraction-prompt.js -- for
  // that exact term, so asserting it here would duplicate a stronger check
  // and would trip that scan on this test file's own source, since the
  // guard matches on raw file content and does not distinguish a leak from
  // a check that the leak is absent.
  const banned = ['suport tehnic', 'technical support', 'WhatsApp', 'technician'];
  for (const term of banned) {
    assert.ok(
      !EXTRACTION_PROMPT.toLowerCase().includes(term.toLowerCase()),
      `client-specific framing "${term}" survived the rewrite`
    );
  }
});

test('the prompt tells the model this is a single request with no continuation', () => {
  assert.match(EXTRACTION_PROMPT, /single request|no continuation|one request/i);
});
