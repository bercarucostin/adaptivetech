'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Returns the SHARED START..END block of a lib/ file, line endings normalised
// to \n. With core.autocrlf=true, git checks lib/*.js out with CRLF, while the
// Code nodes in the workflow JSON always store \n -- comparing raw text fails
// on a byte-identical copy.
function sharedBlock(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  if (start === -1 || end <= start) throw new Error('SHARED markers missing in ' + relPath);
  return src.slice(start, end);
}

module.exports = { sharedBlock };
