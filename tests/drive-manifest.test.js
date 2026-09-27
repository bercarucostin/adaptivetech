'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildManifest, buildSyncQuery, dollarQuote } = require('../lib/drive-manifest.js');

const FOLDERS = {
  p200: { label: 'PARTNER 200', path: 'PARTNER 200' },
  svc: { label: 'PARTNER 600', path: 'PARTNER 600/Service' },
};
const DOC = 'application/vnd.google-apps.document';
const file = (over) => Object.assign({
  id: 'f1', name: 'Manual', mimeType: DOC, parents: ['p200'],
  createdTime: '2026-09-26T11:00:00.000Z', modifiedTime: '2026-09-26T12:00:00.000Z',
}, over);

test('files get their folder label and path', () => {
  const { manifest } = buildManifest([file({}), file({ id: 'f2', parents: ['svc'] })], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => [m.file_id, m.folder, m.folder_path]), [
    ['f1', 'PARTNER 200', 'PARTNER 200'],
    ['f2', 'PARTNER 600', 'PARTNER 600/Service'],
  ]);
});

test('a file directly in the root gets empty folder and path', () => {
  const { manifest } = buildManifest([file({ parents: ['root0'] })], FOLDERS);
  assert.strictEqual(manifest[0].folder, '');
  assert.strictEqual(manifest[0].folder_path, '');
});

test('a file with several parents uses the first one inside the tree', () => {
  const { manifest } = buildManifest([file({ parents: ['outside', 'svc', 'p200'] })], FOLDERS);
  assert.strictEqual(manifest[0].folder_path, 'PARTNER 600/Service');
});

test('last_modified is the later of createdTime and modifiedTime', () => {
  const { manifest } = buildManifest([
    file({}),
    file({ id: 'f2', createdTime: '2026-09-27T00:00:00.000Z', modifiedTime: '2026-09-26T00:00:00.000Z' }),
    file({ id: 'f3', createdTime: undefined }),
  ], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => m.last_modified), [
    '2026-09-26T12:00:00.000Z', '2026-09-27T00:00:00.000Z', '2026-09-26T12:00:00.000Z',
  ]);
});

test('all four supported types are kept', () => {
  const types = ['application/pdf', DOC,
    'application/vnd.google-apps.presentation', 'application/vnd.google-apps.spreadsheet'];
  const { manifest, skipped } = buildManifest(types.map((t, i) => file({ id: 'f' + i, mimeType: t })), FOLDERS);
  assert.strictEqual(manifest.length, 4);
  assert.deepStrictEqual(skipped, []);
});

test('unsupported types, shortcuts included, are skipped and reported with their path', () => {
  const { manifest, skipped } = buildManifest([
    file({}),
    file({ id: 'd', name: 'Old.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parents: ['svc'] }),
    file({ id: 's', name: 'Link', mimeType: 'application/vnd.google-apps.shortcut', parents: ['root0'] }),
  ], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => m.file_id), ['f1']);
  assert.deepStrictEqual(skipped, [
    { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', path: 'PARTNER 600/Service/Old.docx' },
    { mimeType: 'application/vnd.google-apps.shortcut', path: 'Link' },
  ]);
});

test('folders and trashed files are dropped silently', () => {
  const { manifest, skipped } = buildManifest([
    file({}),
    file({ id: 'x', mimeType: 'application/vnd.google-apps.folder' }),
    file({ id: 'y', trashed: true }),
  ], FOLDERS);
  assert.deepStrictEqual(manifest.map((m) => m.file_id), ['f1']);
  assert.deepStrictEqual(skipped, []);
});

test('zero usable files throws instead of wiping the knowledge base', () => {
  assert.throws(() => buildManifest([], FOLDERS), /Refusing to run the orphan sweep/);
  assert.throws(() => buildManifest([file({ mimeType: 'text/plain' })], FOLDERS),
    /Refusing to run the orphan sweep/, 'only-unsupported must count as zero');
});

test('a file with no timestamps throws', () => {
  assert.throws(() => buildManifest([file({ createdTime: undefined, modifiedTime: undefined })], FOLDERS),
    /neither createdTime nor modifiedTime/);
});

test('the sync query reprocesses moved files and orders the work list', () => {
  const q = buildSyncQuery([{ file_id: 'f1', file_name: 'Manual', last_modified: 'x', folder: 'A', folder_path: 'A' }]);
  assert.ok(q.includes('folder text, folder_path text'));
  assert.ok(q.includes("max(metadata->>'folder_path') AS folder_path"));
  assert.ok(q.includes("OR coalesce(kb.folder_path, '') IS DISTINCT FROM drive.folder_path"));
  assert.ok(q.includes('OR kb.last_modified IS DISTINCT FROM drive.last_modified'));
  assert.ok(q.includes('drive.folder, drive.folder_path'));
  assert.ok(q.trimEnd().endsWith('ORDER BY drive.last_modified, drive.file_id'));
  assert.ok(q.includes("WHERE d.metadata->>'source' = 'knowledge_base'"), 'sweep stays scoped');
});

test('dollarQuote survives a payload containing its own tag', () => {
  assert.strictEqual(dollarQuote('a $q$ b'), '$q_$a $q$ b$q_$');
});
