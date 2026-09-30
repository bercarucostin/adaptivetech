'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Plan Folder Classification" and "Build Folder
// Kinds SQL" Code nodes in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if they drift apart.

const FOLDER_KINDS = ['shared', 'product'];
// File names shown to the classifier per folder: enough to show what the
// folder holds without letting one large folder grow the prompt.
const MAX_FILES_PER_FOLDER = 30;

const CLASSIFIER_SYSTEM = [
  'You classify the top-level folders of a technical-support knowledge base that covers a family of products.',
  'A folder is "product" when its documents apply to one specific product or model, for example a folder named after a model.',
  'A folder is "shared" when its documents apply to every product: common procedures, general documentation, and accessories or software used with all products.',
  'Use the folder name, its file names, and the list of all top-level folders for context.',
  'Return ONLY a JSON object that maps each folder to classify, by its exact name, to "shared" or "product".',
].join('\n');

// '#shared' or '#product' anywhere in a Drive folder description, any case.
// Both tags, or neither, is no decision.
function driveTag(description) {
  const s = String(description || '').toLowerCase();
  const shared = /#shared\b/.test(s);
  const product = /#product\b/.test(s);
  if (shared === product) return null;
  return shared ? 'shared' : 'product';
}

function classifierRequest(allNames, toClassify, filesByFolder) {
  const lines = ['ALL TOP-LEVEL FOLDERS:'];
  for (const name of allNames) lines.push('- ' + name);
  lines.push('', 'FOLDERS TO CLASSIFY, with some of their file names:');
  for (const name of toClassify) {
    lines.push('', '## ' + name);
    const files = (filesByFolder[name] || []).slice(0, MAX_FILES_PER_FOLDER);
    if (!files.length) lines.push('(no files yet)');
    for (const file of files) lines.push('- ' + file);
  }
  return {
    systemInstruction: { parts: [{ text: CLASSIFIER_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: lines.join('\n') }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
}

// What this run must write, and what it must ask the classifier.
//   topFolders:    [{ id, name, description }], the root's direct children
//   existingRows:  [{ folder, kind, decided_by }] from kb_folders
//   filesByFolder: { <folder name>: [file names] }
// Returns { overrides, toClassify, request }:
//   overrides:  [{ folder, kind }], Drive tags that differ from the stored row
//   toClassify: folder names with no tag and no row, sorted
//   request:    the Gemini generateContent body, or null when toClassify is empty
function planClassification(topFolders, existingRows, filesByFolder) {
  const rows = new Map();
  for (const row of existingRows || []) if (row && row.folder) rows.set(row.folder, row);
  const tags = new Map();
  for (const f of topFolders || []) {
    if (!f || !f.name || tags.has(f.name)) continue;
    const tag = driveTag(f.description);
    if (tag) tags.set(f.name, tag);
  }
  const names = [...new Set((topFolders || []).map((f) => f && f.name).filter(Boolean))].sort();

  const overrides = [];
  const toClassify = [];
  for (const name of names) {
    const tag = tags.get(name);
    const row = rows.get(name);
    if (tag) {
      if (!row || row.kind !== tag || row.decided_by !== 'drive') overrides.push({ folder: name, kind: tag });
    } else if (!row) {
      toClassify.push(name);
    }
  }
  const request = toClassify.length ? classifierRequest(names, toClassify, filesByFolder || {}) : null;
  return { overrides, toClassify, request };
}

// The classifier's JSON answer, reduced to listed folders with a valid kind.
// Anything unreadable yields {}: those folders stay unclassified until the
// next run.
function parseClassification(rawText, toClassify) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawText || '')
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, ''));
  } catch (e) {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const name of toClassify || []) {
    const kind = typeof parsed[name] === 'string' ? parsed[name].trim().toLowerCase() : '';
    if (FOLDER_KINDS.includes(kind)) out[name] = kind;
  }
  return out;
}

function sqlString(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// One statement. Drive rows replace whatever is stored; LLM rows only fill
// gaps, so they never overwrite a Drive, manual or earlier LLM decision.
function upsertSql(overrides, classified) {
  const values = [];
  const seen = new Set();
  for (const o of overrides || []) {
    if (seen.has(o.folder)) continue;
    seen.add(o.folder);
    values.push('(' + sqlString(o.folder) + ', ' + sqlString(o.kind) + ", 'drive')");
  }
  for (const [folder, kind] of Object.entries(classified || {})) {
    if (seen.has(folder)) continue;
    seen.add(folder);
    values.push('(' + sqlString(folder) + ', ' + sqlString(kind) + ", 'llm')");
  }
  if (!values.length) return '';
  return 'INSERT INTO kb_folders (folder, kind, decided_by) VALUES ' + values.join(', ') +
    ' ON CONFLICT (folder) DO UPDATE SET kind = EXCLUDED.kind, decided_by = EXCLUDED.decided_by, decided_at = now()' +
    " WHERE EXCLUDED.decided_by = 'drive'";
}
// ---8<--- SHARED END ---8<---

module.exports = {
  driveTag, planClassification, parseClassification, upsertSql, FOLDER_KINDS, MAX_FILES_PER_FOLDER,
};
