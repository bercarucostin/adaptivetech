const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('website/app/app.js', 'utf8');
const authorization = fs.readFileSync('db/edge-functions/authorize-work-order-file/index.ts', 'utf8');

function browserValidation(useConfig = true) {
  const ctx = { window: {}, CASE_FILE_EXTENSIONS: new Set(['stl']), caseFileExtension: () => 'stl' };
  vm.createContext(ctx);
  if (useConfig) vm.runInContext(fs.readFileSync('website/app/supabase-config.js', 'utf8'), ctx);
  ctx.SUPABASE_CONFIG = ctx.window.FLOWRISE_SUPABASE || {};
  vm.runInContext(app.slice(app.indexOf('function currentUploadLimitMB(){'), app.indexOf('async function callFileAuthorization(')), ctx);
  vm.runInContext(app.slice(app.indexOf('function validateCaseFileSelection(files){'), app.indexOf('function setModalRoleMode(){')), ctx);
  return ctx.validateCaseFileSelection;
}

for (const useConfig of [true, false]) {
  test(`browser accepts 1 GB and rejects one byte over (${useConfig ? 'configured' : 'fallback'})`, () => {
    const validate = browserValidation(useConfig);
    const result = validate([{ name: 'scan.stl', size: 1073741824 }, { name: 'oversize.stl', size: 1073741825 }]);
    assert.equal(result.valid.length, 1);
    assert.equal(result.valid[0].name, 'scan.stl');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /oversize\.stl/);
  });
}

// Execute the real authorization guard without invoking Deno or remote storage.
const validateOnServer = new Function('fileSize', 'fileName', 'ext', 'allowedExtensions', 'json',
  authorization.slice(authorization.indexOf('    const maxBytes ='), authorization.indexOf('    const objectId =')) + '\nreturn null;');

test('server authorizes a 1 GB file', () => {
  assert.equal(validateOnServer(1073741824, 'scan.stl', 'stl', new Set(['stl']), (body, status) => ({ body, status })), null);
});

test('server rejects a file one byte over 1 GB', () => {
  const result = validateOnServer(1073741825, 'scan.stl', 'stl', new Set(['stl']), (body, status) => ({ body, status }));
  assert.equal(result.status, 400);
  assert.match(result.body.message, /1 GB/);
});
