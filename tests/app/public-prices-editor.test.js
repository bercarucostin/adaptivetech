// Loads editor.js into a vm context with a stub DOM and a stub Supabase client,
// exactly the way tooth-chart-geometry.test.js loads app.js and
// public-price-page.test.js loads the landing-page loader script. editor.js
// grabs elements and wires listeners at load time, so the stub document must
// answer for every id the file touches before the script runs.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const documentJsSrc = fs.readFileSync(path.join(__dirname, '../../website/app/public-prices/document.js'), 'utf8');
const editorJsSrc = fs.readFileSync(path.join(__dirname, '../../website/app/public-prices/editor.js'), 'utf8');

const REQUIRED_IDS = [
  'who', 'whoName', 'signOut', 'signInView', 'signInForm', 'identifier', 'password',
  'signInError', 'signInButton', 'deniedView', 'editorView', 'currency', 'introNote',
  'footnote', 'groups', 'addGroup', 'errors', 'publishNote', 'preview', 'publish',
  'status', 'previewCard', 'previewList', 'history'
];

function makeElement(id) {
  var children = [];
  var text = '';
  var listeners = {};
  var el = {
    id: id,
    className: '',
    value: '',
    hidden: false,
    disabled: false,
    style: {},
    addEventListener: function (type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    dispatch: function (type, event) {
      (listeners[type] || []).forEach(function (handler) { handler(event); });
    },
    appendChild: function (child) { children.push(child); return child; },
    removeChild: function (child) {
      var idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      return child;
    },
    removeAttribute: function () {},
    scrollIntoView: function () {}
  };
  Object.defineProperty(el, 'children', { get: function () { return children; } });
  Object.defineProperty(el, 'firstChild', { get: function () { return children.length ? children[0] : null; } });
  Object.defineProperty(el, 'textContent', {
    get: function () { return text; },
    set: function (v) { text = v; children.length = 0; }
  });
  return el;
}

function makeStorage() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
}

// A fresh vm context and a fresh stub Supabase client per call, so tests never
// share state. `options.session` seeds getSession (truthy => the load-time
// auto-login runs start()). `options.rpc` maps rpc names to (args) => result.
// `options.from` maps table names to the {data, error} the query resolves to.
function loadEditor(options) {
  options = options || {};
  var elements = {};
  REQUIRED_IDS.forEach(function (id) { elements[id] = makeElement(id); });

  var calls = { rpc: [], from: [], setSession: [], signInWithPassword: [], fetch: [] };

  var client = {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: options.session || null } }); },
      getUser: function () { return Promise.resolve({ data: { user: options.user || { email: 'manager@example.com' } } }); },
      setSession: function (args) {
        calls.setSession.push(args);
        return Promise.resolve(options.setSessionResult || { error: null, data: {} });
      },
      signInWithPassword: function (args) {
        calls.signInWithPassword.push(args);
        return Promise.resolve(options.signInWithPasswordResult || { error: null, data: {} });
      },
      signOut: function () { return Promise.resolve({ error: null }); }
    },
    rpc: function (name, args) {
      calls.rpc.push({ name: name, args: args });
      var handler = options.rpc && options.rpc[name];
      var result = handler ? handler(args) : { data: null, error: null };
      return Promise.resolve(result);
    },
    from: function (table) {
      calls.from.push(table);
      var result = (options.from && options.from[table]) || { data: [], error: null };
      var builder = {
        select: function () { return builder; },
        order: function () { return Promise.resolve(result); }
      };
      return builder;
    }
  };

  var fetchImpl = options.fetch || function () {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
  };

  var sandbox = {
    confirm: function () { return true; },
    fetch: function () {
      calls.fetch.push(Array.prototype.slice.call(arguments));
      return fetchImpl.apply(null, arguments);
    },
    document: {
      getElementById: function (id) { return elements[id]; },
      createElement: function (tag) { var e = makeElement(null); e.tagName = tag; return e; },
      createTextNode: function (text) { return { text: text, nodeType: 3 }; }
    },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    FLOWRISE_SUPABASE: {
      projectUrl: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
      loginFunction: 'login-with-identifier'
    },
    supabase: { createClient: function () { return client; } },
    PriceList: { priceListTree: function () { return []; }, mount: function () {} }
  };
  sandbox.window = sandbox;
  sandbox.window.location = { reload: function () {} };

  var ctx = vm.createContext(sandbox);
  vm.runInContext(documentJsSrc, ctx);
  vm.runInContext(editorJsSrc, ctx);

  return { elements: elements, client: client, calls: calls };
}

