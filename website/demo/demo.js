'use strict';

const API = '/api/demo';
const POLL_MS = 5000;
// Mirrors MAX_UPLOAD_BYTES in tools/build-demo-workflows.js and the figure
// the FILE_TOO_LARGE copy promises. The server's check is the real one --
// this only avoids sending the bytes to be rejected.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const POLL_MAX_ATTEMPTS = 60; // 60 x 5s = 5 minutes; extraction is normally 30-90s
const REQUEST_TIMEOUT_MS = 45000;
// Must match the server's own limit check (messages_used < 10). The chat
// response includes messages_left once a conversation starts, so this
// value is only ever shown before the first reply comes back.
const MESSAGE_LIMIT = 10;
const LANG_KEY = 'adaptive-lang'; // shared with the main site's toggle

let pollAttempts = 0;

const $ = (id) => document.getElementById(id);
const state = { email: '', turnstile: '', uploadId: null, filename: '' };

window.onTurnstile = (token) => { state.turnstile = token; };

// Turnstile tokens are single-use and expire after ~300 seconds. Without a
// reset, a visitor whose first submit fails for any reason (bad email,
// dropped connection, a slow read of the page before submitting) retries
// with a spent token that siteverify rejects -- and every attempt after
// that fails identically, with no recovery short of a page reload.
function resetTurnstile() {
  state.turnstile = '';
  try { window.turnstile && window.turnstile.reset(); } catch (_) { /* widget not ready */ }
}

function show(name) {
  for (const id of ['state-gate', 'state-code', 'state-upload', 'state-chat']) {
    $(id).hidden = id !== 'state-' + name;
  }
}

function fail(elId, message) {
  const el = $(elId);
  el.textContent = message;
  el.hidden = false;
}

function clearError(elId) { $(elId).hidden = true; }

// ── Language ────────────────────────────────────────────────────────────
// Every failure produces a state the UI can render, and it has to render in
// whichever language the visitor is reading. A dead spinner is the one
// outcome that is not allowed; a Romanian-only error on an English page is
// the other.
const STRINGS = {
  ro: {
    MESSAGES: {
      INVALID_EMAIL: 'Adresa de email nu pare validă.',
      CONSENT_REQUIRED: 'Bifează căsuța pentru a continua.',
      BAD_CODE: 'Cod greșit sau expirat. Cere unul nou.',
      SESSION_INVALID: 'Sesiunea a expirat. Ia-o de la început.',
      UPLOAD_LIMIT: 'Ai încărcat deja un document în această sesiune.',
      FILE_TOO_LARGE: 'Fișierul depășește 10 MB.',
      UNSUPPORTED_TYPE: 'Acceptăm doar PDF, DOCX sau TXT.',
      NO_TEXT_LAYER: 'Documentul pare scanat și nu conține text. Încearcă unul cu text selectabil.',
      DOCUMENT_TOO_LONG: 'Documentul este prea lung pentru demo. Încearcă unul mai scurt, sau doar capitolul care te interesează.',
      MESSAGE_LIMIT: 'Ai folosit toate întrebările din acest demo.',
      UNAVAILABLE: 'Demo-ul este temporar indisponibil. Scrie-ne și îți arătăm live.',
      NETWORK: 'Conexiune întreruptă. Încearcă din nou.',
      TIMEOUT: 'Cererea a durat prea mult. Încearcă din nou.',
      STALLED: 'Procesarea durează neobișnuit de mult. Încearcă un alt document sau scrie-ne.',
    },
    STAGE_TEXT: {
      pending: 'În așteptare…',
      extracting: 'Extragem textul din document…',
      embedding: 'Construim indexul…',
    },
    generic: 'Ceva n-a mers. Încearcă din nou.',
    waitingSecurity: 'Așteaptă verificarea de securitate.',
    uploading: 'Se încarcă…',
    processing: 'Se procesează…',
    remainingOne: 'o întrebare rămasă',
    remainingN: (n) => n + ' întrebări rămase',
  },
  en: {
    MESSAGES: {
      INVALID_EMAIL: 'That email address doesn’t look valid.',
      CONSENT_REQUIRED: 'Check the box to continue.',
      BAD_CODE: 'Wrong or expired code. Ask for a new one.',
      SESSION_INVALID: 'Your session expired. Start again from the top.',
      UPLOAD_LIMIT: 'You’ve already uploaded a document in this session.',
      FILE_TOO_LARGE: 'The file is over 10 MB.',
      UNSUPPORTED_TYPE: 'We only accept PDF, DOCX, or TXT.',
      NO_TEXT_LAYER: 'This document looks scanned and has no text layer. Try one with selectable text.',
      DOCUMENT_TOO_LONG: 'This document is too long for the demo. Try a shorter one, or just the chapter you care about.',
      MESSAGE_LIMIT: 'You’ve used all the questions in this demo.',
      UNAVAILABLE: 'The demo is temporarily unavailable. Message us and we’ll show you live.',
      NETWORK: 'Connection lost. Try again.',
      TIMEOUT: 'That request took too long. Try again.',
      STALLED: 'Processing is taking unusually long. Try a different document or message us.',
    },
    STAGE_TEXT: {
      pending: 'Waiting…',
      extracting: 'Extracting text from the document…',
      embedding: 'Building the index…',
    },
    generic: 'Something went wrong. Try again.',
    waitingSecurity: 'Waiting for the security check.',
    uploading: 'Uploading…',
    processing: 'Processing…',
    remainingOne: 'one question left',
    remainingN: (n) => n + ' questions left',
  },
};

