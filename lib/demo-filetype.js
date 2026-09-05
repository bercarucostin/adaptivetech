'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Validate Upload" Code node in
// workflows/demo-upload.json.
// tests/demo-workflow.test.js fails if they drift apart.
//
// The declared Content-Type is attacker-controlled, so the allowlist is
// enforced against the bytes. DOCX shares the ZIP signature with every
// other Office format; the check confirms the container, and extraction
// fails cleanly on a ZIP that is not a document.

function detectFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  // %PDF- at offset 0.
  if (buffer.length >= 5 && buffer.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';

  // ZIP local file header (PK\x03\x04) or empty-archive marker (PK\x05\x06).
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 && buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06))
  ) {
    return 'docx';
  }

  // Plain text: valid UTF-8, no NUL bytes, and no C0 control characters
  // other than tab, newline and carriage return. Sample the first 8 KB.
  const sample = buffer.slice(0, 8192);
  if (sample.includes(0x00)) return null;

  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  if (decoded.includes('�')) return null;

  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return null;
  }

  return 'txt';
}
// ---8<--- SHARED END ---8<---

module.exports = { detectFileType };
