'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Optimizer Request", "Parse Optimized Query",
// "Build Prompt" and "Normalize For Agent" Code nodes in workflows/agent.json.
// tests/agent-workflow.test.js fails if they drift apart.

const OPTIMIZER_MODEL = 'claude-haiku-4-5';
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 300;

const OPTIMIZER_SYSTEM = [
  'You are a search query optimizer for a technical support knowledge base.',
  'The knowledge base is organised in folders. Each PRODUCT FOLDER holds documentation for one product; SHARED FOLDERS hold documentation that applies to every product.',
  '',
  'Given the QUESTION, and the RECENT CONVERSATION for context, return a JSON object with three fields:',
  '- "scope": the product folder the user is asking about, copied exactly from PRODUCT FOLDERS, or null when no product is named or implied in the question or the recent conversation, or when the question is about more than one product (for example a comparison). Never a shared folder.',
  '- "semantic": a natural-language sentence that captures the intent (optimized for embedding similarity search).',
  '- "lexical": a concise keyword query with exact technical terms, error codes, menu names and action words (optimized for full-text search).',
  '',
  'Leave product and model names out of "semantic" and "lexical": "scope" carries them. Keep every other exact term.',
  'When the question is a follow-up ("and how do I reset it?"), use the conversation to make the queries self-contained.',
  'Return ONLY valid JSON. No markdown, no explanation. "semantic" and "lexical" must be in the same language as the QUESTION.',
].join('\n');

// n8n_chat_histories rows, newest first as Load Chat History returns them, to
// [{ role, content }] oldest first. Rows that are not a human or ai message --
// including the empty item alwaysOutputData emits for a new user -- are skipped.
function historyFromRows(rows) {
  const out = [];
  for (const row of [...(rows || [])].reverse()) {
    let msg = row && row.message;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch (e) { continue; }
    }
    if (!msg || typeof msg.content !== 'string' || !msg.content) continue;
    if (msg.type === 'human') out.push({ role: 'user', content: msg.content });
    else if (msg.type === 'ai') out.push({ role: 'assistant', content: msg.content });
  }
  return out;
}

function foldersOfKind(folders, kind) {
  return (folders || []).filter((f) => f && f.folder && f.kind === kind).map((f) => f.folder);
}

// The Anthropic Messages body for Optimize Query.
function buildOptimizerRequest(question, history, folders) {
  const recent = (history || []).slice(-HISTORY_TURNS).map((m) =>
    (m.role === 'user' ? 'User: ' : 'Assistant: ') + String(m.content).slice(0, HISTORY_CHARS));
  const content = [
    'PRODUCT FOLDERS: ' + JSON.stringify(foldersOfKind(folders, 'product')),
    'SHARED FOLDERS: ' + JSON.stringify(foldersOfKind(folders, 'shared')),
    '',
    'RECENT CONVERSATION:',
    recent.length ? recent.join('\n') : '(none)',
    '',
    'QUESTION:',
    String(question || ''),
  ].join('\n');
  return {
    model: OPTIMIZER_MODEL,
    max_tokens: 300,
    temperature: 0.3,
    system: OPTIMIZER_SYSTEM,
    messages: [{ role: 'user', content }],
  };
}

// The optimizer's answer as { query, lexical, scope } for Retrieve Docs.
// scope survives only if it is exactly a listed product folder; retrieval never
// fails because of it.
function parseOptimizedQuery(rawText, question, folders) {
  let semantic = '';
  let lexical = '';
  let scope = null;
  try {
    const parsed = JSON.parse(String(rawText || '')
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, ''));
    if (parsed && typeof parsed === 'object') {
      semantic = typeof parsed.semantic === 'string' ? parsed.semantic : '';
      lexical = typeof parsed.lexical === 'string' ? parsed.lexical : '';
      scope = parsed.scope;
    }
  } catch (e) { /* fall back to the question below */ }
  const products = foldersOfKind(folders, 'product');
  const fallback = String(question || '');
  return {
    query: semantic || fallback,
    lexical: lexical || semantic || fallback,
    scope: typeof scope === 'string' && products.includes(scope) ? scope : null,
  };
}

// The product line and the folder rule both answer prompts use.
function scopePrompt(scope, folders) {
  const shared = foldersOfKind(folders, 'shared').map((f) => '[' + f + ']');
  const sharedSentence = shared.length
    ? 'Documents from ' + shared.join(', ') + ', and documents with no folder label, apply to every product.'
    : 'Documents with no folder label apply to every product.';
  const rule = [
    'Each document begins with the folder it came from in square brackets, e.g. [FOLDER NAME].',
    sharedSentence,
    'A document from any other folder applies only to the product that folder is named after.',
    "When USER'S PRODUCT is known, answer from that product's documents and the shared documents.",
    "If only another product's document covers the question, you may use it, but say explicitly that it comes from the documentation for that other product and that the steps may differ.",
    "When USER'S PRODUCT is not stated and the documentation gives different answers for different products, ask which product the user has. When it gives the same answer for every product, answer directly.",
  ].join(' ');
  return { productLine: "USER'S PRODUCT: " + (scope || 'not stated'), rule };
}
// ---8<--- SHARED END ---8<---

module.exports = {
  historyFromRows, buildOptimizerRequest, parseOptimizedQuery, scopePrompt,
  OPTIMIZER_MODEL, HISTORY_TURNS, HISTORY_CHARS,
};
