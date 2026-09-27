'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const KEY = "coalesce(metadata ->> 'file_id', metadata ->> 'original_file_name', '')";

test('the chunk dedupe index is keyed on file_id in the schema', () => {
  const sql = read('db/documents.sql');
  const block = sql.slice(sql.indexOf('create unique index documents_content_file_uniq'));
  assert.ok(block.slice(0, 200).includes(KEY), 'documents.sql must key the dedupe index on file_id');
  assert.ok(!sql.includes("coalesce(metadata ->> 'original_file_name', '')\n"), 'old name-only key is gone');
});

test('the migration rebuilds the index with the same key', () => {
  const sql = read('db/migrations/2026-09-27-documents-uniq-by-file-id.sql');
  assert.ok(sql.includes('drop index if exists public.documents_content_file_uniq;'));
  assert.ok(sql.includes('create unique index documents_content_file_uniq'));
  assert.ok(sql.includes(KEY));
});