function lang() { return document.documentElement.lang === 'en' ? 'en' : 'ro'; }
function t() { return STRINGS[lang()]; }
const explain = (code) => t().MESSAGES[code] || t().generic;

function setLang(next) {
  document.documentElement.lang = next;
  $('lang-ro').classList.toggle('active', next === 'ro');
  $('lang-en').classList.toggle('active', next === 'en');
  try { localStorage.setItem(LANG_KEY, next); } catch (_) { /* private mode etc. */ }

  document.querySelectorAll('[data-ro-placeholder]').forEach((el) => {
    el.placeholder = next === 'en' ? el.dataset.enPlaceholder : el.dataset.roPlaceholder;
  });
}

$('lang-ro').addEventListener('click', () => setLang('ro'));
$('lang-en').addEventListener('click', () => setLang('en'));

try {
  const saved = localStorage.getItem(LANG_KEY);
  setLang(saved === 'en' ? 'en' : 'ro');
} catch (_) {
  setLang('ro');
}

// ── Networking ──────────────────────────────────────────────────────────
// A dead spinner is the one outcome that is not allowed — which covers a
// request that rejects outright, but just as much a request an n8n webhook
// accepts and then never answers (a realistic failure when it's waiting on
// an LLM call). The timeout turns that hang into the same recoverable error
// state as a dropped connection.
async function post(path, body, isForm) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(API + path, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
  } catch (err) {
    // An abort and a refused connection are different causes with the same
    // remedy for the visitor: the request did not get through, try again.
    throw new Error(err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body is fine */ }
  if (!res.ok) throw new Error(data.code || 'UNAVAILABLE');
  return data;
}

$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('gate-error');
  const email = $('email').value.trim();
  // novalidate is set on the form (see index.html), so the native
  // type="email" check never runs; validate here so a typo surfaces
  // immediately instead of advancing to "check your email" and stranding
  // the visitor there -- /request-code returns 202 unconditionally by
  // design, so the server never tells the client the address was bad.
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return fail('gate-error', explain('INVALID_EMAIL'));
  if (!$('consent').checked) return fail('gate-error', explain('CONSENT_REQUIRED'));
  if (!state.turnstile) return fail('gate-error', t().waitingSecurity);

  $('gate-submit').disabled = true;
  try {
    await post('/request-code', { email, consent: true, turnstile_token: state.turnstile });
    state.email = email;
    show('code');
    $('code').focus();
  } catch (err) {
    fail('gate-error', explain(err.message));
    resetTurnstile();
  } finally {
    $('gate-submit').disabled = false;
  }
});

