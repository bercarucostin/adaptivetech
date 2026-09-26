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

function makeStorage(seed) {
  var store = seed ? JSON.parse(JSON.stringify(seed)) : {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
}

// Walks the stub DOM appended under an element. The editor builds group cards
// and row inputs with createElement, so they carry no id and can only be reached
// this way.
function findIn(el, predicate) {
  if (!el || !el.children) return null;
  for (var i = 0; i < el.children.length; i++) {
    var child = el.children[i];
    if (predicate(child)) return child;
    var found = findIn(child, predicate);
    if (found) return found;
  }
  return null;
}

// A fresh vm context and a fresh stub Supabase client per call, so tests never
// share state. `options.session` seeds getSession (truthy => the load-time
// auto-login runs start()). `options.rpc` maps rpc names to (args) => result --
// including get_public_price_list_history, which is how the panel now loads the
// version history. `options.from` maps table names to the {data, error} a query
// resolves to, and stays here so a test can prove the panel does NOT query the
// table directly. `options.localStorage` seeds the draft store.
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

  // editor.js reads the login response with response.text() and guards the parse,
  // so the stub answers text(), not json().
  var fetchImpl = options.fetch || function () {
    return Promise.resolve({ ok: true, text: function () { return Promise.resolve('{}'); } });
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
    localStorage: makeStorage(options.localStorage),
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

// The shape get_public_price_list_history() returns: no profiles embed, one
// resolved published_by per version, newest first.
function historyRpc(rows) {
  return function () { return { data: rows, error: null }; };
}

function allow() {
  return { data: true, error: null };
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
  // Denied: the panel must not even load the history.
  assert.equal(calls.from.length, 0);
  assert.equal(calls.rpc.some(c => c.name === 'get_public_price_list_history'), false);
});

test('gate: may_edit_public_prices true with a current row shows the editor', async () => {
  const row = {
    id: 'ver-1', document: validDocument(), is_current: true, note: null,
    created_at: new Date().toISOString(), published_by: 'Ana Manager'
  };
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: historyRpc([row])
    }
  });
  await flush();

  assert.equal(elements.editorView.hidden, false, 'editorView should be shown');
  assert.equal(elements.deniedView.hidden, true, 'deniedView must stay hidden');
  assert.ok(calls.rpc.some(c => c.name === 'get_public_price_list_history'));
  // The history arrives through the definer RPC, never through a PostgREST
  // select with a profiles embed: that embed could only ever name the viewer.
  assert.equal(calls.from.length, 0, 'the panel must not query public_price_lists directly');
});

// ---- 2. Login installs the returned session (regression guard for the ----
// ---- brief's broken `result.body.email` check) --------------------------

test('login: installs the session the edge function returned, and does not call signInWithPassword', async () => {
  const { elements, client, calls } = loadEditor({
    session: null, // not signed in yet: land on the sign-in form
    fetch: function () {
      return Promise.resolve({
        ok: true,
        text: function () {
          return Promise.resolve(JSON.stringify({
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
          }));
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
        text: function () { return Promise.resolve(JSON.stringify({ message: 'Nickname/email sau parolă incorectă.' })); }
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
    created_at: new Date().toISOString(), published_by: 'Ana Manager'
  };
  let publishArgs = null;
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: historyRpc([row]),
      publish_public_price_list: function (args) { publishArgs = args; return { data: 'ver-43', error: null }; }
    }
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
    created_at: new Date().toISOString(), published_by: null
  };
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: historyRpc([row])
    }
  });
  await flush();

  assert.equal(elements.publish.disabled, true, 'an invalid document must disable Publică');
  elements.publish.dispatch('click');
  await flush();

  assert.equal(calls.rpc.some(c => c.name === 'publish_public_price_list'), false, 'publish must not be called while the document is invalid');
});

// ---- 4. Attribution: the history names whoever published, not the viewer ----

test('history: a version published by somebody else still shows a name', async () => {
  const rows = [
    {
      id: 'ver-2', document: validDocument(), is_current: true, note: 'a doua',
      created_at: '2026-09-25T10:00:00.000Z', published_by: 'Bogdan Manager'
    },
    {
      id: 'ver-1', document: validDocument(), is_current: false, note: 'prima',
      created_at: '2026-09-24T10:00:00.000Z', published_by: 'Ana Manager'
    }
  ];
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: historyRpc(rows)
    }
  });
  await flush();

  const call = calls.rpc.find(c => c.name === 'get_public_price_list_history');
  assert.ok(call, 'the history must be loaded through the definer RPC');
  assert.equal(call.args, undefined, 'the history RPC takes no arguments');

  // Both names are rendered. Under the old profiles embed exactly one of these
  // could ever have carried a name -- the viewer's own -- and the other silently
  // rendered as a bare timestamp.
  const text = JSON.stringify(elements.history.children.map(li =>
    li.children.map(part => part.children.map(node => node.text).join('') || part.textContent).join(' ')
  ));
  assert.ok(text.includes('Bogdan Manager'), `expected Bogdan Manager in the history, got ${text}`);
  assert.ok(text.includes('Ana Manager'), `expected Ana Manager in the history, got ${text}`);
});

test('history: a null published_by renders without a name and without throwing', async () => {
  const rows = [{
    id: 'ver-1', document: validDocument(), is_current: true, note: 'fără autor',
    created_at: '2026-09-25T10:00:00.000Z', published_by: null
  }];
  const { elements } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: historyRpc(rows)
    }
  });
  await flush();

  assert.equal(elements.editorView.hidden, false);
  assert.equal(elements.history.children.length, 1, 'the version should still be listed');
});

