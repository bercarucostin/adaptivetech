'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Prepare Chunks" Code node in
// workflows/demo-upload.json.
// tests/demo-workflow.test.js fails if they drift apart.
//
// Generalised from the ingestion workflow's chunker: no Drive file_id,
// no last_modified, plus a hard ceiling so one dense document cannot
// exhaust the embedding budget.

const TOKEN_LIMIT = 350;
const OVERLAP_TOKENS = 75;
const MAX_CHUNKS = 600;

function toTokens(text) {
  return text.split(/\s+/).filter(Boolean);
}

function chunkDocument(fileName, text, options) {
  const opts = options || {};
  const tokenLimit = opts.tokenLimit || TOKEN_LIMIT;
  const overlap = opts.overlap === undefined ? OVERLAP_TOKENS : opts.overlap;
  const maxChunks = opts.maxChunks || MAX_CHUNKS;

  const name = String(fileName || 'document');
  const title = name.replace(/\.[^.]+$/, '');
  const body = typeof text === 'string' ? text : '';
  if (!body.trim()) return [];

  // Split on "## " headings emitted by the extraction prompt. Content
  // before the first heading belongs to the document itself.
  const sections = [];
  let heading = title;
  let buffer = [];
  for (const line of body.split('\n')) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      if (buffer.length) {
        sections.push({ heading: heading, content: buffer.join('\n') });
        buffer = [];
      }
      heading = match[1].trim();
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length) sections.push({ heading: heading, content: buffer.join('\n') });

  const chunks = [];
  const seen = new Set();
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionText = section.content.trim();
    if (!sectionText) continue;

    const tokens = toTokens(sectionText);
    if (!tokens.length) continue;

    let idx = 0;
    while (idx < tokens.length) {
      const window = tokens.slice(idx, idx + tokenLimit).join(' ');

      // Prefix with title and heading so a retrieved chunk carries its
      // own context -- the same trick the ingestion chunker uses.
      const embeddingText = title + ' — ' + section.heading + '\n\n' + window;

      // De-duplicate on content, not on the heading-prefixed text: the
      // same paragraph repeated under two different headings is still
      // the same fact, and indexing it twice wastes embedding budget.
      if (!seen.has(window)) {
        seen.add(window);
        chunks.push({
          text: embeddingText,
          section_heading: section.heading,
          chunk_index: chunkIndex,
          original_file_name: name,
        });
        chunkIndex++;

        if (chunks.length > maxChunks) {
          // Tagged, because the caller has to tell this apart from a document
          // that yielded no text at all. Matching on the message would work
          // until someone rewords it; the two outcomes need different copy,
          // since telling the owner of a 400-page PDF that it "appears to be
          // scanned" sends them looking for a problem that is not there.
          const err = new Error(
            'Document is too large for the demo: over ' + maxChunks +
            ' chunks. Try a shorter document.'
          );
          err.code = 'DOCUMENT_TOO_LONG';
          throw err;
        }
      }

      // Last window: stop. Otherwise advance by the non-overlapping span.
      idx += (tokens.length - idx <= tokenLimit) ? tokens.length : (tokenLimit - overlap);
    }
  }

  return chunks;
}
// ---8<--- SHARED END ---8<---

module.exports = { chunkDocument, TOKEN_LIMIT, OVERLAP_TOKENS, MAX_CHUNKS };
