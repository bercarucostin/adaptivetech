import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../../workflows/Flowrise Dental - Complete Backup to Google Drive.json', import.meta.url);
const raw = readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);
const nodes = Object.fromEntries(workflow.nodes.map((node) => [node.name, node]));

test('workflow is inactive, scheduled in Bucharest and does not retain successful backup payloads', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, 'Europe/Bucharest');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  assert.equal(workflow.settings.saveManualExecutions, false);
  assert.ok(nodes['Daily 02:00']);
  assert.ok(nodes['Manual test']);
});

test('workflow is n8n-only and contains no server runner or embedded secret', () => {
  assert.doesNotMatch(raw, /http:\/\/backup:8080|BACKUP_API_TOKEN|N8N_ENCRYPTION_KEY|pg_dump|readWriteFile/);
  assert.doesNotMatch(raw, /service_role\s*=|client_secret|sbp_[A-Za-z0-9]/i);
  for (const node of workflow.nodes) assert.equal(Object.hasOwn(node, 'credentials'), false);
});

test('workflow targets the configured nonsecret Supabase project URL', () => {
  assert.match(nodes['Prepare run'].parameters.jsCode, /https:\/\/qlynvfltjgjgeipndior\.supabase\.co/);
  assert.doesNotMatch(nodes['Prepare run'].parameters.jsCode, /REPLACE_PROJECT_REF/);
});

test('public tables are discovered dynamically and identifiers are quoted', () => {
  assert.match(nodes['List public tables'].parameters.query, /table_schema = 'public'/);
  const build = new Function('$input', nodes['Build table exports'].parameters.jsCode);
  const result = build({ all: () => [{ json: { table_schema: 'public', table_name: 'odd"table' } }] });
  assert.match(result[0].json.query, /FROM "public"\."odd""table" AS src/);
  assert.equal(result[0].json.filename_prefix, 'table-public-odd_table-part-');
  assert.match(result[0].json.query, /\/ 1000/);
  assert.match(nodes['Export public tables'].parameters.query, /\$json\.query/);
});

test('Auth export omits passwords, sessions and refresh tokens', () => {
  const query = nodes['Export Auth users'].parameters.query;
  assert.match(query, /FROM auth\.users/);
  assert.match(query, /FROM auth\.identities/);
  assert.doesNotMatch(query, /encrypted_password|auth\.sessions|auth\.refresh_tokens/);
});

test('every Storage object is mapped in a manifest and downloaded with Supabase credentials', () => {
  const manifest = nodes['Export storage manifest'].parameters.query;
  const objects = nodes['List storage objects'].parameters.query;
  const download = nodes['Download storage objects'];
  assert.match(manifest, /FROM storage\.buckets/);
  assert.match(manifest, /FROM storage\.objects/);
  assert.match(manifest, /backup_file/);
  assert.match(objects, /FROM storage\.objects/);
  assert.equal(download.parameters.authentication, 'predefinedCredentialType');
  assert.equal(download.parameters.nodeCredentialType, 'supabaseApi');
  assert.equal(download.parameters.options.response.response.responseFormat, 'file');
});

test('Storage download uses an HTTP Request node version supported by deployed n8n', () => {
  assert.equal(nodes['Download storage objects'].typeVersion, 4.4);
});

test('Drive uploads use the selected private parent folder and a completion marker', () => {
  const folderId = '1PvmWJ9DExN3AbV6JCe3rWPvr5E4noEJB';
  assert.equal(nodes['Create backup folder'].parameters.folderId.value, folderId);
  assert.equal(nodes['Upload completion marker'].parameters.name, '={{ $binary.data.fileName }}');
  assert.match(nodes['Create completion manifest'].parameters.jsCode, /_BACKUP_COMPLETE\.json/);
  assert.match(nodes['Mark backup complete'].parameters.newUpdatedFileName, /complete_folder_name/);
  assert.match(nodes['Create backup folder'].parameters.name, /incomplete_folder_name/);
});

test('retention preserves the newest complete folder and removes only old managed folders', () => {
  const select = new Function('$input', nodes['Select folders to remove'].parameters.jsCode);
  const now = Date.now();
  const items = [
    { json: { id: 'c3', name: 'flowrise-supabase-20260927T020000Z', createdTime: '2026-09-27T02:00:00Z' } },
    { json: { id: 'c2', name: 'flowrise-supabase-20260926T020000Z', createdTime: '2026-09-26T02:00:00Z' } },
    { json: { id: 'c1', name: 'flowrise-supabase-20260925T020000Z', createdTime: '2026-09-25T02:00:00Z' } },
    { json: { id: 'stale', name: 'flowrise-supabase-incomplete-20260924T020000Z', createdTime: new Date(now - 7 * 60 * 60 * 1000).toISOString() } },
    { json: { id: 'active', name: 'flowrise-supabase-incomplete-20260927T100000Z', createdTime: new Date(now - 60 * 60 * 1000).toISOString() } },
    { json: { id: 'other', name: 'family-photos', createdTime: '2020-01-01T00:00:00Z' } },
  ];
  const deleted = select({ all: () => items }).map((item) => item.json.id);
  assert.deepEqual(deleted, ['c2', 'c1', 'stale']);
  assert.equal(nodes['Permanently delete old folder'].parameters.options.deletePermanently, true);
});

test('capacity guard refuses an estimated backup above four GiB', () => {
  const guard = new Function('$json', '$', nodes['Enforce Drive capacity'].parameters.jsCode);
  const lookup = () => ({ first: () => ({ json: { max_estimated_bytes: 4 * 1024 * 1024 * 1024 } }) });
  assert.throws(
    () => guard({ estimated_backup_bytes: 4 * 1024 * 1024 * 1024 + 1 }, lookup),
    /exceeds 4 GiB/,
  );
});

test('all required success paths reach the Auth export before completion', () => {
  const targets = (name, output = 0) => (workflow.connections[name]?.main?.[output] || []).map((entry) => entry.node);
  assert.deepEqual(targets('Upload storage objects'), ['Export Auth users']);
  assert.deepEqual(targets('No storage objects'), ['Export Auth users']);
  assert.deepEqual(targets('Upload completion marker'), ['Mark backup complete']);
});
