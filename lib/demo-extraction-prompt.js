'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Prepare Gemini Request" Code node in
// workflows/demo-upload.json.
// tests/demo-workflow.test.js fails if they drift apart.

const EXTRACTION_PROMPT = [
  'You are a content extractor. The text you produce will be indexed for a',
  'retrieval system that answers questions about this document, so it must be',
  'complete and faithful rather than readable prose.',
  '',
  'EXTRACTION RULES:',
  '',
  '1. Process every page from the first to the last, including front matter.',
  '   Specifications, safety notices, requirements, operating modes and',
  '   manufacturer details are frequently what people ask about. Do not skip them.',
  '',
  '2. SECTIONS: before each section or chapter, write its title on its own line',
  '   prefixed with "## " (for example: "## 5. Reset procedure"). Detect titles',
  '   from the layout -- numbered, bold, or set in a larger face -- and mark them',
  '   this way. This is the most important rule: the indexer splits the document',
  '   on these headings, and text with no headings is indexed as one block.',
  '',
  '3. TABLES: rewrite every table row as a standalone sentence. Instead of a',
  '   table with "code | description" columns, write each row as',
  '   "Code [code]: [description]". Each row must be intelligible on its own,',
  '   because rows are retrieved individually and without their header.',
  '',
  '4. IMAGES: describe only images carrying information not present in the text',
  '   (diagrams, component locations, wiring). Two sentences at most. Ignore',
  '   logos, watermarks and decorative images.',
  '',
  '5. FIDELITY: reproduce exactly all codes, passwords, key sequences, serial',
  '   numbers, menu names, and specifications (dimensions, voltages, speeds,',
  '   capacities). These are the details people ask about, and an approximation',
  '   is worse than an omission.',
  '',
  "6. Use the document's original language. Do not translate, do not summarise,",
  '   and do not add commentary of your own.',
  '',
  '7. TABLE OF CONTENTS: skip only pages that are a table of contents -- lists of',
  '   titles followed by page numbers and dot leaders. Do not reproduce them. The',
  '   pages around a table of contents are ordinary content and must be extracted.',
  '',
  '8. Omit page numbers, repeated headers and footers, and watermarks.',
  '',
  'COMPLETION RULES:',
  '- This is a single request. There is no follow-up message and no continuation.',
  '- Do not write phrases such as "continued below" or "the rest of the document".',
  '- Produce the extraction and nothing else: no preamble, no closing remark.',
].join('\n');
// ---8<--- SHARED END ---8<---

module.exports = { EXTRACTION_PROMPT };
