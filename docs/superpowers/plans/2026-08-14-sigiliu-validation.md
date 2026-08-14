# Sigiliu Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual `validated_numbers` entry with self-service verification, where an unknown WhatsApp number sends its *sigiliu de identificare* and is checked against a mirror of Partner's technicians Google Sheet.

**Architecture:** Two Postgres tables — `technicians` (a full mirror of the sheet, rebuilt atomically on each sync) and `validated_numbers` (phone + sigiliu + a refreshed snapshot of name/unit). The agent's dead-end "not validated" branch becomes a verification path: extract sigiliu candidates from the message, look them up, insert, confirm. The ingestion workflow's Drive→Sheets→upsert chain is replaced by Drive→Sheets→Code→one atomic SQL statement.

**Tech Stack:** n8n (workflow JSON), Supabase Postgres, Node 20 (`node:test`) for the pure-JavaScript logic, WhatsApp Cloud API.

**Source spec:** [docs/superpowers/specs/2026-08-14-sigiliu-validation-design.md](../specs/2026-08-14-sigiliu-validation-design.md)

## Global Constraints

- **The Ask Sigiliu message must reveal nothing about the sigiliu** — no example, no placeholder, no description of its format. It is sent pre-authentication. Exact text: `Salut! Pentru a folosi acest asistent, te rog trimite-mi sigiliul tau de identificare. Daca nu il ai, contacteaza Partner.`
- **Sigiliu matching is strictly three digits.** Never loosen to 1–3 digits with zero-padding: `DE` is a real prefix and `DE 001/002/003/005` all exist, so the ordinary Romanian phrase `de 5 zile` would authenticate a stranger.
- **One normalisation rule on both sides:** `s.toUpperCase().replace(/[^A-Z0-9]/g, '')`. The agent and the sync must use byte-identical implementations; Task 3 enforces this with a test.
- **Extraction regex, verbatim:** `/(?<![A-Za-z0-9])([A-Za-z]{2})[ ._-]?(\d{3})(?![0-9])/g`
- **Phone identity is `contacts[0].wa_id`**, matching the existing `Get valid numbers` lookup — never `messages[0].from`, which is only used as a reply address.
- **No unique constraint on `sigiliu`** in either table: `MA 050` appears twice in the sheet, and one sigiliu may validate several phones.
- **Tie-break on lowest `nr_crt`** wherever a sigiliu lookup could return two rows.
- **`ON CONFLICT` on the insert must not touch `is_active`** — that is what stops a revoked number resurrecting itself.
- **Sync floor is 100 rows**, counted after blank-row removal.
- This repo has no package.json and no build step. Tests run with `node --test tests/` from the repo root. Library files are CommonJS.

---

## File Structure

| File | Responsibility |
|---|---|
| `db/technicians.sql` | DDL for the sheet mirror (new) |
| `db/validated_numbers.sql` | DDL for the rebuilt validated numbers table (rewritten) |
| `lib/sigiliu.js` | `normalizeSigiliu`, `extractSigilii` — the agent's extraction logic (new) |
| `lib/sync-batch.js` | `buildSyncBatch` — sheet row mapping, floor guard (new) |
| `tests/sigiliu.test.js` | Unit tests for extraction, incl. the `de 5 zile` guard (new) |
| `tests/sync-batch.test.js` | Unit tests for batch building + normalise parity (new) |
| `tests/ingestion-workflow.test.js` | Structural + drift assertions on `ingestion.json` (new) |
| `tests/agent-workflow.test.js` | Structural + drift assertions on `agent.json` (new) |
| `workflows/ingestion.json` | 3 nodes deleted, 4 added, connections rewired |
| `workflows/agent.json` | `Validate Phone` IF replaced by 3-way Switch, 7 nodes added |

The two `lib/` files each carry a `SHARED` region that is copied verbatim into an n8n Code node. n8n Code nodes cannot `require`, so this duplication is unavoidable; the workflow tests assert the copies never drift.

---

## Task 1: Database schema

**Files:**
- Create: `db/technicians.sql`
- Modify: `db/validated_numbers.sql` (full rewrite)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `public.technicians` (`id, nr_crt, technician_name, service_unit, sigiliu_raw, sigiliu, synced_at`) and `public.validated_numbers` (`id, phone_e164, sigiliu, nr_crt, technician_name, service_unit, is_active, ai_whisperer, notes, validated_at, updated_at`). Tasks 4 and 5 write SQL against these exact column names.

- [ ] **Step 1: Write the verification query and confirm it fails**

Save this as a scratch query and run it in the Supabase SQL editor:

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('technicians', 'validated_numbers')
ORDER BY table_name, ordinal_position;
```

Expected right now: rows for `validated_numbers` only, showing the *old* shape (`phone_e164, is_active, notes, updated_at, business_name, ai_whisperer`), and **no `technicians` rows at all**. That is the red state.

- [ ] **Step 2: Write `db/technicians.sql`**

```sql
create table public.technicians (
  id              bigserial primary key,
  nr_crt          integer,
  technician_name text not null,
  service_unit    text,
  sigiliu_raw     text not null,
  sigiliu         text not null,
  synced_at       timestamptz not null default now()
);

create index technicians_sigiliu_idx on public.technicians (sigiliu);
```

There is deliberately no unique constraint on `sigiliu`: `MA 050` appears twice in the source sheet.

- [ ] **Step 3: Rewrite `db/validated_numbers.sql`**

Replace the entire file with:

```sql
-- Dropped and rebuilt on 2026-08-14. The previous table keyed validation on a
-- manually maintained phone list; this one keys it on the technician's sigiliu.
drop table if exists public.validated_numbers;

