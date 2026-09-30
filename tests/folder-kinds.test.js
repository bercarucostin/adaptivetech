'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  driveTag, planClassification, parseClassification, upsertSql, MAX_FILES_PER_FOLDER,
} = require('../lib/folder-kinds.js');

const top = (name, description = '') => ({ id: 'id-' + name, name, description });

test('driveTag reads #shared and #product in any case, anywhere', () => {
  assert.strictEqual(driveTag('Documentatie comuna #shared'), 'shared');
  assert.strictEqual(driveTag('#PRODUCT'), 'product');
  assert.strictEqual(driveTag('linia 1\n#Shared\nlinia 3'), 'shared');
});

test('driveTag ignores untagged, partial and conflicting descriptions', () => {
  for (const d of ['', undefined, null, 'shared', 'product', '#sharedfolder', '#shared #product']) {
    assert.strictEqual(driveTag(d), null, String(d));
  }
});

test('planClassification asks only about folders with no row and no tag', () => {
  const plan = planClassification(
    [top('A'), top('B', '#shared'), top('C')],
    [{ folder: 'C', kind: 'product', decided_by: 'llm' }],
    { A: ['a.pdf'] },
  );
  assert.deepStrictEqual(plan.toClassify, ['A']);
  assert.deepStrictEqual(plan.overrides, [{ folder: 'B', kind: 'shared' }]);
  assert.ok(plan.request, 'a request is built for A');
});

test('planClassification rewrites a Drive tag only when the stored row differs', () => {
  const tagged = [top('B', '#shared')];
  assert.deepStrictEqual(
    planClassification(tagged, [{ folder: 'B', kind: 'shared', decided_by: 'drive' }], {}).overrides, []);
  assert.deepStrictEqual(
    planClassification(tagged, [{ folder: 'B', kind: 'product', decided_by: 'llm' }], {}).overrides,
    [{ folder: 'B', kind: 'shared' }]);
  assert.deepStrictEqual(
    planClassification(tagged, [{ folder: 'B', kind: 'shared', decided_by: 'manual' }], {}).overrides,
    [{ folder: 'B', kind: 'shared' }]);
});

test('planClassification has no request when nothing is new', () => {
  const plan = planClassification([top('A')], [{ folder: 'A', kind: 'product', decided_by: 'llm' }], {});
  assert.deepStrictEqual(plan, { overrides: [], toClassify: [], request: null });
});

test('the classifier request lists every folder and caps file names per folder', () => {
  const files = Array.from({ length: 40 }, (_, i) => 'file' + i + '.pdf');
  const plan = planClassification([top('A'), top('B'), top('C')],
    [{ folder: 'C', kind: 'shared', decided_by: 'llm' }], { A: files });
  const text = plan.request.contents[0].parts[0].text;
  assert.ok(text.includes('ALL TOP-LEVEL FOLDERS:\n- A\n- B\n- C'), 'all folders listed for context');
  assert.ok(text.includes('## A') && text.includes('## B') && !text.includes('## C'));
  const aSection = text.slice(text.indexOf('## A'), text.indexOf('## B'));
  assert.strictEqual(aSection.split('\n').filter((l) => l.startsWith('- file')).length, MAX_FILES_PER_FOLDER);
  assert.ok(text.includes('## B\n(no files yet)'), 'a folder with no files is still sent');
  assert.strictEqual(plan.request.generationConfig.responseMimeType, 'application/json');
  assert.ok(plan.request.systemInstruction.parts[0].text.includes('"shared"'));
});

test('parseClassification keeps valid kinds for listed folders only', () => {
  const raw = JSON.stringify({ A: 'shared', B: 'Product ', C: 'maybe', Z: 'shared' });
  assert.deepStrictEqual(parseClassification(raw, ['A', 'B', 'C']), { A: 'shared', B: 'product' });
});

test('parseClassification tolerates code fences and returns {} on junk', () => {
  assert.deepStrictEqual(parseClassification('```json\n{"A":"shared"}\n```', ['A']), { A: 'shared' });
  for (const raw of ['', 'not json', '[1]', 'null', undefined]) {
    assert.deepStrictEqual(parseClassification(raw, ['A']), {}, String(raw));
  }
});

test('upsertSql is empty when there is nothing to write', () => {
  assert.strictEqual(upsertSql([], {}), '');
});

test('upsertSql lets a Drive tag overwrite and never lets the LLM overwrite', () => {
  const sql = upsertSql([{ folder: 'B', kind: 'shared' }], { A: 'product' });
  assert.ok(sql.startsWith('INSERT INTO kb_folders (folder, kind, decided_by) VALUES '));
  assert.ok(sql.includes("('B', 'shared', 'drive')"));
  assert.ok(sql.includes("('A', 'product', 'llm')"));
  assert.ok(sql.includes('ON CONFLICT (folder) DO UPDATE SET kind = EXCLUDED.kind, decided_by = EXCLUDED.decided_by, decided_at = now()'));
  assert.ok(sql.endsWith("WHERE EXCLUDED.decided_by = 'drive'"));
});

test('upsertSql quotes folder names', () => {
  assert.ok(upsertSql([], { "Dan's docs": 'shared' }).includes("('Dan''s docs', 'shared', 'llm')"));
});

test('upsertSql writes a folder once, preferring the Drive decision', () => {
  const sql = upsertSql([{ folder: 'A', kind: 'shared' }], { A: 'product' });
  assert.strictEqual(sql.split("'A'").length - 1, 1);
  assert.ok(sql.includes("('A', 'shared', 'drive')"));
});
