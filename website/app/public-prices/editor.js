// The public price editor. Its own login, because the app stores its Supabase
// session in sessionStorage and that does not cross tabs; and its own small
// render loop, because sharing app.js would mean loading 10,000 lines to edit
// thirty-three prices.
(function () {
  'use strict';

  var config = window.FLOWRISE_SUPABASE;
  var client = window.supabase.createClient(config.projectUrl, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage }
  });

  var DRAFT_KEY = 'flowrise_public_prices_draft_v1';
  var $ = function (id) { return document.getElementById(id); };

  var state = { doc: null, currentId: null, history: [], dirty: false };

  // ---- view switching ----------------------------------------------------
  function show(view) {
    ['signInView', 'deniedView', 'editorView'].forEach(function (id) { $(id).hidden = id !== view; });
  }

  function status(message, isError) {
    var el = $('status');
    el.textContent = message || '';
    el.hidden = !message;
    el.style.color = isError ? 'var(--bad)' : 'var(--muted)';
  }

  // ---- sign in -----------------------------------------------------------
  $('signInForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('signInButton');
    var error = $('signInError');
    error.hidden = true;
    button.disabled = true;

    fetch(config.projectUrl + '/functions/v1/' + config.loginFunction, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: config.publishableKey },
      body: JSON.stringify({ identifier: $('identifier').value, password: $('password').value })
    })
      // Read the body as text and guard the parse, the way app.js does against
      // this same endpoint. response.json() on a gateway's 502 HTML page rejects
      // with "Unexpected token '<'", and that string is what the manager would
      // have been shown as the reason their password did not work.
      .then(function (response) {
        return response.text().then(function (text) {
          var body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch (err) {
            body = { message: 'Serverul a răspuns neașteptat. Încearcă din nou.' };
          }
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body || !result.body.session) {
          throw new Error((result.body && result.body.message) || 'Autentificare eșuată.');
        }
        // The edge function already signed in; install the session it returned
        // rather than authenticating a second time with the same password.
        return client.auth.setSession({
          access_token: result.body.session.access_token,
          refresh_token: result.body.session.refresh_token
        });
      })
      .then(function (result) {
        if (result.error) throw new Error('Sesiunea nu a putut fi creată.');
        return start();
      })
      .catch(function (err) {
        error.textContent = err.message;
        error.hidden = false;
      })
      .then(function () { button.disabled = false; });
  });

  $('signOut').addEventListener('click', function () {
    client.auth.signOut().then(function () { window.location.reload(); });
  });

  // ---- loading -----------------------------------------------------------
  function start() {
    return client.rpc('may_edit_public_prices').then(function (result) {
      if (result.error) throw result.error;
      return client.auth.getUser().then(function (user) {
        $('whoName').textContent = (user.data && user.data.user && user.data.user.email) || '';
        $('who').hidden = false;

        if (!result.data) { show('deniedView'); return null; }
        return loadHistory().then(function () {
          var draft = readDraft();
          if (draft && draft.currentId === state.currentId) {
            state.doc = draft.doc;
            state.dirty = true;
            status('Ai o versiune nepublicată, recuperată din browser.');
          }
          show('editorView');
          render();
        });
      });
    });
  }

  // An RPC rather than a PostgREST select with a profiles embed. The only policy
  // on profiles is `id = auth.uid()`, so the embed returned a profile only for
  // versions the signed-in manager published themselves and silently dropped the
  // name from everyone else's -- the exact case attribution is for. The RPC is
  // SECURITY DEFINER, asserts lab management itself, resolves published_by, and
  // returns the versions newest first, so no client-side ordering is needed.
  function loadHistory() {
    return client
      .rpc('get_public_price_list_history')
      .then(function (result) {
        if (result.error) throw result.error;
        state.history = result.data || [];
        var current = state.history.filter(function (row) { return row.is_current; })[0];
        state.currentId = current ? current.id : null;
        if (!state.dirty) state.doc = current ? current.document : window.PriceDocument.emptyDocument();
      });
  }

  // ---- draft persistence -------------------------------------------------
  function readDraft() {
    try {
      var raw = window.localStorage.getItem(DRAFT_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.doc || !parsed.doc.groups) return null;
      // A draft is whatever localStorage happened to hold, which need not be a
      // document of this shape at all. Ordinary errors are fine and wanted --
      // showing them next to the field they came from is why the browser
      // validates -- but a draft the editor cannot draw must be dropped, or
      // renderGroups() throws on load and the manager gets a dead page instead of
      // the published list. That is what the validator's `fatal` marks. A
      // validator that throws outright lands in the catch below, same outcome.
      var problems = window.PriceDocument.validate(parsed.doc);
      if (problems.some(function (problem) { return problem.fatal; })) return null;
      return parsed;
    } catch (err) { return null; }
  }

  function writeDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: state.doc, currentId: state.currentId }));
    } catch (err) { /* a blocked browser just loses the safety net */ }
  }

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (err) { /* nothing to do */ }
  }

  // ---- editing -----------------------------------------------------------
  function apply(next) {
    state.doc = next;
    state.dirty = true;
    writeDraft();
    render();
  }

  function field(el, handler) {
    // change rather than input: apply() re-renders and rewrites the value of
    // the very field being typed into, which would fight the caret on every
    // keystroke. The row inputs below use change for the same reason.
    el.addEventListener('change', handler);
  }

  function render() {
    $('currency').value = state.doc.currency || '';
    $('introNote').value = state.doc.intro_note || '';
    $('footnote').value = state.doc.footnote || '';
    renderGroups();
    renderErrors();
    renderHistory();
  }

  function renderGroups() {
    var host = $('groups');
    host.textContent = '';

    state.doc.groups.forEach(function (group, gi) {
      var card = document.createElement('div');
      card.className = 'group-card';

      var head = document.createElement('div');
      head.className = 'group-head';
      head.appendChild(labelled('Titlu grup', textInput(group.title, 80, function (value) {
        apply(window.PriceDocument.renameGroup(state.doc, gi, value));
      })));
      head.appendChild(moveButtons(function (delta) { apply(window.PriceDocument.moveGroup(state.doc, gi, delta)); }));
      head.appendChild(button('Șterge grup', 'drop', function () {
        if (window.confirm('Ștergi grupul "' + group.title + '" și cele ' + group.rows.length + ' rânduri?')) {
          apply(window.PriceDocument.removeGroup(state.doc, gi));
        }
      }));
      card.appendChild(head);

      group.rows.forEach(function (row, ri) { card.appendChild(rowEditor(group, gi, row, ri)); });

      card.appendChild(button('+ Rând', 'wide', function () { apply(window.PriceDocument.addRow(state.doc, gi)); }));
      host.appendChild(card);
    });
  }

  function rowEditor(group, gi, row, ri) {
    var wrap = document.createElement('div');
    wrap.className = 'row-edit';

    wrap.appendChild(textInput(row.item, 200, function (value) {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { item: value }));
    }, 'Denumire'));

    wrap.appendChild(textInput(row.variant || '', 60, function (value) {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { variant: value }));
    }, 'Material'));

    wrap.appendChild(textInput(String(row.amount), 12, function (value) {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { amount: value }));
    }, 'Preț'));

    var mark = document.createElement('span');
    mark.className = 'mark';
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!row.footnote;
    box.addEventListener('change', function () {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { footnote: box.checked }));
    });
    mark.appendChild(box);
    mark.appendChild(document.createTextNode('†'));
    wrap.appendChild(mark);

    var tail = document.createElement('span');
    tail.className = 'move';
    tail.appendChild(moveButtons(function (delta) { apply(window.PriceDocument.moveRow(state.doc, gi, ri, delta)); }));
    tail.appendChild(button('×', 'drop', function () { apply(window.PriceDocument.removeRow(state.doc, gi, ri)); }));
    wrap.appendChild(tail);

    return wrap;
  }

  function textInput(value, maxLength, onInput, placeholder) {
    var input = document.createElement('input');
    input.type = 'text';
    input.value = value === null || value === undefined ? '' : String(value);
    input.maxLength = maxLength;
    if (placeholder) input.placeholder = placeholder;
    // No re-render on every keystroke: rebuilding the card would steal focus.
    input.addEventListener('change', function () { onInput(input.value); });
    return input;
  }

  function labelled(text, control) {
    var label = document.createElement('label');
    label.appendChild(document.createTextNode(text));
    label.appendChild(control);
    return label;
  }

  function button(text, className, onClick) {
    var element = document.createElement('button');
    element.type = 'button';
    if (className) element.className = className;
    element.textContent = text;
    element.addEventListener('click', onClick);
    return element;
  }

  function moveButtons(onMove) {
    var wrap = document.createElement('span');
    wrap.className = 'move';
    wrap.appendChild(button('↑', null, function () { onMove(-1); }));
    wrap.appendChild(button('↓', null, function () { onMove(1); }));
    return wrap;
  }

  field($('currency'), function () { apply(window.PriceDocument.setField(state.doc, 'currency', $('currency').value)); });
  field($('introNote'), function () { apply(window.PriceDocument.setField(state.doc, 'intro_note', $('introNote').value)); });
  field($('footnote'), function () { apply(window.PriceDocument.setField(state.doc, 'footnote', $('footnote').value)); });
  $('addGroup').addEventListener('click', function () { apply(window.PriceDocument.addGroup(state.doc)); });

  // ---- validation, preview, publish -------------------------------------

  // Deep and key-order-insensitive: a document that came back from the database
  // or out of localStorage has been through JSON and need not carry its keys in
  // emptyDocument()'s order.
  function sameDocument(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(function (key) {
      return Object.prototype.hasOwnProperty.call(b, key) && sameDocument(a[key], b[key]);
    });
  }

  // On an unseeded database the panel opens on emptyDocument(), which validates
  // clean -- so Publică was enabled on a document whose only content is a group
  // titled "Grup nou" with no rows, and publishing it would put a bare heading on
  // the public page.
  //
  // A UI guard, deliberately not a validation rule: the SQL validator allows an
  // empty rows array by design, and a browser-only "must have at least one row"
  // rule would recreate exactly the browser/database divergence that made the
  // publish button unusable over two-decimal prices.
  function isUntouchedEmptyDocument() {
    return sameDocument(state.doc, window.PriceDocument.emptyDocument());
  }

  function renderErrors() {
    var errors = window.PriceDocument.validate(state.doc);
    var list = $('errors');
    list.textContent = '';
    errors.forEach(function (error) {
      var li = document.createElement('li');
      li.textContent = error.path ? error.path + ': ' + error.message : error.message;
      list.appendChild(li);
    });
    list.hidden = errors.length === 0;
    $('publish').disabled = errors.length > 0 || isUntouchedEmptyDocument();
    return errors;
  }

  $('preview').addEventListener('click', function () {
    window.PriceList.mount(window.PriceList.priceListTree(state.doc), $('previewList'));
    $('previewCard').hidden = false;
    $('previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('publish').addEventListener('click', function () {
    if (renderErrors().length || isUntouchedEmptyDocument()) return;
    $('publish').disabled = true;
    status('Se publică…');

    client
      .rpc('publish_public_price_list', {
        p_document: state.doc,
        p_note: $('publishNote').value,
        p_expected_current: state.currentId
      })
      .then(function (result) {
        if (result.error) throw result.error;
        state.dirty = false;
        clearDraft();
        $('publishNote').value = '';
        return loadHistory().then(function () {
          render();
          status('Publicat. Pagina publică arată noile prețuri.');
        });
      })
      .catch(function (err) {
        status(err.message || 'Publicarea a eșuat.', true);
        $('publish').disabled = false;
      });
  });

  function renderHistory() {
    var host = $('history');
    host.textContent = '';

    state.history.forEach(function (row) {
      var li = document.createElement('li');
      var left = document.createElement('span');
      var who = row.published_by;
      var when = new Date(row.created_at).toLocaleString('ro-RO');
      left.appendChild(document.createTextNode(when + (who ? ' · ' + who : '') + (row.note ? ' · ' + row.note : '')));
      left.className = 'when';
      li.appendChild(left);

      if (row.is_current) {
        var live = document.createElement('span');
        live.className = 'live';
        live.textContent = 'publicat';
        li.appendChild(live);
      } else {
        li.appendChild(button('Restaurează', null, function () {
          if (!window.confirm('Faci publică versiunea din ' + when + '?')) return;
          client.rpc('set_current_public_price_list', { p_version_id: row.id })
            .then(function (result) {
              if (result.error) throw result.error;
              state.dirty = false;
              clearDraft();
              return loadHistory().then(function () { render(); status('Versiunea a fost restaurată.'); });
            })
            .catch(function (err) { status(err.message || 'Restaurarea a eșuat.', true); });
        }));
      }

      host.appendChild(li);
    });
  }

  // A reload with a live session should land in the editor, not the login form.
  // Failing closed is correct -- if may_edit_public_prices() cannot be reached,
  // nobody gets an editor -- but failing closed silently left a signed-in manager
  // staring at a blank login form with no idea why, so say something.
  client.auth.getSession().then(function (result) {
    if (result.data && result.data.session) {
      start().catch(function () {
        show('signInView');
        var error = $('signInError');
        error.textContent = 'Nu am putut verifica drepturile de editare. Autentifică-te din nou.';
        error.hidden = false;
      });
    } else {
      show('signInView');
    }
  });
})();