create table public.validated_numbers (
  id              bigserial primary key,
  phone_e164      text not null unique,
  sigiliu         text,
  nr_crt          integer,
  technician_name text,
  service_unit    text,
  is_active       boolean not null default true,
  ai_whisperer    boolean not null default false,
  notes           text,
  validated_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index validated_numbers_sigiliu_idx on public.validated_numbers (sigiliu);
```

`sigiliu` is nullable on purpose: a NULL means a hand-granted row, and the sync never deletes those.

- [ ] **Step 4: Apply both files to Supabase**

Run the contents of `db/validated_numbers.sql` then `db/technicians.sql` in the Supabase SQL editor, in that order.

- [ ] **Step 5: Re-run the verification query to confirm it passes**

Run the Step 1 query again. Expected: 7 rows for `technicians` and 11 rows for `validated_numbers`, with `validated_numbers.business_name` **absent** and `validated_numbers.sigiliu` present and nullable.

Then confirm the escape hatch and the unique constraint both behave:

```sql
INSERT INTO validated_numbers (phone_e164, notes) VALUES ('40700000000', 'plan task 1 smoke test');
INSERT INTO validated_numbers (phone_e164, notes) VALUES ('40700000000', 'duplicate');
```

Expected: the first succeeds with `sigiliu` NULL; the second fails with `duplicate key value violates unique constraint "validated_numbers_phone_e164_key"`. Then clean up:

```sql
DELETE FROM validated_numbers WHERE phone_e164 = '40700000000';
```

- [ ] **Step 6: Commit**

```bash
git add db/technicians.sql db/validated_numbers.sql
git commit -m "feat(db): add technicians mirror, rebuild validated_numbers on sigiliu"
```

---

## Task 2: Sigiliu extraction library

**Files:**
- Create: `lib/sigiliu.js`
- Test: `tests/sigiliu.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `module.exports = { normalizeSigiliu, extractSigilii }`.
  - `normalizeSigiliu(value: unknown) => string` — uppercase, non-alphanumerics stripped. Nullish yields `''`; any other non-string is coerced with `String()` first, so a numeric spreadsheet cell normalises to its digits rather than vanishing. That matters downstream: `buildSyncBatch` reports a malformed sigiliu, but silently drops an empty one.
  - `extractSigilii(text: unknown) => string[]` — normalised candidates in order of appearance, deduplicated. Non-strings yield `[]`.
  - The file contains a region delimited by `// ---8<--- SHARED START ---8<---` and `// ---8<--- SHARED END ---8<---`, and within it a nested region delimited by `// ---8<--- NORMALIZE START ---8<---` and `// ---8<--- NORMALIZE END ---8<---`. Task 3 and Task 5 read these markers.

- [ ] **Step 1: Write the failing test**

Create `tests/sigiliu.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeSigiliu, extractSigilii } = require('../lib/sigiliu.js');

test('normalizeSigiliu uppercases and strips separators', () => {
  assert.strictEqual(normalizeSigiliu('PN 002'), 'PN002');
  assert.strictEqual(normalizeSigiliu('pn-002'), 'PN002');
  assert.strictEqual(normalizeSigiliu('WR001'), 'WR001');
  assert.strictEqual(normalizeSigiliu('  pn . 002  '), 'PN002');
});

test('normalizeSigiliu tolerates non-strings', () => {
  assert.strictEqual(normalizeSigiliu(null), '');
  assert.strictEqual(normalizeSigiliu(undefined), '');
  assert.strictEqual(normalizeSigiliu(123), '123');
});

test('extractSigilii accepts every realistic way of typing a sigiliu', () => {
  assert.deepStrictEqual(extractSigilii('PN 002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('pn002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN-002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN.002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN_002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('Sigiliul meu este PN 002, mersi'), ['PN002']);
});

test('extractSigilii matches the sheet-side malformed WR001 both ways', () => {
  assert.deepStrictEqual(extractSigilii('WR001'), ['WR001']);
  assert.deepStrictEqual(extractSigilii('WR 001'), ['WR001']);
});

test('extractSigilii ignores tokens embedded in longer runs', () => {
  assert.deepStrictEqual(extractSigilii('am comanda AB1234 in lucru'), []);
  assert.deepStrictEqual(extractSigilii('sigiliuPN002'), []);
  assert.deepStrictEqual(extractSigilii('va rog ajutor, 12345'), []);
});

// SECURITY: DE is a real prefix and DE 001/002/003/005 all exist in the sheet.
// A 1-3 digit rule with zero-padding would let ordinary Romanian authenticate a
// stranger. These cases must stay empty.
test('extractSigilii does not authenticate ordinary Romanian prose', () => {
  assert.deepStrictEqual(extractSigilii('am asteptat de 5 zile'), []);
  assert.deepStrictEqual(extractSigilii('de 2 ori pe zi'), []);
  assert.deepStrictEqual(extractSigilii('costa 50 de lei'), []);
});

// SECURITY: this message is sent before the sender is known, so any token in it
// is a credential handed to a stranger.
test('the Ask Sigiliu prompt itself contains no extractable sigiliu', () => {
  const prompt =
    'Salut! Pentru a folosi acest asistent, te rog trimite-mi sigiliul tau de ' +
    'identificare. Daca nu il ai, contacteaza Partner.';
  assert.deepStrictEqual(extractSigilii(prompt), []);
});

test('extractSigilii preserves order and deduplicates', () => {
  assert.deepStrictEqual(extractSigilii('PN 002 si SW 020'), ['PN002', 'SW020']);
  assert.deepStrictEqual(extractSigilii('PN 002 apoi PN-002'), ['PN002']);
});

test('extractSigilii is safe to call repeatedly', () => {
  assert.deepStrictEqual(extractSigilii('PN 002'), ['PN002']);
  assert.deepStrictEqual(extractSigilii('PN 002'), ['PN002']);
});

test('extractSigilii tolerates non-strings', () => {
  assert.deepStrictEqual(extractSigilii(null), []);
  assert.deepStrictEqual(extractSigilii(undefined), []);
  assert.deepStrictEqual(extractSigilii(123), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/sigiliu.test.js`

Expected: FAIL — `Cannot find module '../lib/sigiliu.js'`.

- [ ] **Step 3: Write the implementation**

Create `lib/sigiliu.js`:

```js
'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Extract Sigiliu" Code node in workflows/agent.json.
// tests/agent-workflow.test.js fails if the two drift apart.

// ---8<--- NORMALIZE START ---8<---
function normalizeSigiliu(value) {
  if (value === null || value === undefined) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
// ---8<--- NORMALIZE END ---8<---

// Two letters, an optional single separator, exactly three digits -- and only as
// a standalone token. The boundary assertions are load-bearing: without them
// "AB1234" yields a spurious "AB123". Three digits is also load-bearing: DE is a
// real prefix, so a padding rule would make "de 5 zile" authenticate a stranger.
const SIGILIU_TOKEN = /(?<![A-Za-z0-9])([A-Za-z]{2})[ ._-]?(\d{3})(?![0-9])/g;

function extractSigilii(text) {
  if (typeof text !== 'string') return [];
  const found = [];
  SIGILIU_TOKEN.lastIndex = 0;
  let match;
  while ((match = SIGILIU_TOKEN.exec(text)) !== null) {
    const candidate = normalizeSigiliu(match[1] + match[2]);
    if (!found.includes(candidate)) found.push(candidate);
  }
  return found;
}
// ---8<--- SHARED END ---8<---

module.exports = { normalizeSigiliu, extractSigilii };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/sigiliu.test.js`

Expected: PASS — `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/sigiliu.js tests/sigiliu.test.js
git commit -m "feat(lib): add sigiliu normalisation and extraction with prose-safety tests"
```

---

## Task 3: Sync batch builder

**Files:**
- Create: `lib/sync-batch.js`
- Test: `tests/sync-batch.test.js`

**Interfaces:**
- Consumes: the `NORMALIZE` region of `lib/sigiliu.js` (copied, not required — see below).
- Produces: `module.exports = { buildSyncBatch }`.
  - `buildSyncBatch(rows: object[], floor: number) => { batch: BatchRow[], malformed: string[] }`
  - `BatchRow = { nr_crt: number|null, technician_name: string, service_unit: string|null, sigiliu_raw: string, sigiliu: string }`
  - Throws `Error` when `batch.length < floor`.
  - Carries the same `SHARED` and `NORMALIZE` marker regions as `lib/sigiliu.js`.

The sheet is human-maintained and already inconsistent — the header is `Unitatea de service ` with a trailing space, and `Nume și prenume` uses `ș` (U+0219) which a person could retype as `ş` (U+015F). Column lookup therefore matches on a diacritic-stripped, lowercased substring rather than an exact header string.

- [ ] **Step 1: Write the failing test**

Create `tests/sync-batch.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildSyncBatch } = require('../lib/sync-batch.js');

const ROOT = path.join(__dirname, '..');

function sheetRow(nr, name, unit, sigiliu) {
  return {
    'Nr. Crt': nr,
    'Nume și prenume tehnician de service': name,
    'Unitatea de service ': unit, // trailing space, exactly as the real sheet has it
    'Sigiliu de identificare': sigiliu,
  };
}

function padTo(rows, total) {
  const out = rows.slice();
  let n = out.length;
  while (out.length < total) {
    n += 1;
    out.push(sheetRow(n, `TECHNICIAN ${n}`, 'FILLER SRL', `ZZ${String(n).padStart(3, '0')}`));
  }
  return out;
}

test('buildSyncBatch maps and normalises sheet rows', () => {
  const rows = padTo([
    sheetRow(1, 'PETRISOR MIHAI CRISTIAN', 'PARTNER CORPORATION SRL', 'PN 002'),
    sheetRow(466, 'GIURGIU HODIS LUIGI DANIEL', 'WEB COMPUTERS SRL', 'WR001'),
  ], 100);
  const { batch } = buildSyncBatch(rows, 100);

  assert.strictEqual(batch.length, 100);
  assert.deepStrictEqual(batch[0], {
    nr_crt: 1,
    technician_name: 'PETRISOR MIHAI CRISTIAN',
    service_unit: 'PARTNER CORPORATION SRL',
    sigiliu_raw: 'PN 002',
    sigiliu: 'PN002',
  });
  assert.strictEqual(batch[1].sigiliu, 'WR001');
  assert.strictEqual(batch[1].sigiliu_raw, 'WR001');
});

test('buildSyncBatch tolerates header variants', () => {
  const rows = padTo([{
    'nr. crt': 7,
    'NUME ȘI PRENUME TEHNICIAN DE SERVICE': 'TEST PERSON',
    'Unitatea de Service': 'TEST SRL',   // no trailing space, different case
    ' Sigiliu de identificare ': 'AB 123',
  }], 100);
  const { batch } = buildSyncBatch(rows, 100);

  assert.strictEqual(batch[0].nr_crt, 7);
  assert.strictEqual(batch[0].technician_name, 'TEST PERSON');
  assert.strictEqual(batch[0].service_unit, 'TEST SRL');
  assert.strictEqual(batch[0].sigiliu, 'AB123');
});

test('buildSyncBatch tolerates the s-cedilla spelling of the name header', () => {
  const rows = padTo([{
    'Nr. Crt': 8,
    'Nume şi prenume tehnician de service': 'CEDILLA PERSON', // U+015F, not U+0219
    'Unitatea de service ': 'TEST SRL',
    'Sigiliu de identificare': 'AC 124',
  }], 100);
  const { batch } = buildSyncBatch(rows, 100);
  assert.strictEqual(batch[0].technician_name, 'CEDILLA PERSON');
});

test('buildSyncBatch drops rows missing a name or a sigiliu', () => {
  const rows = padTo([
    sheetRow(1, 'REAL PERSON', 'REAL SRL', 'PN 002'),
    sheetRow(2, '', 'ORPHAN SRL', 'PN 003'),
    sheetRow(3, 'NO SIGILIU', 'REAL SRL', '   '),
    sheetRow('', '', '', ''),
  ], 103);
  const { batch } = buildSyncBatch(rows, 100);

  assert.strictEqual(batch.length, 100);
  assert.ok(!batch.some((r) => r.technician_name === 'NO SIGILIU'));
});

test('buildSyncBatch keeps malformed sigilii but reports them', () => {
  const rows = padTo([
    sheetRow(1, 'GOOD PERSON', 'REAL SRL', 'PN 002'),
    sheetRow(2, 'BAD PERSON', 'REAL SRL', 'ABC 001'),
  ], 100);
  const { batch, malformed } = buildSyncBatch(rows, 100);

  assert.ok(batch.some((r) => r.sigiliu === 'ABC001'), 'malformed row is still mirrored');
  assert.deepStrictEqual(malformed, ['ABC 001']);
});

test('buildSyncBatch throws below the floor', () => {
  const rows = [sheetRow(1, 'ONLY PERSON', 'REAL SRL', 'PN 002')];
  assert.throws(() => buildSyncBatch(rows, 100), /only 1 usable rows.*floor is 100/s);
});

test('the floor counts rows surviving the blank drop, not rows read', () => {
  const rows = padTo([], 99);
  rows.push(sheetRow(100, '', '', ''));   // blank -> dropped
  rows.push(sheetRow(101, '', '', ''));   // blank -> dropped
  assert.strictEqual(rows.length, 101);
  assert.throws(() => buildSyncBatch(rows, 100), /only 99 usable rows/);
});

test('buildSyncBatch tolerates an empty sheet without wiping anything', () => {
  assert.throws(() => buildSyncBatch([], 100), /only 0 usable rows/);
});

// The spec requires one normalisation rule on both sides. n8n Code nodes cannot
// require(), so the function is duplicated -- this makes the duplication a
// checked invariant instead of a latent bug.
test('normalisation is byte-identical to lib/sigiliu.js', () => {
  const region = (file) => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', file), 'utf8');
    const start = src.indexOf('// ---8<--- NORMALIZE START ---8<---');
    const end = src.indexOf('// ---8<--- NORMALIZE END ---8<---');
    assert.ok(start !== -1 && end > start, `NORMALIZE markers missing in ${file}`);
    return src.slice(start, end);
  };
  assert.strictEqual(region('sync-batch.js'), region('sigiliu.js'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/sync-batch.test.js`

Expected: FAIL — `Cannot find module '../lib/sync-batch.js'`.

- [ ] **Step 3: Write the implementation**

Create `lib/sync-batch.js`. The `NORMALIZE` region must be copied character-for-character from `lib/sigiliu.js`, including the comment lines:

```js
'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Sync Batch" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

// ---8<--- NORMALIZE START ---8<---
function normalizeSigiliu(value) {
  if (value === null || value === undefined) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
// ---8<--- NORMALIZE END ---8<---

const SIGILIU_SHAPE = /^[A-Z]{2}\d{3}$/;

// The sheet is human-maintained: the real header is "Unitatea de service " with
// a trailing space, and "Nume și prenume" uses U+0219 which someone may retype
// as U+015F. Match on a diacritic-stripped lowercased substring instead.
function findValue(row, needle) {
  const keys = Object.keys(row);
  for (const key of keys) {
    // \u0300-\u036f as escapes, not literal combining marks -- literals are
    // invisible in an editor and survive a copy-paste only by luck.
    const flat = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (flat.includes(needle)) return row[key];
  }
  return undefined;
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function buildSyncBatch(rows, floor) {
  const batch = [];
  const malformed = [];

  for (const row of rows || []) {
    const technicianName = text(findValue(row, 'nume'));
    const sigiliuRaw = text(findValue(row, 'sigiliu'));
    if (!technicianName || !sigiliuRaw) continue;

    const sigiliu = normalizeSigiliu(sigiliuRaw);
    if (!SIGILIU_SHAPE.test(sigiliu)) malformed.push(sigiliuRaw);

    const nrCrt = Number(text(findValue(row, 'nr')));
    batch.push({
      nr_crt: Number.isFinite(nrCrt) && text(findValue(row, 'nr')) !== '' ? nrCrt : null,
      technician_name: technicianName,
      service_unit: text(findValue(row, 'unitate')) || null,
      sigiliu_raw: sigiliuRaw,
      sigiliu,
    });
  }

  // Without this, an empty sheet from a Google API hiccup does not merely empty
  // the mirror -- it cascades into deleting every sigiliu-bearing row in
  // validated_numbers, locking out all 476 technicians in one unattended run.
  if (batch.length < floor) {
    throw new Error(
      `Refusing to sync: only ${batch.length} usable rows, floor is ${floor}. ` +
      'Neither technicians nor validated_numbers was modified.'
    );
  }

  return { batch, malformed };
}
// ---8<--- SHARED END ---8<---

module.exports = { buildSyncBatch };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/sync-batch.test.js`

Expected: PASS — `# pass 9`, `# fail 0`. If the parity test fails, copy the `NORMALIZE` region from `lib/sigiliu.js` again rather than retyping it.

- [ ] **Step 5: Run the whole suite**

Run: `node --test tests/`

Expected: PASS — 19 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add lib/sync-batch.js tests/sync-batch.test.js
git commit -m "feat(lib): add sync batch builder with row floor and header tolerance"
```

---

## Task 4: Ingestion workflow rewiring

**Files:**
- Modify: `workflows/ingestion.json`
- Test: `tests/ingestion-workflow.test.js`

**Interfaces:**
- Consumes: `lib/sync-batch.js` SHARED region; tables from Task 1.
- Produces: nodes `Drive: Technicians` → `Get Technicians Sheet` → `Build Sync Batch` → `Sync Technicians`. `Build Sync Batch` emits one item shaped `{ batch, malformed, count }`.

**Prerequisite:** the technicians Google Sheet must already exist in Drive, with the columns of `Tabel tehnicieni pentru Robotel.ods`. You need its file ID and its `gid`.

- [ ] **Step 1: Write the failing test**

Create `tests/ingestion-workflow.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/ingestion.json'), 'utf8'));
const byName = (name) => wf.nodes.find((n) => n.name === name);
const targets = (name) => ((wf.connections[name] || {}).main || [])
  .map((out) => (out || []).map((c) => c.node));

test('the old validated-numbers chain is gone', () => {
  for (const gone of ['Drive: Validated Numbers', 'Get row(s) in sheet', 'Insert or Update Validated Numbers']) {
    assert.strictEqual(byName(gone), undefined, `${gone} should be deleted`);
    assert.strictEqual(wf.connections[gone], undefined, `${gone} should have no connections`);
  }
  const json = JSON.stringify(wf);
  assert.ok(!json.includes('Insert or Update Validated Numbers'), 'no dangling references');
});

test('the new sync chain exists and is wired in order', () => {
  assert.ok(byName('Drive: Technicians'));
  assert.ok(byName('Get Technicians Sheet'));
  assert.ok(byName('Build Sync Batch'));
  assert.ok(byName('Sync Technicians'));

  assert.deepStrictEqual(targets('Drive: Technicians'), [['Get Technicians Sheet']]);
  assert.deepStrictEqual(targets('Get Technicians Sheet'), [['Build Sync Batch']]);
  assert.deepStrictEqual(targets('Build Sync Batch'), [['Sync Technicians']]);
});

test('the Drive trigger points at a real configured file', () => {
  const id = byName('Drive: Technicians').parameters.fileToWatch.value;
  assert.match(id, /^[A-Za-z0-9_-]{20,}$/, 'a real Drive file ID must be filled in');
});

test('Sync Technicians retries and is parameterised, not interpolated', () => {
  const node = byName('Sync Technicians');
  assert.strictEqual(node.retryOnFail, true);
  const q = node.parameters.query;
  assert.ok(q.includes('$1::jsonb'), 'payload must ride in a bind parameter');
  assert.ok(q.includes('DELETE FROM technicians'));
  assert.ok(q.includes('sigiliu IS NOT NULL'), 'NULL-sigiliu rows must survive cleanup');
  assert.ok(/NOT EXISTS \(SELECT 1 FROM canon/.test(q), 'cleanup compares against canon, not technicians');
  assert.ok(q.includes('DISTINCT ON (sigiliu)'), 'MA 050 needs a deterministic tie-break');
});

test('Build Sync Batch embeds lib/sync-batch.js verbatim', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/sync-batch.js'), 'utf8');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  assert.ok(start !== -1 && end > start, 'SHARED markers missing');
  const shared = src.slice(start, end);
  assert.ok(byName('Build Sync Batch').parameters.jsCode.includes(shared),
    'Code node has drifted from lib/sync-batch.js');
});

test('the floor is set to 100', () => {
  assert.match(byName('Build Sync Batch').parameters.jsCode, /buildSyncBatch\(rows,\s*100\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ingestion-workflow.test.js`

Expected: FAIL — the first test fails because `Drive: Validated Numbers` still exists.

- [ ] **Step 3: Get the Google Sheet's file ID and gid**

Open the technicians sheet in Drive. From a URL like
`https://docs.google.com/spreadsheets/d/1AbC.../edit#gid=123456789`, the file ID is the segment after `/d/` and the gid is the number after `gid=`. Keep both — the next step needs them.

- [ ] **Step 4: Apply the JSON surgery**

Save this as `splice-ingestion.js` in the repo root, replacing `PUT_FILE_ID_HERE` and `PUT_GID_HERE` with the two values from Step 3:

```js
'use strict';
const fs = require('fs');
const path = require('path');

const FILE_ID = 'PUT_FILE_ID_HERE';
const GID = 'PUT_GID_HERE';

const wfPath = path.join(__dirname, 'workflows/ingestion.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

const DOOMED = ['Drive: Validated Numbers', 'Get row(s) in sheet', 'Insert or Update Validated Numbers'];
wf.nodes = wf.nodes.filter((n) => !DOOMED.includes(n.name));
for (const name of DOOMED) delete wf.connections[name];

const libSrc = fs.readFileSync(path.join(__dirname, 'lib/sync-batch.js'), 'utf8');
const shared = libSrc.slice(
  libSrc.indexOf('// ---8<--- SHARED START ---8<---'),
  libSrc.indexOf('// ---8<--- SHARED END ---8<---')
);

const jsCode = shared + `
// ---- n8n glue ----
const rows = $input.all().map((item) => item.json);
const { batch, malformed } = buildSyncBatch(rows, 100);
return [{ json: { batch, malformed, count: batch.length } }];
`;

const query = `WITH input AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS t(
    nr_crt int, technician_name text, service_unit text,
    sigiliu_raw text, sigiliu text)
),
canon AS (
  SELECT DISTINCT ON (sigiliu) sigiliu, nr_crt, technician_name, service_unit
  FROM input ORDER BY sigiliu, nr_crt
),
wiped AS (DELETE FROM technicians RETURNING 1),
inserted AS (
  INSERT INTO technicians (nr_crt, technician_name, service_unit, sigiliu_raw, sigiliu)
  SELECT nr_crt, technician_name, service_unit, sigiliu_raw, sigiliu FROM input
  RETURNING 1
),
orphaned AS (
  DELETE FROM validated_numbers v
  WHERE v.sigiliu IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM canon c WHERE c.sigiliu = v.sigiliu)
  RETURNING 1
),
refreshed AS (
  UPDATE validated_numbers v
     SET nr_crt = c.nr_crt, technician_name = c.technician_name,
         service_unit = c.service_unit, updated_at = now()
    FROM canon c
   WHERE v.sigiliu = c.sigiliu
     AND (v.technician_name IS DISTINCT FROM c.technician_name
       OR v.service_unit    IS DISTINCT FROM c.service_unit
       OR v.nr_crt          IS DISTINCT FROM c.nr_crt)
  RETURNING 1
)
SELECT (SELECT count(*) FROM wiped)     AS mirror_deleted,
       (SELECT count(*) FROM inserted)  AS mirror_inserted,
       (SELECT count(*) FROM orphaned)  AS validated_deleted,
       (SELECT count(*) FROM refreshed) AS validated_refreshed;`;

wf.nodes.push(
  {
    parameters: {
      pollTimes: { item: [{}] },
      triggerOn: 'specificFile',
      fileToWatch: { __rl: true, value: FILE_ID, mode: 'id' },
    },
    type: 'n8n-nodes-base.googleDriveTrigger',
    typeVersion: 1,
    position: [2528, -640],
    id: 'a1b2c3d4-0001-4000-8000-000000000101',
    name: 'Drive: Technicians',
    credentials: { googleDriveOAuth2Api: { id: 'WuE5ur27KVvphmjl', name: 'Google Drive account' } },
  },
  {
    parameters: {
      documentId: { __rl: true, value: FILE_ID, mode: 'id' },
      sheetName: { __rl: true, value: String(GID), mode: 'id' },
      options: {},
    },
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.7,
    position: [2752, -640],
    id: 'a1b2c3d4-0002-4000-8000-000000000102',
    name: 'Get Technicians Sheet',
    retryOnFail: true,
    credentials: { googleSheetsOAuth2Api: { id: '8vyImy139bSesEaX', name: 'Google Sheets account' } },
  },
  {
    parameters: { jsCode },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2976, -640],
    id: 'a1b2c3d4-0003-4000-8000-000000000103',
    name: 'Build Sync Batch',
  },
  {
    parameters: {
      operation: 'executeQuery',
      query,
      options: { queryReplacement: '={{ [JSON.stringify($json.batch)] }}' },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [3200, -640],
    id: 'a1b2c3d4-0004-4000-8000-000000000104',
    name: 'Sync Technicians',
    retryOnFail: true,
    credentials: { postgres: { id: 'Rlo7S13CLihXk7eq', name: 'Postgres account' } },
  }
);

wf.connections['Drive: Technicians'] = { main: [[{ node: 'Get Technicians Sheet', type: 'main', index: 0 }]] };
wf.connections['Get Technicians Sheet'] = { main: [[{ node: 'Build Sync Batch', type: 'main', index: 0 }]] };
wf.connections['Build Sync Batch'] = { main: [[{ node: 'Sync Technicians', type: 'main', index: 0 }]] };

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n');
console.log('ingestion.json rewired');
```

Then run it and delete it:

```bash
node splice-ingestion.js && rm splice-ingestion.js
```

Expected output: `ingestion.json rewired`.

**Check the Google Sheets credential ID.** The script uses `8vyImy139bSesEaX`, read off the existing
sheets node. Confirm it still matches before running — an earlier draft of this plan carried a wrong
ID, and this command is what caught it:

```bash
node -e "const w=require('./workflows/ingestion.json');console.log(JSON.stringify(w.nodes.filter(n=>n.type==='n8n-nodes-base.googleSheets').map(n=>n.credentials),null,1))"
```

If it differs, use the ID that command prints.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/ingestion-workflow.test.js`

Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 6: Import and run once in n8n**

Import `workflows/ingestion.json` into n8n.

**First, open `Get Technicians Sheet` in the n8n UI and re-select the document and the sheet tab from
the dropdowns.** The splice script writes the resource locators as raw IDs, which n8n accepts but
cannot always resolve to a tab; re-picking from the list writes the `cachedResultName` n8n uses to
display and validate them. If the node errors with `The resource you are requesting could not be
found`, this step was skipped.

Then execute `Build Sync Batch` and `Sync Technicians` manually (pin the Drive trigger, or run the
workflow from `Get Technicians Sheet`).

Expected `Sync Technicians` output: `mirror_deleted: 0`, `mirror_inserted: 476`, `validated_deleted: 0`, `validated_refreshed: 0`.

Then confirm in Supabase that the duplicate survived the mirror:

```sql
SELECT sigiliu, count(*) FROM technicians GROUP BY sigiliu HAVING count(*) > 1;
```

Expected: exactly one row — `MA050 | 2`.

Also check `Build Sync Batch`'s `malformed` output. It should be empty for the current sheet; anything listed there is a row to fix in the sheet, not in the code.

- [ ] **Step 7: Commit**

```bash
git add workflows/ingestion.json tests/ingestion-workflow.test.js
git commit -m "feat(ingestion): replace validated-numbers upsert with atomic technicians sync"
```

---

## Task 5: Agent verification flow

**Files:**
- Modify: `workflows/agent.json`
- Test: `tests/agent-workflow.test.js`

**Interfaces:**
- Consumes: `lib/sigiliu.js` SHARED region; tables from Task 1; the mirror populated by Task 4.
- Produces: no downstream consumers — this is the last code task.

- [ ] **Step 1: Write the failing test**

Create `tests/agent-workflow.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { extractSigilii } = require('../lib/sigiliu.js');

const ROOT = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/agent.json'), 'utf8'));
const byName = (name) => wf.nodes.find((n) => n.name === name);
const targets = (name) => ((wf.connections[name] || {}).main || [])
  .map((out) => (out || []).map((c) => c.node));

test('Validate Phone is replaced by a three-way Switch', () => {
  assert.strictEqual(byName('Validate Phone'), undefined);
  const sw = byName('Route Validation');
  assert.ok(sw, 'Route Validation must exist');
  assert.strictEqual(sw.type, 'n8n-nodes-base.switch');
  assert.strictEqual(sw.parameters.rules.values.length, 2, 'two rules plus a fallback');
  assert.strictEqual(sw.parameters.options.fallbackOutput, 'extra');
});

test('the Switch routes active, revoked and unknown separately', () => {
  assert.deepStrictEqual(targets('Route Validation'), [
    ['Route By Message Type'],
    ['Send "Not Validated"'],
    ['Extract Sigiliu'],
  ]);
});

test('Get valid numbers no longer filters on is_active', () => {
  const cols = byName('Get valid numbers').parameters.where.values.map((v) => v.column);
  assert.deepStrictEqual(cols, ['phone_e164'],
    'filtering is_active here would make a revoked row look like no row, and it could re-validate itself');
});

test('the verification branch is wired end to end', () => {
  assert.deepStrictEqual(targets('Extract Sigiliu'), [['Sigiliu Candidates?']]);
  assert.deepStrictEqual(targets('Sigiliu Candidates?'), [['Lookup Sigiliu'], ['Send "Ask Sigiliu"']]);
  assert.deepStrictEqual(targets('Lookup Sigiliu'), [['Sigiliu Found?']]);
  assert.deepStrictEqual(targets('Sigiliu Found?'), [['Insert Validated Number'], ['Send "Ask Sigiliu"']]);
  assert.deepStrictEqual(targets('Insert Validated Number'), [['Send "Validated"']]);
});

test('Extract Sigiliu embeds lib/sigiliu.js verbatim', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/sigiliu.js'), 'utf8');
  const start = src.indexOf('// ---8<--- SHARED START ---8<---');
  const end = src.indexOf('// ---8<--- SHARED END ---8<---');
  assert.ok(start !== -1 && end > start, 'SHARED markers missing');
  assert.ok(byName('Extract Sigiliu').parameters.jsCode.includes(src.slice(start, end)),
    'Code node has drifted from lib/sigiliu.js');
});

test('phone identity is wa_id, matching the lookup', () => {
  const code = byName('Extract Sigiliu').parameters.jsCode;
  assert.ok(code.includes('contacts[0].wa_id') || code.includes("contacts'][0]"),
    'inserting messages[0].from would make the row unfindable by the wa_id lookup');
  const repl = byName('Insert Validated Number').parameters.options.queryReplacement;
  assert.ok(repl.includes("$('Extract Sigiliu')"), 'insert must reuse the extracted phone');
});

test('Lookup Sigiliu tie-breaks deterministically and always emits', () => {
  const node = byName('Lookup Sigiliu');
  assert.strictEqual(node.alwaysOutputData, true, 'a no-match must still emit an item for the IF');
  assert.strictEqual(node.retryOnFail, true);
  assert.ok(node.parameters.query.includes('array_position'), 'first candidate in the message wins');
  assert.ok(/ORDER BY.*nr_crt/s.test(node.parameters.query), 'MA 050 needs a tie-break');
});

test('the insert never resurrects a revoked row', () => {
  const q = byName('Insert Validated Number').parameters.query;
  assert.ok(q.includes('ON CONFLICT (phone_e164) DO UPDATE'));
  assert.ok(!/is_active/.test(q), 'ON CONFLICT must not touch is_active');
});

// SECURITY: this message is sent before the sender is known.
test('the Ask Sigiliu message leaks nothing about the sigiliu', () => {
  const body = byName('Send "Ask Sigiliu"').parameters.textBody;
  assert.deepStrictEqual(extractSigilii(body), [], 'no extractable token may appear pre-auth');
  assert.ok(!/\bXX\b|\b999\b|exemplu|format/i.test(body),
    'no example, placeholder, or format description');
});

test('the confirmation names the technician', () => {
  const body = byName('Send "Validated"').parameters.textBody;
  assert.ok(body.includes('technician_name') && body.includes('service_unit'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/agent-workflow.test.js`

Expected: FAIL — `Validate Phone` still exists and `Route Validation` does not.

- [ ] **Step 3: Apply the JSON surgery**

Save this as `splice-agent.js` in the repo root:

```js
'use strict';
const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, 'workflows/agent.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const byName = (n) => wf.nodes.find((x) => x.name === n);

// 1. Get valid numbers stops filtering is_active, so a revoked row stays visible
//    and cannot fall through to the sigiliu branch and re-validate itself.
const getValid = byName('Get valid numbers');
getValid.parameters.where.values = getValid.parameters.where.values.filter((v) => v.column === 'phone_e164');

// 2. Replace the IF with a three-way Switch.
wf.nodes = wf.nodes.filter((n) => n.name !== 'Validate Phone');
delete wf.connections['Validate Phone'];

const cond = (id, left, op, right) => ({
  id,
  leftValue: left,
  rightValue: right === undefined ? '' : right,
  operator: op,
});

wf.nodes.push({
  parameters: {
    rules: {
      values: [
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
            combinator: 'and',
            conditions: [
              cond('b1000001-0000-4000-8000-000000000001', '={{ $json.phone_e164 }}',
                { type: 'string', operation: 'notEmpty', singleValue: true }),
              cond('b1000001-0000-4000-8000-000000000002', '={{ $json.is_active }}',
                { type: 'boolean', operation: 'true', singleValue: true }),
            ],
          },
          renameOutput: true,
          outputKey: 'active',
        },
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
            combinator: 'and',
            conditions: [
              cond('b1000001-0000-4000-8000-000000000003', '={{ $json.phone_e164 }}',
                { type: 'string', operation: 'notEmpty', singleValue: true }),
            ],
          },
          renameOutput: true,
          outputKey: 'revoked',
        },
      ],
    },
    options: { fallbackOutput: 'extra', looseTypeValidation: true, renameFallbackOutput: 'unknown' },
  },
  type: 'n8n-nodes-base.switch',
  typeVersion: 3.2,
  position: [-1248, 768],
  id: 'b1000000-0000-4000-8000-000000000010',
  name: 'Route Validation',
});

// 3. Extraction Code node.
const libSrc = fs.readFileSync(path.join(__dirname, 'lib/sigiliu.js'), 'utf8');
const shared = libSrc.slice(
  libSrc.indexOf('// ---8<--- SHARED START ---8<---'),
  libSrc.indexOf('// ---8<--- SHARED END ---8<---')
);

const jsCode = shared + `
// ---- n8n glue ----
const trigger = $('WhatsApp Trigger').first().json;
const message = (trigger.messages && trigger.messages[0]) || {};
// wa_id, not messages[0].from -- this must match the Get valid numbers lookup,
// or the row we insert is never found again.
const phone = (trigger.contacts && trigger.contacts[0] && trigger.contacts[0].wa_id) || '';
const body = message.type === 'text' && message.text ? message.text.body : '';
const candidates = extractSigilii(body);
return [{ json: { phone_e164: phone, candidates, candidates_csv: candidates.join(',') } }];
`;

const ifNode = (id, name, position, left) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
      combinator: 'and',
      conditions: [{
        id: id + '-c1',
        leftValue: left,
        rightValue: '',
        operator: { type: 'string', operation: 'notEmpty', singleValue: true },
      }],
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.3,
  position,
  id,
  name,
});

