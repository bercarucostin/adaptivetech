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
      .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
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

  function loadHistory() {
    return client
      .from('public_price_lists')
      .select('id,document,is_current,note,created_at,created_by,profiles:created_by(display_name,username)')
      .order('created_at', { ascending: false })
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
      return parsed && parsed.doc && parsed.doc.groups ? parsed : null;
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
    $('publish').disabled = errors.length > 0;
    return errors;
  }

  $('preview').addEventListener('click', function () {
    window.PriceList.mount(window.PriceList.priceListTree(state.doc), $('previewList'));
    $('previewCard').hidden = false;
    $('previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('publish').addEventListener('click', function () {
    if (renderErrors().length) return;
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
      var who = row.profiles && (row.profiles.display_name || row.profiles.username);
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
  client.auth.getSession().then(function (result) {
    if (result.data && result.data.session) start().catch(function () { show('signInView'); });
    else show('signInView');
  });
})();