// Chained .then()s (getSession -> rpc -> getUser -> from -> render, or several
// hops on publish) settle over a handful of microtask/macrotask turns. Flushing
// a generous number of setImmediate ticks is cheap and avoids a timing-dependent
// test.
function flush(times) {
  var p = Promise.resolve();
  for (var i = 0; i < (times || 15); i++) {
    p = p.then(function () { return new Promise(function (resolve) { setImmediate(resolve); }); });
  }
  return p;
}

function validDocument() {
  return {
    schema: 1,
    currency: 'lei',
    intro_note: '',
    footnote: '',
    groups: [{ title: 'Grup A', rows: [{ item: 'Coroană', amount: 500 }] }]
  };
}

// ---- 1. The gate --------------------------------------------------------

test('gate: may_edit_public_prices false shows the denied view, not the editor', async () => {
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: { may_edit_public_prices: function () { return { data: false, error: null }; } }
  });
  await flush();

  assert.equal(elements.deniedView.hidden, false, 'deniedView should be shown');
  assert.equal(elements.editorView.hidden, true, 'editorView must stay hidden');
  assert.equal(elements.signInView.hidden, true);
  assert.ok(calls.rpc.some(c => c.name === 'may_edit_public_prices'));
  // Denied: the panel must not even query the history table.
  assert.equal(calls.from.length, 0);
});

test('gate: may_edit_public_prices true with a current row shows the editor', async () => {
  const row = {
    id: 'ver-1', document: validDocument(), is_current: true, note: null,
    created_at: new Date().toISOString(), created_by: 'u1',
    profiles: { display_name: 'Ana Manager', username: 'ana' }
  };
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: { may_edit_public_prices: function () { return { data: true, error: null }; } },
    from: { public_price_lists: { data: [row], error: null } }
  });
  await flush();

  assert.equal(elements.editorView.hidden, false, 'editorView should be shown');
  assert.equal(elements.deniedView.hidden, true, 'deniedView must stay hidden');
  assert.ok(calls.from.includes('public_price_lists'));
});

// ---- 2. Login installs the returned session (regression guard for the ----
// ---- brief's broken `result.body.email` check) --------------------------

test('login: installs the session the edge function returned, and does not call signInWithPassword', async () => {
  const { elements, client, calls } = loadEditor({
    session: null, // not signed in yet: land on the sign-in form
    fetch: function () {
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({
            ok: true,
            session: {
              access_token: 'edge-access-token',
              refresh_token: 'edge-refresh-token',
              expires_at: 0,
              expires_in: 0,
              token_type: 'bearer'
            },
            profile: {
              id: 'p1', username: 'manager', display_name: 'Manager One',
              legacy_user_id: null, email: 'manager@example.com'
            }
          });
        }
      });
    },
    rpc: { may_edit_public_prices: function () { return { data: false, error: null }; } }
  });
  await flush(3);
  assert.equal(elements.signInView.hidden, false, 'should start on the sign-in form');

  elements.identifier.value = 'manager';
  elements.password.value = 'correct horse';
  elements.signInForm.dispatch('submit', { preventDefault: function () {} });
  await flush();

  assert.equal(calls.setSession.length, 1, 'client.auth.setSession must be called exactly once');
  // Field-by-field, not deepStrictEqual: the argument object is a literal built
  // inside the vm context, so it carries that realm's Object.prototype, not the
  // host's -- deepStrictEqual would fail on the prototype mismatch alone even
  // though every field value is correct.
  const setSessionArg = calls.setSession[0];
  assert.equal(setSessionArg.access_token, 'edge-access-token');
  assert.equal(setSessionArg.refresh_token, 'edge-refresh-token');
  assert.deepEqual(Object.keys(setSessionArg).sort(), ['access_token', 'refresh_token'], 'setSession must receive exactly the two tokens, nothing else');
  assert.equal(calls.signInWithPassword.length, 0, 'signInWithPassword must never be called: the edge function already authenticated');
  assert.equal(elements.signInError.hidden, true, 'a successful login must not show the error paragraph');
});