const WA_CREDS = { whatsAppApi: { id: 'z3YmE6IQAfoUnDtL', name: 'WhatsApp account' } };
const PG_CREDS = { postgres: { id: 'Rlo7S13CLihXk7eq', name: 'Postgres account' } };
const waSend = (id, name, position, textBody) => ({
  parameters: {
    operation: 'send',
    phoneNumberId: '=1163275810213556',
    recipientPhoneNumber: "={{ $('WhatsApp Trigger').item.json.messages[0].from }}",
    textBody,
    additionalFields: {},
  },
  type: 'n8n-nodes-base.whatsApp',
  typeVersion: 1.1,
  position,
  id,
  name,
  retryOnFail: true,
  credentials: WA_CREDS,
});

wf.nodes.push(
  {
    parameters: { jsCode },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1024, 1040],
    id: 'b1000000-0000-4000-8000-000000000011',
    name: 'Extract Sigiliu',
  },
  ifNode('b1000000-0000-4000-8000-000000000012', 'Sigiliu Candidates?', [-800, 1040], '={{ $json.candidates_csv }}'),
  {
    parameters: {
      operation: 'executeQuery',
      query: `SELECT nr_crt, technician_name, service_unit, sigiliu
FROM technicians
WHERE sigiliu = ANY(string_to_array($1, ','))
ORDER BY array_position(string_to_array($1, ','), sigiliu), nr_crt
LIMIT 1;`,
      options: { queryReplacement: '={{ [$json.candidates_csv] }}' },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [-576, 1040],
    id: 'b1000000-0000-4000-8000-000000000013',
    name: 'Lookup Sigiliu',
    alwaysOutputData: true,
    retryOnFail: true,
    credentials: PG_CREDS,
  },
  ifNode('b1000000-0000-4000-8000-000000000014', 'Sigiliu Found?', [-352, 1040], '={{ $json.technician_name }}'),
  {
    parameters: {
      operation: 'executeQuery',
      query: `INSERT INTO validated_numbers (phone_e164, sigiliu, nr_crt, technician_name, service_unit)
VALUES ($1, $2, $3::int, $4, $5)
ON CONFLICT (phone_e164) DO UPDATE
  SET sigiliu = EXCLUDED.sigiliu,
      nr_crt = EXCLUDED.nr_crt,
      technician_name = EXCLUDED.technician_name,
      service_unit = EXCLUDED.service_unit,
      updated_at = now()
RETURNING technician_name, service_unit;`,
      options: {
        queryReplacement:
          "={{ [$('Extract Sigiliu').first().json.phone_e164, $json.sigiliu, $json.nr_crt, $json.technician_name, $json.service_unit] }}",
      },
    },
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [-128, 1040],
    id: 'b1000000-0000-4000-8000-000000000015',
    name: 'Insert Validated Number',
    retryOnFail: true,
    credentials: PG_CREDS,
  },
  waSend('b1000000-0000-4000-8000-000000000016', 'Send "Validated"', [96, 1040],
    '=Numar validat. Bun venit, {{ $json.technician_name }} ({{ $json.service_unit }}). Cu ce te pot ajuta?'),
  waSend('b1000000-0000-4000-8000-000000000017', 'Send "Ask Sigiliu"', [-576, 1232],
    '=Salut! Pentru a folosi acest asistent, te rog trimite-mi sigiliul tau de identificare. Daca nu il ai, contacteaza Partner.')
);