// ---- 5. An untouched empty document must not be publishable ----------------

test('publish is disabled for an untouched empty document and enabled once a row has content', async () => {
  const { elements } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: historyRpc([]) // an unseeded database
    }
  });
  await flush();

  assert.equal(elements.editorView.hidden, false, 'precondition: the editor opens');
  assert.equal(elements.errors.hidden, true, 'an empty document is valid, so no errors are listed');
  assert.equal(elements.publish.disabled, true,
    'Publică must be disabled while the document is still the untouched empty one');

  // Add a row through the editor's own controls.
  findIn(elements.groups, el => el.textContent === '+ Rând').dispatch('click');
  assert.equal(elements.publish.disabled, true, 'a row with no item name is invalid, so still disabled');

  const itemInput = findIn(elements.groups, el => el.placeholder === 'Denumire');
  assert.ok(itemInput, 'the new row should have an item input');
  itemInput.value = 'Coroană ceramică';
  itemInput.dispatch('change');

  assert.equal(elements.publish.disabled, false,
    'once a row carries content the document is publishable');
});

// ---- 6. A corrupt recovered draft must not take the editor down ------------

test('a corrupt draft in localStorage is discarded rather than crashing the editor', async () => {
  const row = {
    id: 'ver-1', document: validDocument(), is_current: true, note: null,
    created_at: '2026-09-25T10:00:00.000Z', published_by: 'Ana Manager'
  };
  const { elements } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: historyRpc([row])
    },
    // groups holds a null: truthy, so the old presence check let it through, and
    // reading group.title off it threw inside validate().
    localStorage: {
      flowrise_public_prices_draft_v1: JSON.stringify({
        doc: { schema: 1, currency: 'lei', groups: [null] },
        currentId: 'ver-1'
      })
    }
  });
  await flush();

  assert.equal(elements.editorView.hidden, false, 'the editor must still open');
  assert.equal(elements.currency.value, 'lei');
  // The database version was used, not the corrupt draft.
  // No "recovered from the browser" message, because the draft was discarded.
  assert.equal(elements.status.textContent, '');
  assert.equal(elements.publish.disabled, false, 'the loaded document is publishable');
});

// ---- 7. Login: a non-JSON error body ---------------------------------------

test('login: an HTML error page yields a readable Romanian message, not a JSON parse error', async () => {
  const { elements, calls } = loadEditor({
    session: null,
    fetch: function () {
      return Promise.resolve({
        ok: false,
        text: function () { return Promise.resolve('<html><head><title>502 Bad Gateway</title></head></html>'); }
      });
    }
  });
  await flush(3);

  elements.identifier.value = 'manager';
  elements.password.value = 'correct horse';
  elements.signInForm.dispatch('submit', { preventDefault: function () {} });
  await flush();

  assert.equal(calls.setSession.length, 0, 'no session may be installed');
  assert.equal(elements.signInError.hidden, false, 'the error must be shown');
  assert.ok(!/Unexpected token/i.test(elements.signInError.textContent),
    `a JSON parse error reached the manager: ${elements.signInError.textContent}`);
  assert.ok(!/<html/i.test(elements.signInError.textContent),
    `the raw HTML body reached the manager: ${elements.signInError.textContent}`);
  assert.match(elements.signInError.textContent, /Serverul a răspuns neașteptat/);
  assert.equal(elements.signInButton.disabled, false, 'the button must be usable again');
});

// ---- 8. Fail closed, and say so --------------------------------------------

test('gate: an error from may_edit_public_prices never opens the editor, and explains itself', async () => {
  const { elements, calls } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: function () {
        return { data: null, error: { message: 'permission denied for function may_edit_public_prices' } };
      }
    }
  });
  await flush();

  assert.equal(elements.editorView.hidden, true, 'the editor must NOT be shown when the gate errors');
  assert.equal(elements.deniedView.hidden, true);
  assert.equal(elements.signInView.hidden, false, 'the panel falls back to the sign-in view');
  assert.equal(elements.signInError.hidden, false, 'a blank login form with no message is the defect');
  assert.match(elements.signInError.textContent, /Nu am putut verifica drepturile/);
  assert.equal(elements.who.hidden, true, 'the signed-in bar must not linger above the login form');
  assert.equal(calls.rpc.some(c => c.name === 'get_public_price_list_history'), false,
    'the history must not be loaded when the gate could not be evaluated');
});

test('a failure after the gate passes hides the signed-in bar along with the editor', async () => {
  // The path where this actually bit: may_edit_public_prices succeeds, so start()
  // has already set $('who').hidden = false and put the manager's email in it, and
  // then loadHistory() rejects. show() toggles the three view sections only, so
  // without hiding it the signed-in bar sat above the login form.
  const { elements } = loadEditor({
    session: { access_token: 'x' },
    rpc: {
      may_edit_public_prices: allow,
      get_public_price_list_history: function () {
        return { data: null, error: { message: 'Laboratorul nu este configurat.' } };
      }
    }
  });
  await flush();

  assert.equal(elements.editorView.hidden, true, 'the editor must not open');
  assert.equal(elements.signInView.hidden, false);
  assert.equal(elements.who.hidden, true, 'the signed-in bar must not stay above the login form');
  assert.match(elements.signInError.textContent, /Nu am putut verifica drepturile/);
});