test('login: a failed edge-function response shows the Romanian error and never calls setSession', async () => {
  const { elements, calls } = loadEditor({
    session: null,
    fetch: function () {
      return Promise.resolve({
        ok: false,
        json: function () { return Promise.resolve({ message: 'Nickname/email sau parolă incorectă.' }); }
      });
    }
  });
  await flush(3);

  elements.identifier.value = 'nobody';
  elements.password.value = 'wrong';
  elements.signInForm.dispatch('submit', { preventDefault: function () {} });
  await flush();

  assert.equal(calls.setSession.length, 0);
  assert.equal(calls.signInWithPassword.length, 0);
  assert.equal(elements.signInError.hidden, false);
  assert.equal(elements.signInError.textContent, 'Nickname/email sau parolă incorectă.');
});

// ---- 3. Publish sends all three arguments --------------------------------

test('publish: calls the RPC with p_document, p_note and p_expected_current from the loaded history', async () => {
  const row = {
    id: 'ver-42', document: validDocument(), is_current: true, note: 'inițial',
    created_at: new Date().toISOString(), created_by: 'u1',
    profiles: { display_name: 'Ana Manager', username: 'ana' }
  };
  let publishArgs = null;
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: function () { return { data: true, error: null }; },
      publish_public_price_list: function (args) { publishArgs = args; return { data: 'ver-43', error: null }; }
    },
    from: { public_price_lists: { data: [row], error: null } }
  });
  await flush();
  assert.equal(elements.editorView.hidden, false, 'precondition: the editor must be open before publishing');

  elements.publishNote.value = 'Preț nou coroană';
  elements.publish.dispatch('click');
  await flush();

  const call = calls.rpc.find(c => c.name === 'publish_public_price_list');
  assert.ok(call, 'publish_public_price_list must have been called');
  assert.deepEqual(Object.keys(call.args).sort(), ['p_document', 'p_expected_current', 'p_note'].sort());
  assert.deepEqual(call.args.p_document, row.document);
  assert.equal(call.args.p_note, 'Preț nou coroană');
  assert.equal(call.args.p_expected_current, 'ver-42', 'p_expected_current must be the id of the row the history query reported as current');
  assert.deepEqual(publishArgs, call.args);
});

test('publish: a document with validation errors is never sent to the RPC', async () => {
  const invalidDoc = { schema: 1, currency: 'lei', intro_note: '', footnote: '', groups: [{ title: '', rows: [] }] };
  const row = {
    id: 'ver-9', document: invalidDoc, is_current: true, note: null,
    created_at: new Date().toISOString(), created_by: 'u1', profiles: null
  };
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: { may_edit_public_prices: function () { return { data: true, error: null }; } },
    from: { public_price_lists: { data: [row], error: null } }
  });
  await flush();

  assert.equal(elements.publish.disabled, true, 'an invalid document must disable Publică');
  elements.publish.dispatch('click');
  await flush();

  assert.equal(calls.rpc.some(c => c.name === 'publish_public_price_list'), false, 'publish must not be called while the document is invalid');
});
