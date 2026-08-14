'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildSyncBatch } = require('../lib/sync-batch.js');

const ROOT = path.join(__dirname, '..');

function sheetRow(nr, name, unit, sigiliu) {
  return {
    'Nr. Crt': nr,
    'Nume și prenume tehnician de service': name,
    'Unitatea de service ': unit, // trailing space, exactly as the real sheet has it
    'Sigiliu de identificare': sigiliu,
  };
}

function padTo(rows, total) {
  const out = rows.slice();
  let n = out.length;
  while (out.length < total) {
    n += 1;
    out.push(sheetRow(n, `TECHNICIAN ${n}`, 'FILLER SRL', `ZZ${String(n).padStart(3, '0')}`));
  }
  return out;
}

test('buildSyncBatch maps and normalises sheet rows', () => {
  const rows = padTo([
    sheetRow(1, 'PETRISOR MIHAI CRISTIAN', 'PARTNER CORPORATION SRL', 'PN 002'),
    sheetRow(466, 'GIURGIU HODIS LUIGI DANIEL', 'WEB COMPUTERS SRL', 'WR001'),
  ], 100);
  const { batch } = buildSyncBatch(rows, 100);

  assert.strictEqual(batch.length, 100);
  assert.deepStrictEqual(batch[0], {
    nr_crt: 1,
    technician_name: 'PETRISOR MIHAI CRISTIAN',
    service_unit: 'PARTNER CORPORATION SRL',
    sigiliu_raw: 'PN 002',
    sigiliu: 'PN002',
  });
  assert.strictEqual(batch[1].sigiliu, 'WR001');
  assert.strictEqual(batch[1].sigiliu_raw, 'WR001');
});

test('buildSyncBatch tolerates header variants', () => {
  const rows = padTo([{
    'nr. crt': 7,
    'NUME ȘI PRENUME TEHNICIAN DE SERVICE': 'TEST PERSON',
    'Unitatea de Service': 'TEST SRL',   // no trailing space, different case
    ' Sigiliu de identificare ': 'AB 123',
  }], 100);
  const { batch } = buildSyncBatch(rows, 100);

  assert.strictEqual(batch[0].nr_crt, 7);
  assert.strictEqual(batch[0].technician_name, 'TEST PERSON');
  assert.strictEqual(batch[0].service_unit, 'TEST SRL');
  assert.strictEqual(batch[0].sigiliu, 'AB123');
});

test('buildSyncBatch tolerates the s-cedilla spelling of the name header', () => {
  const rows = padTo([{
    'Nr. Crt': 8,
    'Nume şi prenume tehnician de service': 'CEDILLA PERSON', // U+015F, not U+0219
    'Unitatea de service ': 'TEST SRL',
    'Sigiliu de identificare': 'AC 124',
  }], 100);
  const { batch } = buildSyncBatch(rows, 100);
  assert.strictEqual(batch[0].technician_name, 'CEDILLA PERSON');
});

test('buildSyncBatch drops rows missing a name or a sigiliu', () => {
  const rows = padTo([
    sheetRow(1, 'REAL PERSON', 'REAL SRL', 'PN 002'),
    sheetRow(2, '', 'ORPHAN SRL', 'PN 003'),
    sheetRow(3, 'NO SIGILIU', 'REAL SRL', '   '),
    sheetRow('', '', '', ''),
  ], 103);
  const { batch } = buildSyncBatch(rows, 100);

  assert.strictEqual(batch.length, 100);
  assert.ok(!batch.some((r) => r.technician_name === 'NO SIGILIU'));
});

test('buildSyncBatch keeps malformed sigilii but reports them', () => {
  const rows = padTo([
    sheetRow(1, 'GOOD PERSON', 'REAL SRL', 'PN 002'),
    sheetRow(2, 'BAD PERSON', 'REAL SRL', 'ABC 001'),
  ], 100);
  const { batch, malformed } = buildSyncBatch(rows, 100);

  assert.ok(batch.some((r) => r.sigiliu === 'ABC001'), 'malformed row is still mirrored');
  assert.deepStrictEqual(malformed, ['ABC 001']);
});

test('buildSyncBatch throws below the floor', () => {
  const rows = [sheetRow(1, 'ONLY PERSON', 'REAL SRL', 'PN 002')];
  assert.throws(() => buildSyncBatch(rows, 100), /only 1 usable rows.*floor is 100/s);
});

test('the floor counts rows surviving the blank drop, not rows read', () => {
  const rows = padTo([], 99);
  rows.push(sheetRow(100, '', '', ''));   // blank -> dropped
  rows.push(sheetRow(101, '', '', ''));   // blank -> dropped
  assert.strictEqual(rows.length, 101);
  assert.throws(() => buildSyncBatch(rows, 100), /only 99 usable rows/);
});

test('buildSyncBatch tolerates an empty sheet without wiping anything', () => {
  assert.throws(() => buildSyncBatch([], 100), /only 0 usable rows/);
});

// The spec requires one normalisation rule on both sides. n8n Code nodes cannot
// require(), so the function is duplicated -- this makes the duplication a
// checked invariant instead of a latent bug.
test('normalisation is byte-identical to lib/sigiliu.js', () => {
  const region = (file) => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', file), 'utf8');
    const start = src.indexOf('// ---8<--- NORMALIZE START ---8<---');
    const end = src.indexOf('// ---8<--- NORMALIZE END ---8<---');
    assert.ok(start !== -1 && end > start, `NORMALIZE markers missing in ${file}`);
    return src.slice(start, end);
  };
  assert.strictEqual(region('sync-batch.js'), region('sigiliu.js'));
});
