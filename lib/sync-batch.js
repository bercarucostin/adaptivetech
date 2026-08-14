'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Sync Batch" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

// ---8<--- NORMALIZE START ---8<---
function normalizeSigiliu(value) {
  if (value === null || value === undefined) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
// ---8<--- NORMALIZE END ---8<---

const SIGILIU_SHAPE = /^[A-Z]{2}\d{3}$/;

// The sheet is human-maintained: the real header is "Unitatea de service " with
// a trailing space, and "Nume și prenume" uses U+0219 which someone may retype
// as U+015F. Match on a diacritic-stripped lowercased substring instead.
function findValue(row, needle) {
  const keys = Object.keys(row);
  for (const key of keys) {
    // \u0300-\u036f as escapes, not literal combining marks -- literals are
    // invisible in an editor and survive a copy-paste only by luck.
    const flat = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (flat.includes(needle)) return row[key];
  }
  return undefined;
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function buildSyncBatch(rows, floor, mirrorCount = 0) {
  const batch = [];
  const malformed = [];

  for (const row of rows || []) {
    const technicianName = text(findValue(row, 'nume'));
    const sigiliuRaw = text(findValue(row, 'sigiliu'));
    if (!technicianName || !sigiliuRaw) continue;

    const sigiliu = normalizeSigiliu(sigiliuRaw);
    // A cell containing only punctuation (a bare "-", ".", an en-dash) is
    // non-blank but normalises to ''. string_to_array($1, ',') turns an empty
    // candidate string into {""}, so this would otherwise satisfy the
    // not-null column and mirror an authenticatable empty sigiliu.
    if (!sigiliu) continue;
    if (!SIGILIU_SHAPE.test(sigiliu)) malformed.push(sigiliuRaw);

    const nrCrt = Number(text(findValue(row, 'nr')));
    batch.push({
      nr_crt: Number.isFinite(nrCrt) && text(findValue(row, 'nr')) !== '' ? nrCrt : null,
      technician_name: technicianName,
      service_unit: text(findValue(row, 'unitate')) || null,
      sigiliu_raw: sigiliuRaw,
      sigiliu,
    });
  }

  // Without this, an empty sheet from a Google API hiccup does not merely empty
  // the mirror -- it cascades into deleting every sigiliu-bearing row in
  // validated_numbers, locking out all 476 technicians in one unattended run.
  if (batch.length < floor) {
    throw new Error(
      `Refusing to sync: only ${batch.length} usable rows, floor is ${floor}. ` +
      'Neither technicians nor validated_numbers was modified.'
    );
  }

  // The absolute floor above only catches total sheet loss. The realistic failure
  // on a human-edited sheet is partial -- a deleted block, a paste over a filtered
  // view, a bad sort -- and a batch that clears the absolute floor can still be a
  // fraction of what is already mirrored. That is expensive because it is
  // asymmetric: technicians rebuilds completely on the next good sync, but
  // validated_numbers is only ever written by a technician re-sending their
  // sigiliu, so every affected person is locked out until they do, and their
  // ai_whisperer flags and notes are gone for good. mirrorCount defaults to 0 so
  // a cold start (empty mirror) is governed by the absolute floor alone.
  if (mirrorCount > 0 && batch.length < 0.9 * mirrorCount) {
    throw new Error(
      `Refusing to sync: only ${batch.length} usable rows, which is less than 90% ` +
      `of the ${mirrorCount} currently mirrored. ` +
      'Neither technicians nor validated_numbers was modified.'
    );
  }

  return { batch, malformed };
}
// ---8<--- SHARED END ---8<---

module.exports = { buildSyncBatch };