$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('code-error');
  $('code-submit').disabled = true;
  try {
    await post('/verify-code', { email: state.email, code: $('code').value.trim() });
    show('upload');
  } catch (err) {
    fail('code-error', explain(err.message));
  } finally {
    $('code-submit').disabled = false;
  }
});

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('upload-error');
  const file = $('file').files[0];
  if (!file) return;

  // accept=".pdf,.docx,.txt" is a picker hint the browser does not enforce,
  // and the server cannot see the size until the whole body has arrived.
  // Without this a 300 MB file uploads in full and is then rejected, on the
  // visitor's connection and our ingress.
  if (file.size > MAX_UPLOAD_BYTES) return fail('upload-error', explain('FILE_TOO_LARGE'));

  state.filename = file.name;
  const form = new FormData();
  form.append('file', file);

  $('upload-submit').disabled = true;
  $('progress').hidden = false;
  $('progress-text').textContent = t().uploading;

  try {
    const res = await post('/upload', form, true);
    if (!res.upload_id) throw new Error('UPLOAD_LIMIT');
    state.uploadId = res.upload_id;
    pollAttempts = 0;
    poll();
  } catch (err) {
    $('progress').hidden = true;
    $('upload-submit').disabled = false;
    fail('upload-error', explain(err.message));
  }
});

async function poll() {
  pollAttempts += 1;
  if (pollAttempts > POLL_MAX_ATTEMPTS) {
    $('progress').hidden = true;
    $('upload-submit').disabled = false;
    return fail('upload-error', explain('STALLED'));
  }

  let res;
  try {
    res = await post('/upload-status', { upload_id: state.uploadId });
  } catch (err) {
    $('progress').hidden = true;
    $('upload-submit').disabled = false;
    return fail('upload-error', explain(err.message));
  }

  if (res.status === 'ready') {
    $('progress').hidden = true;
    $('chat-filename').textContent = state.filename;
    setRemaining(MESSAGE_LIMIT);
    show('chat');
    $('question').focus();
    return;
  }

  if (res.status === 'failed') {
    $('progress').hidden = true;
    $('upload-submit').disabled = false;
    return fail('upload-error', explain(res.error));
  }

  $('progress-text').textContent = t().STAGE_TEXT[res.status] || t().processing;
  setTimeout(poll, POLL_MS);
}

function setRemaining(n) {
  $('chat-remaining').textContent = n === 1 ? t().remainingOne : t().remainingN(n);
}

function addMessage(role, text, sources) {
  const li = document.createElement('li');
  li.className = 'demo__msg demo__msg--' + role;

  const body = document.createElement('p');
  body.textContent = text;           // textContent, never innerHTML
  li.appendChild(body);

  if (sources && sources.length) {
    const chips = document.createElement('ul');
    chips.className = 'demo__sources';
    for (const s of sources) {
      const chip = document.createElement('li');
      chip.textContent = s.section ? s.file + ' — ' + s.section : s.file;
      chips.appendChild(chip);
    }
    li.appendChild(chips);
  }

  $('messages').appendChild(li);
  li.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return li;
}

$('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('chat-error');
  const question = $('question').value.trim();
  if (!question) return;

  addMessage('user', question);
  $('question').value = '';
  $('chat-submit').disabled = true;

  const typing = addMessage('assistant', '…');
  try {
    const res = await post('/chat', { message: question });
    typing.remove();

    // A 200 with a missing/malformed field is still a failure a visitor
    // needs to see, not a bubble reading the literal word "undefined" — and
    // not a limit check that silently never engages because
    // `undefined <= 0` is false.
    const answer = typeof res.answer === 'string' ? res.answer : '';
    if (!answer) throw new Error('UNAVAILABLE');
    const left = Number.isFinite(res.messages_left) ? res.messages_left : 0;

    addMessage('assistant', answer, res.sources);
    setRemaining(left);
    if (left <= 0) {
      $('question').disabled = true;
      $('chat-submit').disabled = true;
      fail('chat-error', explain('MESSAGE_LIMIT'));
      return;
    }
  } catch (err) {
    typing.remove();
    fail('chat-error', explain(err.message));
  } finally {
    if (!$('question').disabled) {
      $('chat-submit').disabled = false;
      $('question').focus();
    }
  }
});
