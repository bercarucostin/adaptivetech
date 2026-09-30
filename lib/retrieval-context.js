'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Search Request", "Build Prompt" and
// "Normalize For Agent" Code nodes in workflows/agent.json.
// tests/agent-workflow.test.js fails if they drift apart.

const CONTEXT_CHARS = 300;

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

// What Retrieve Docs sends to hybrid-search-tool: the question as typed, and,
// when the user wrote before, their previous message followed by the question.
function searchRequest(question, history) {
  const q = String(question || '');
  const prev = [...(history || [])].reverse().find((m) => m && m.role === 'user');
  return {
    query: q,
    context_query: prev ? String(prev.content).slice(0, CONTEXT_CHARS) + '\n' + q : '',
  };
}

// The folder rule both answer prompts use, generated from the folder kinds.
function folderRule(folders) {
  const shared = (folders || []).filter((f) => f && f.folder && f.kind === 'shared').map((f) => '[' + f.folder + ']');
  const sharedSentence = shared.length
    ? 'Documents from ' + shared.join(', ') + ', and documents with no folder label, apply to every product.'
    : 'Documents with no folder label apply to every product.';
  return [
    'Each document begins with the folder it came from in square brackets, e.g. [FOLDER NAME].',
    sharedSentence,
    'A document from any other folder applies only to the product that folder is named after.',
    "The user's product is the one named in the question or earlier in the conversation.",
    "When it is known, answer from that product's documents and the shared documents.",
    "If only another product's document covers the question, you may use it, but say explicitly that it comes from the documentation for that other product and that the steps may differ.",
    'When the product is not known and the documentation gives different answers for different products, ask which product the user has. When it gives the same answer for every product, answer directly.',
  ].join(' ');
}
// ---8<--- SHARED END ---8<---

module.exports = { historyFromRows, searchRequest, folderRule, CONTEXT_CHARS };