const to = (name) => [{ node: name, type: 'main', index: 0 }];
wf.connections['Get valid numbers'] = { main: [to('Route Validation')] };
wf.connections['Route Validation'] = {
  main: [to('Route By Message Type'), to('Send "Not Validated"'), to('Extract Sigiliu')],
};
wf.connections['Extract Sigiliu'] = { main: [to('Sigiliu Candidates?')] };
wf.connections['Sigiliu Candidates?'] = { main: [to('Lookup Sigiliu'), to('Send "Ask Sigiliu"')] };
wf.connections['Lookup Sigiliu'] = { main: [to('Sigiliu Found?')] };
wf.connections['Sigiliu Found?'] = { main: [to('Insert Validated Number'), to('Send "Ask Sigiliu"')] };
wf.connections['Insert Validated Number'] = { main: [to('Send "Validated"')] };

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n');
console.log('agent.json rewired');
```

Then run it and delete it:

```bash
node splice-agent.js && rm splice-agent.js
```

Expected output: `agent.json rewired`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/agent-workflow.test.js`

Expected: PASS — `# pass 10`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

Run: `node --test tests/`

Expected: PASS — 35 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add workflows/agent.json tests/agent-workflow.test.js
git commit -m "feat(agent): add sigiliu self-service validation branch"
```

---

## Task 6: End-to-end verification

**Files:** none modified. This task is the spec's verification section, executed against the live system.

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: a pass/fail record. Any failure sends you back to the owning task.

Import both workflows into n8n and activate them before starting. You need at least three WhatsApp numbers that are *not* in `validated_numbers`; reset one between checks with
`DELETE FROM validated_numbers WHERE phone_e164 = '<number>';`.

- [ ] **Step 1: Confirm the seed state**

```sql
SELECT count(*) AS mirror_rows FROM technicians;
SELECT count(*) AS validated_rows FROM validated_numbers;
```

Expected: `mirror_rows = 476`, `validated_rows = 0`.

- [ ] **Step 2: Prompt on unknown number, and confirm the prompt leaks nothing**

From an unvalidated number, send `buna ziua`.

Expected: the Ask Sigiliu message, and no new row in `validated_numbers`. The automated half of this check already ran in Task 5; this confirms the deployed copy matches.

- [ ] **Step 3: Happy path**

From the same number, send `PN 002`.

Expected reply: `Numar validat. Bun venit, PETRISOR MIHAI CRISTIAN (PARTNER CORPORATION SRL). Cu ce te pot ajuta?`

```sql
SELECT phone_e164, sigiliu, technician_name, service_unit FROM validated_numbers;
```

Expected: one row, `sigiliu = 'PN002'`, and `phone_e164` matching the sender's `wa_id`.

- [ ] **Step 4: Normalisation both ways**

From a second unvalidated number send `pn-002`. Expect validation as the same technician — one sigiliu, two phones, both rows present.

From a third, send `WR 001`. Expect validation as GIURGIU HODIS LUIGI DANIEL. This is the important one: it proves the sheet's malformed `WR001` matches correctly-typed input.

- [ ] **Step 5: False-positive guard**

Reset a number, then send `am comanda AB1234 in lucru`, and then `am asteptat de 5 zile`.

Expected: the Ask Sigiliu prompt both times, and **no row inserted** either time. The second is the security case — `DE 005` exists, so a match here means the digit rule was loosened somewhere.

- [ ] **Step 6: Bundled question**

Reset a number, then send `salut, PN 002, cum resetez casa de marcat?`.

Expected: the confirmation only. The question must **not** be answered.

- [ ] **Step 7: Non-text**

Reset a number, then send an image.

Expected: the Ask Sigiliu prompt.

- [ ] **Step 8: Normal flow intact**

From a now-validated number, ask a real support question.

Expected: a normal agent answer. Then:

```sql
SELECT message FROM n8n_chat_histories WHERE phone_e164 = '<number>' ORDER BY id;
```

Expected: the support question and its answer, with **no** trace of the sigiliu exchange.

- [ ] **Step 9: Kill switch**

```sql
UPDATE validated_numbers SET is_active = false WHERE phone_e164 = '<number>';
```

Send any message. Expected: the "nu a fost validat" message. Then send `PN 002` again.

Expected: still the "nu a fost validat" message, and `is_active` still false. If the number re-validates, the `Get valid numbers` change or the `ON CONFLICT` clause is wrong.

```sql
UPDATE validated_numbers SET is_active = true WHERE phone_e164 = '<number>';
```

- [ ] **Step 10: Orphan cleanup and the NULL escape hatch**

Insert a hand-granted row, delete a validated technician's row from the Google Sheet, then re-run the ingestion workflow.

```sql
INSERT INTO validated_numbers (phone_e164, notes) VALUES ('40700000001', 'manual grant');
```

Expected after the sync: `validated_deleted = 1`, the removed technician's row gone from `validated_numbers`, and `40700000001` still present. Restore the sheet row and re-sync afterwards.

- [ ] **Step 11: Snapshot refresh**

Rename a validated technician in the sheet, re-run the ingestion workflow.

Expected: `validated_refreshed = 1` and the new name on their `validated_numbers` row.

- [ ] **Step 12: Floor guard**

In n8n, edit `Build Sync Batch` and change `buildSyncBatch(rows, 100)` to `buildSyncBatch(rows, 600)`. Record both table counts, then run the workflow.

Expected: the execution fails at `Build Sync Batch` with `Refusing to sync: only 476 usable rows, floor is 600`, the ingestion error workflow fires, and **both table counts are unchanged**. Verify by re-running the Step 1 counts, not by inspection.

Restore the floor to 100 and confirm `node --test tests/ingestion-workflow.test.js` still passes.

- [ ] **Step 13: AI_Whisper regression**

```sql
UPDATE validated_numbers SET ai_whisperer = true WHERE phone_e164 = '<number>';
```

Run the `AI_Whisper` query from `agent.json` and confirm it still executes and returns rows for that number's reactions.

- [ ] **Step 14: Commit the verification record**

Append a short pass/fail list for Steps 1–13 to the plan file under a `## Verification Results` heading, then:

```bash
git add docs/superpowers/plans/2026-08-14-sigiliu-validation.md
git commit -m "docs: record sigiliu validation verification results"
```
