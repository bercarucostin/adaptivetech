'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Preparing Chunks" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

const WORD_LIMIT = 350;        // max words per chunk (words, not model tokens)
const OVERLAP_WORDS = 75;      // words carried into the next chunk of a section
const WHOLE_DOC_WORDS = 800;   // documents at or under this stay one chunk
const MIN_SECTION_WORDS = 60;  // sections under this merge into a neighbour
const MIN_TAIL_WORDS = 40;     // a last chunk with fewer new words folds into the previous one

function countWords(s) {
  return String(s || '').split(/\s+/).filter(Boolean).length;
}

// Google-native files have no extension, and their names can contain dots
// ("... 19.01.2026"), so only strip extensions we actually ingest.
function titleFromFileName(name) {
  return String(name || '').replace(/\.(pdf|docx?|pptx?|xlsx?)$/i, '');
}

// Split on "## " headings. Text before the first heading belongs to a section
// headed by the document title. Empty sections are dropped.
function splitSections(text, title) {
  const sections = [];
  let heading = title;
  let lines = [];
  const flush = () => {
    const content = lines.join('\n').trim();
    if (content) sections.push({ heading, content });
    lines = [];
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function joinSections(a, b) {
  return { heading: a.heading + ' / ' + b.heading, content: a.content + '\n\n## ' + b.heading + '\n' + b.content };
}

// A section under MIN_SECTION_WORDS merges into the next one; a small last
// section merges into the previous one instead.
function mergeSmallSections(sections) {
  const out = [];
  let pending = null;
  for (const s of sections) {
    const cur = pending ? joinSections(pending, s) : s;
    pending = null;
    if (countWords(cur.content) < MIN_SECTION_WORDS) {
      pending = cur;
      continue;
    }
    out.push(cur);
  }
  if (pending) {
    if (out.length) out[out.length - 1] = joinSections(out[out.length - 1], pending);
    else out.push(pending);
  }
  return out;
}

// A single line longer than WORD_LIMIT is cut into overlapping word windows.
function wordWindows(line) {
  const words = line.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += WORD_LIMIT - OVERLAP_WORDS) {
    out.push(words.slice(i, i + WORD_LIMIT).join(' '));
    if (i + WORD_LIMIT >= words.length) break;
  }
  return out;
}

// Fill chunks with whole lines, keeping the newlines, so numbered steps stay
// one per line. Each new chunk starts with the previous chunk's trailing lines,
// up to OVERLAP_WORDS words. A last chunk that would be mostly that overlap
// (fewer than MIN_TAIL_WORDS new words) is folded into the previous chunk
// instead, which may then run up to MIN_TAIL_WORDS over WORD_LIMIT.
function packSection(content) {
  const units = [];
  for (const line of content.split('\n')) {
    if (countWords(line) > WORD_LIMIT) units.push(...wordWindows(line));
    else units.push(line);
  }

  const chunks = [];
  let cur = [];
  let curWords = 0;
  let carried = 0; // how many leading lines of `cur` repeat the previous chunk
  for (const unit of units) {
    const w = countWords(unit);
    if (curWords > 0 && curWords + w > WORD_LIMIT) {
      chunks.push(cur.join('\n').trim());
      const carry = [];
      let carryWords = 0;
      for (let k = cur.length - 1; k >= 0; k--) {
        const cw = countWords(cur[k]);
        if (carryWords + cw > OVERLAP_WORDS) break;
        carry.unshift(cur[k]);
        carryWords += cw;
      }
      cur = carryWords + w > WORD_LIMIT ? [] : carry;
      curWords = cur === carry ? carryWords : 0;
      carried = cur.length;
    }
    cur.push(unit);
    curWords += w;
  }
  if (curWords > 0) {
    const fresh = cur.slice(carried);
    const freshWords = countWords(fresh.join(' '));
    if (chunks.length > 0 && freshWords < MIN_TAIL_WORDS) {
      if (freshWords > 0) chunks[chunks.length - 1] += '\n' + fresh.join('\n').trim();
    } else {
      chunks.push(cur.join('\n').trim());
    }
  }
  return chunks;
}

// Returns [{ text, section_heading, chunk_index, embed_title }] for one
// document. `text` is what is stored and embedded: it starts with
// "[<folder>] <title> — <heading>" so every retrieval path sees the folder.
function chunkDocument(text, title, folder) {
  const body = String(text || '').trim();
  if (!body) return [];

  let pieces;
  if (countWords(body) <= WHOLE_DOC_WORDS) {
    pieces = [{ heading: title, text: body }];
  } else {
    pieces = [];
    for (const section of mergeSmallSections(splitSections(body, title))) {
      for (const chunk of packSection(section.content)) pieces.push({ heading: section.heading, text: chunk });
    }
  }

  const out = [];
  const seen = new Set();
  for (const p of pieces) {
    const label = (folder ? '[' + folder + '] ' : '') + title + ' — ' + p.heading;
    const stored = label + '\n\n' + p.text;
    // Gemini extraction may repeat a section; keep the first copy.
    if (seen.has(stored)) continue;
    seen.add(stored);
    out.push({
      text: stored,
      section_heading: p.heading,
      chunk_index: out.length,
      embed_title: (folder ? folder + ' — ' : '') + title + ' — ' + p.heading,
    });
  }
  return out;
}
// ---8<--- SHARED END ---8<---

module.exports = {
  chunkDocument, titleFromFileName, countWords,
  WORD_LIMIT, OVERLAP_WORDS, WHOLE_DOC_WORDS, MIN_SECTION_WORDS,
};
