'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Extract Sigiliu" Code node in workflows/agent.json.
// tests/agent-workflow.test.js fails if the two drift apart.

// ---8<--- NORMALIZE START ---8<---
function normalizeSigiliu(value) {
  if (value === null || value === undefined) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
// ---8<--- NORMALIZE END ---8<---

// Two letters, an optional single separator, exactly three digits -- and only as
// a standalone token. The boundary assertions are load-bearing: without them
// "AB1234" yields a spurious "AB123". Three digits is also load-bearing: DE is a
// real prefix, so a padding rule would make "de 5 zile" authenticate a stranger.
const SIGILIU_TOKEN = /(?<![A-Za-z0-9])([A-Za-z]{2})[ ._-]?(\d{3})(?![0-9])/g;

function extractSigilii(text) {
  if (typeof text !== 'string') return [];
  const found = [];
  SIGILIU_TOKEN.lastIndex = 0;
  let match;
  while ((match = SIGILIU_TOKEN.exec(text)) !== null) {
    const candidate = normalizeSigiliu(match[1] + match[2]);
    if (!found.includes(candidate)) found.push(candidate);
  }
  return found;
}
// ---8<--- SHARED END ---8<---

module.exports = { normalizeSigiliu, extractSigilii };
