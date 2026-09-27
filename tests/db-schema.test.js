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

test('the migration swaps the index inside one transaction', () => {
  // Under autocommit (psql -f), a failed CREATE after a committed DROP would
  // leave production with no dedupe index at all. The new key is stricter
  // than the old one for rows that share a file_id under two names, so the
  // CREATE can fail on real data.
  const sql = read('db/migrations/2026-09-27-documents-uniq-by-file-id.sql');
  const statements = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
  assert.strictEqual(statements[0].trim().toLowerCase(), 'begin;', 'BEGIN must come before the DROP');
  assert.strictEqual(statements[statements.length - 1].trim().toLowerCase(), 'commit;', 'COMMIT must come last');
  assert.ok(sql.includes('having count(*) > 1'), 'the header must carry the pre-check query for conflicting rows');
});
