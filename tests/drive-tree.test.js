'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildFolderTree, MAX_FOLDERS, FOLDER_MIME } = require('../lib/drive-tree.js');

const ROOT = 'root0';
const folder = (id, name, parent) => ({ id, name, parents: [parent], mimeType: FOLDER_MIME });

test('direct children of the root are their own label and path', () => {
  const { folders } = buildFolderTree([
    folder('p200', 'PARTNER 200', ROOT),
    folder('common', 'DOCUMENTATIE COMUNA', ROOT),
  ], ROOT);
  assert.deepStrictEqual(folders, {
    p200: { label: 'PARTNER 200', path: 'PARTNER 200' },
    common: { label: 'DOCUMENTATIE COMUNA', path: 'DOCUMENTATIE COMUNA' },
  });
});

test('deeper folders keep the top-level label and get the full path', () => {
  const { folders } = buildFolderTree([
    folder('svc', 'Service', 'p600'),        // listed before its parent on purpose
    folder('p600', 'PARTNER 600', ROOT),
    folder('old', 'Vechi', 'svc'),
  ], ROOT);
  assert.deepStrictEqual(folders.svc, { label: 'PARTNER 600', path: 'PARTNER 600/Service' });
  assert.deepStrictEqual(folders.old, { label: 'PARTNER 600', path: 'PARTNER 600/Service/Vechi' });
});

test('folders outside the root are ignored', () => {
  const { folders } = buildFolderTree([
    folder('p200', 'PARTNER 200', ROOT),
    folder('elsewhere', 'Personal', 'someOtherRoot'),
    folder('nested', 'Deep', 'elsewhere'),
  ], ROOT);
  assert.deepStrictEqual(Object.keys(folders), ['p200']);
});

test('a parent cycle terminates', () => {
  const { folders } = buildFolderTree([
    folder('a', 'A', ROOT),
    folder('b', 'B', 'a'),
    { id: 'a', name: 'A', parents: ['b'], mimeType: FOLDER_MIME }, // a is also listed under b
  ], ROOT);
  assert.deepStrictEqual(folders, {
    a: { label: 'A', path: 'A' },
    b: { label: 'A', path: 'A/B' },
  });
});

test('the empty item from alwaysOutputData and non-folders are ignored', () => {
  const { folders, query } = buildFolderTree([
    {},
    { id: 'f1', name: 'doc', parents: [ROOT], mimeType: 'application/pdf' },
  ], ROOT);
  assert.deepStrictEqual(folders, {});
  assert.strictEqual(query,
    "('root0' in parents) and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
});

test('the query lists the root and every descendant folder', () => {
  const { query } = buildFolderTree([
    folder('p200', 'PARTNER 200', ROOT),
    folder('svc', 'Service', 'p200'),
  ], ROOT);
  assert.strictEqual(query,
    "('root0' in parents or 'p200' in parents or 'svc' in parents)" +
    " and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
});

test('more than MAX_FOLDERS folders throws', () => {
  const listing = [];
  for (let i = 0; i <= MAX_FOLDERS; i++) listing.push(folder('f' + i, 'F' + i, ROOT));
  assert.strictEqual(listing.length, 151);
  assert.throws(() => buildFolderTree(listing, ROOT), /151 subfolders; the limit is 150/);
});

test('exactly MAX_FOLDERS folders is allowed', () => {
  const listing = [];
  for (let i = 0; i < MAX_FOLDERS; i++) listing.push(folder('f' + i, 'F' + i, ROOT));
  assert.strictEqual(Object.keys(buildFolderTree(listing, ROOT).folders).length, 150);
});

test('topFolders lists the root\'s direct children with descriptions, sorted by name', () => {
  const { topFolders } = buildFolderTree([
    { id: 'p600', name: 'PARTNER 600', parents: [ROOT], mimeType: FOLDER_MIME, description: '#product' },
    { id: 'svc', name: 'Service', parents: ['p600'], mimeType: FOLDER_MIME, description: '#shared' },
    { id: 'common', name: 'DOCUMENTATIE COMUNA', parents: [ROOT], mimeType: FOLDER_MIME, description: 'toate #shared' },
    { id: 'p200', name: 'PARTNER 200', parents: [ROOT], mimeType: FOLDER_MIME },
  ], ROOT);
  assert.deepStrictEqual(topFolders, [
    { id: 'common', name: 'DOCUMENTATIE COMUNA', description: 'toate #shared' },
    { id: 'p200', name: 'PARTNER 200', description: '' },
    { id: 'p600', name: 'PARTNER 600', description: '#product' },
  ]);
});

test('topFolders is empty when the root has no folders', () => {
  assert.deepStrictEqual(buildFolderTree([], ROOT).topFolders, []);
});
