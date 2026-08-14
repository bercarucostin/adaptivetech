# Sigiliu-based number validation — design

Date: 2026-08-14
Scope: [workflows/agent.json](../../../workflows/agent.json), [workflows/ingestion.json](../../../workflows/ingestion.json),
and the database schema.

## Context

Today a phone number is validated by being present in `validated_numbers`, a table fed from
`Validated_Numbers.xlsx` in Google Drive. Someone has to add each number by hand before that person
can use the bot.

Partner maintains a Google Sheet of authorised service technicians — 476 of them, in the format of
`Tabel tehnicieni pentru Robotel.ods`:

| Nr. Crt | Nume și prenume tehnician de service | Unitatea de service | Sigiliu de identificare |
|---|---|---|---|
| 1 | PETRISOR MIHAI CRISTIAN | PARTNER CORPORATION SRL | PN 002 |

Each technician holds a *sigiliu de identificare*, formatted `XX 999` — two uppercase letters, a
space, three digits. This replaces manual number entry with self-service: an unknown number sends its
sigiliu, and the bot validates it against the sheet.

Two properties of the source data drive most of the design below, and both were confirmed by reading
the file rather than assumed:

- **`WR001` (row 466) has no space.** The sheet is human-edited and already inconsistent, so
  normalisation has to run on the sheet side too, not just on user input.
- **`MA 050` appears twice** — MATIES ANDRA NICOLETA and PIRVULESCU CORNELIA, at the same unit. Sigiliu
  is therefore not a unique key, and every lookup by sigiliu needs a deterministic tie-break.

The existing `validated_numbers` table is dropped rather than migrated. There is no user-visible
migration concern: this is a fresh start, agreed during design.

### Deliberately out of scope

**Per-number attempt counting and lockout.** Still out, but the original reasoning for it was wrong
and is corrected here, because the corrected version is what justifies the one guard that *is* in
scope.

The first draft argued that `XX999` holds 676,000 combinations for 476 valid values, so a blind guess
lands about 0.07% of the time — "not something you brute-force one WhatsApp message at a time." The
premise was false. Extraction returns *every* candidate token in a message and `Lookup Sigiliu` matches
`sigiliu = ANY(...)`, so a message was never one guess: a 4096-character WhatsApp body packs roughly
680 candidates into a single query, and the reply — confirmation versus prompt — is a clean oracle.
That exhausts the keyspace in about 1,000 messages, not 676,000.

The fix is to remove the amplifier rather than add machinery: **extraction caps a single message at 3
candidates.** A technician sends one code, perhaps a mistyped second; three is generous. The cap
restores the per-message arithmetic the original reasoning assumed, taking exhaustion back to ~225,000
messages, which is a real barrier over WhatsApp. It costs one constant and no new state.

With the amplifier gone, attempt counting and lockout stay out of scope on the original grounds: they
need a new column or table and a reset policy, and no abuse has been observed. That is the posture of
the 2026-08-05 spec, which declined a dedup guard on the same reasoning.

**The 2026-08-05 agent reliability hardening.** Still unimplemented, still its own piece of work. The
one place the two specs interact is called out explicitly below.

## Data model

Two tables replace the single `validated_numbers`. `technicians` mirrors the sheet; `validated_numbers`
is rebuilt from scratch.

```sql
-- Mirror of the Google Sheet. Rebuilt in full on every sync.
create table public.technicians (
  id              bigserial primary key,
  nr_crt          integer,
  technician_name text not null,
  service_unit    text,
  sigiliu_raw     text not null,   -- exactly as it appears in the sheet
  sigiliu         text not null,   -- normalised: uppercase, non-alphanumerics stripped -> 'XX999'
  synced_at       timestamptz not null default now()
);
create index technicians_sigiliu_idx on public.technicians (sigiliu);
```

```sql
-- Replaces the old validated_numbers entirely; the old table is dropped.
create table public.validated_numbers (
  id              bigserial primary key,
  phone_e164      text not null unique,
  sigiliu         text,           -- NULL = manual grant; the sync never deletes these
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

**Neither table has a unique constraint on `sigiliu`.** The mirror cannot have one, because `MA 050`
legitimately appears twice. `validated_numbers` does not have one because one sigiliu may validate
several phone numbers: a technician who changes handset simply validates again, and both rows coexist
until someone removes the old one. The cost of this choice is that a shared or leaked sigiliu grants
access to everyone holding it, with no cap. That was accepted in exchange for no manual intervention
on handset changes.

**`sigiliu` is stored normalised; `sigiliu_raw` preserves the sheet's literal text.** Normalising both
sides is what makes the sheet's `WR001` match a user who correctly types `WR 001`. Keeping the raw
value means the sheet's inconsistency stays visible instead of being silently rewritten.

**Where a lookup by sigiliu could return two mirror rows, the lowest `nr_crt` wins.** Deterministic, so
the same sigiliu always resolves to the same technician.

**`technician_name`, `service_unit` and `nr_crt` on `validated_numbers` are a snapshot taken at
validation time, refreshed by each sync.** They are denormalised copies and would otherwise drift when
someone renames a technician in the sheet, so the sync refreshes them for rows whose sigiliu is still
present.

`business_name` is dropped — `Unitatea de service` supersedes it. `ai_whisperer` and `is_active`
survive, so the `AI_Whisper` query at [agent.json:334](../../../workflows/agent.json) needs no change.

The repo tracks DDL under `db/`, so this adds `db/technicians.sql` and rewrites
`db/validated_numbers.sql` to the definition above. Applying it means
`DROP TABLE public.validated_numbers;` first — there is nothing in it worth keeping.

## Sigiliu extraction

One normalisation rule, applied identically to sheet values and to user input. Divergence between the
two would be a silent matching failure, so this is written once and used in both workflows:

```
normalise(s) = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
```

User input is scanned for candidate tokens with:

```
/(?<![A-Za-z0-9])([A-Za-z]{2})[ ._-]?(\d{3})(?![0-9])/g
```

Two letters, an optional single separator, three digits — but only as a standalone token, never
embedded in a longer alphanumeric run. Matches are normalised, deduplicated, and kept in order of
appearance.

| Message | Candidates | |
|---|---|---|
| `PN 002` | `PN002` | match |
| `pn002` | `PN002` | match |
| `PN-002` | `PN002` | match |
| `Sigiliul meu este PN 002, mersi` | `PN002` | match |
| `WR001` | `WR001` | match |
| `am comanda AB1234 in lucru` | — | no match |
| `sigiliuPN002` | — | no match |
| `va rog ajutor, 12345` | — | no match |

The boundary assertions are what keep `AB1234` from yielding a spurious `AB123`. Rejecting
`sigiliuPN002` is the accepted cost.

## Agent flow

The `Validate Phone` false branch stops being a dead end and becomes the verification path. Everything
from `Route By Message Type` downstream is untouched.

```
Mark Read & Typing
  └─> Get valid numbers          SELECT * FROM validated_numbers WHERE phone_e164 = $wa_id
        └─> Route Validation     (Switch, 3 ways)
              ├─ row + is_active ──> Route By Message Type      (existing flow, unchanged)
              ├─ row + !is_active ─> Send "Not Validated"       (existing node and copy)
              └─ no row ──────────> Extract Sigiliu             (Code)
                                      └─> Sigiliu Candidates?   (IF)
                                            ├─ none ─> Send "Ask Sigiliu"
                                            └─ some ─> Lookup Sigiliu        (Postgres)
                                                        └─> Sigiliu Found?   (IF)
                                                              ├─ no ──> Send "Ask Sigiliu"
                                                              └─ yes ─> Insert Validated Number
                                                                          └─> Send "Validated"
```

`Validate Phone` (an IF) is replaced by `Route Validation` (a Switch). Its three outputs test:
row present and `is_active` true; row present and `is_active` false; no row.

### `Get valid numbers` drops its `is_active` filter

This is the only change to an existing node that is not self-evident, and it exists to protect the
kill switch. The node currently filters `is_active = TRUE`, which makes a revoked row indistinguishable
from no row at all. Under the new flow that equivalence is dangerous: a revoked technician would fall
into the sigiliu branch, send their still-valid sigiliu, and re-validate themselves. Selecting by phone
alone and branching three ways keeps revocation meaningful, and reuses `Send "Not Validated"` with its
existing Romanian copy.

### `Extract Sigiliu`

A Code node. Non-text messages produce zero candidates and fall through to the prompt — an image cannot
be scanned. For text it applies the regex above to `messages[0].text.body` and emits the candidate
list.

The scan runs on **every** message from an unvalidated number, including the first. Nothing records
whether the user has already been prompted, so there is no state to store and no way for it to go
stale; someone who opens with `PN 002` is validated immediately.

### `Lookup Sigiliu`

Resolves all candidates in one query. First candidate in the message wins; `nr_crt` breaks the `MA 050`
tie.

```sql
SELECT nr_crt, technician_name, service_unit, sigiliu
FROM technicians
WHERE sigiliu = ANY($1::text[])
ORDER BY array_position($1::text[], sigiliu), nr_crt
LIMIT 1;
```

Needs `alwaysOutputData: true`, so that a no-match still emits an item for `Sigiliu Found?` to test.

### `Insert Validated Number`

```sql
INSERT INTO validated_numbers
  (phone_e164, sigiliu, nr_crt, technician_name, service_unit)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (phone_e164) DO UPDATE
  SET sigiliu = EXCLUDED.sigiliu, nr_crt = EXCLUDED.nr_crt,
      technician_name = EXCLUDED.technician_name,
      service_unit = EXCLUDED.service_unit, updated_at = now();
```

The conflict clause exists for one case: two messages arriving in quick succession from the same
unknown number, both finding no row, both reaching the insert. It deliberately does **not** set
`is_active`. A revoked number can never reach this node — the Switch routes it to `Send "Not Validated"`
first — so the only conflict it can ever resolve is that race, and leaving `is_active` alone means no
path exists that resurrects a revoked row.

### Insert before confirming

This inverts the rule set by the 2026-08-05 spec, which moved persistence after delivery so that a
database failure costs a memory row rather than the answer. Here the persistence *is* the deliverable.
Sending "numar validat" when the INSERT failed would tell someone they are in when they are not, and
their next message would prompt for the sigiliu again. If the insert fails after retries, the error
workflow's generic message is the correct outcome.

### Messages

Both Romanian.

- **Ask Sigiliu** — `Salut! Pentru a folosi acest asistent, te rog trimite-mi sigiliul tau de
  identificare. Daca nu il ai, contacteaza Partner.`
  Sent on every message from an unvalidated number, so it repeats if they send something else. That
  repetition is what keeps the flow stateless.

  **This message must reveal nothing about the sigiliu — no example, no placeholder, and no
  description of its format.** It is the only thing the bot says *before* knowing who it is talking
  to, so everything in it is handed to an unauthenticated stranger by definition.

  An example is the worst case: `PN 002` is a live credential that would have admitted anyone as
  PETRISOR MIHAI CRISTIAN. A concrete-looking placeholder is barely better — `XX 999` is invalid
  today only by coincidence, since `XX` is a real prefix covering eight technicians, and it becomes a
  working credential the moment someone adds that row to the sheet. Even a prose description of the
  shape ("two letters and three digits") narrows the guess space for someone who does not hold a
  sigiliu at all.

  Legitimate technicians hold their sigiliu physically and can read the format off it, so the message
  costs them nothing. Any future edit to this string is a security change, not a copy change.
- **Validated** — `Numar validat. Bun venit, {technician_name} ({service_unit}). Cu ce te pot ajuta?`

The bot confirms and stops; it does not answer the message that carried the sigiliu. Most messages at
this step are a bare sigiliu with nothing to answer, and feeding `PN 002` to the agent produces a
confused reply. Someone who bundles a question has to repeat it — the accepted cost.

### Chat history

Verification turns are not written to `n8n_chat_histories`. A bare `PN 002` and its confirmation are
not conversation content, and putting them in the model's context window is noise. History begins at
the user's first real question.

## Ingestion sync

Three nodes replace `Drive: Validated Numbers` → `Get row(s) in sheet` →
`Insert or Update Validated Numbers`; all three of those are deleted.

```
Drive: Technicians (googleDriveTrigger, fileUpdated on the new sheet)
  └─> Get Technicians Sheet   (googleSheets, read all rows)
        └─> Build Sync Batch  (Code: normalise, guard, emit one JSON array)
              └─> Sync Technicians (Postgres, one Execute Query)
```

### `Build Sync Batch`

Maps each sheet row to `{nr_crt, technician_name, service_unit, sigiliu_raw, sigiliu}`, applying the
normalisation rule above.

- Rows with an empty name or empty sigiliu are dropped — trailing blank rows.
- Rows whose normalised sigiliu does not match `^[A-Z]{2}\d{3}$` are **kept**, not dropped. The mirror
  mirrors. They are counted and surfaced in the node output so the sheet can be corrected. (`WR001`
  normalises to `WR001` and passes; this catches genuinely malformed values such as `ABC 001`.)
- **It throws if the batch is under 100 rows**, counted *after* the blank-row drop — the guard measures
  what is about to be written, not what was read.

That floor is the one piece of defensive machinery this design insists on. Without it, a Google API
hiccup returning an empty sheet does not merely empty the mirror — it cascades into deleting every
sigiliu-bearing row in `validated_numbers`, locking out all 476 technicians in a single unattended run.
The floor converts that into a failed execution routed to the existing ingestion error workflow. 100 is
a knob; the sheet currently has 476.

### `Sync Technicians`

One statement, one implicit transaction.

```sql
WITH input AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS t(
    nr_crt int, technician_name text, service_unit text,
    sigiliu_raw text, sigiliu text)
),
canon AS (                      -- one row per sigiliu; lowest nr_crt wins (MA 050)
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
       (SELECT count(*) FROM refreshed) AS validated_refreshed;
```

Three things make this correct rather than merely compact.

**The whole payload rides in one `$1::jsonb` parameter.** Multi-statement SQL and bind parameters are
mutually exclusive in the Postgres wire protocol, so a `DELETE; INSERT; DELETE;` script would force
values to be inlined and escaped by hand. With 476 human-typed Romanian names, one apostrophe is an
injection. A single CTE statement keeps parameterisation.

**`orphaned` and `refreshed` both write `validated_numbers`, which is safe only because their row sets
are disjoint** — one takes sigilii absent from `canon`, the other sigilii present in it. Postgres does
not define behaviour when two data-modifying CTEs touch the same row, so this is load-bearing, not
incidental.

**The cleanup compares against `canon`, not `technicians`.** All CTEs read one snapshot, so
`technicians` still holds the *old* rows for the duration of this statement. Comparing against the
incoming batch is both correct and what is actually wanted.

Rows with `sigiliu IS NULL` are never deleted. That is the escape hatch for hand-granted access — a
test number, or an `ai_whisperer` who is not a technician — without putting fake rows into a sheet other
people edit.

### Prerequisites

`Drive: Technicians` needs the new sheet's Drive file ID, so the sheet must exist in Drive before this
ships. The first run is a manual execution to seed the mirror.

## Error handling

`Lookup Sigiliu`, `Insert Validated Number`, `Sync Technicians` and the two new WhatsApp sends all take
`retryOnFail`, matching the posture of the 2026-08-05 spec. `Get valid numbers` already has it.

`Sync Technicians` is safe to retry because it is atomic and idempotent — a retry recomputes the same
end state from the same batch.

## Verification

There is no test framework in this repo, so verification is manual. Each check should fail in the
specific way predicted, not merely "still work".

1. **Seed run.** Manual execution of the ingestion workflow. Expect `mirror_inserted = 476`, and
   `MA 050` present twice in `technicians`.
2. **Prompt on unknown number.** Plain text from a number not in `validated_numbers`. Expect the Ask
   Sigiliu message. Then run the extraction regex over the message text itself and confirm it yields
   **zero** candidates — the prompt is sent pre-authentication, so any token in it is a credential
   handed to a stranger.
3. **Happy path.** Same number sends `PN 002`. Expect a confirmation naming PETRISOR MIHAI CRISTIAN /
   PARTNER CORPORATION SRL, and a row in `validated_numbers`.
4. **Normalisation both ways.** From fresh numbers, `pn-002` and `WR 001`. The second is the important
   one: it proves the sheet's malformed `WR001` matches correctly-typed input.
5. **False-positive guard.** `am comanda AB1234 in lucru` from an unknown number. Expect the prompt and
   *no* inserted row. This guards the most likely regression in the extraction regex.
6. **Bundled question.** `salut, PN 002, cum resetez casa?`. Expect validation and the confirmation
   only — the question must *not* be answered.
7. **Non-text.** An image from an unknown number. Expect the prompt.
8. **Normal flow intact.** The now-validated user's next message gets a normal agent answer, and
   `n8n_chat_histories` holds that question with no trace of the sigiliu exchange.
9. **Kill switch.** Set `is_active = false` on a validated row, send a message. Expect "Not Validated";
   then re-send the sigiliu and confirm it does *not* reactivate. This is what the `Get valid numbers`
   filter change exists for.
10. **Orphan cleanup.** Delete a validated technician's row from the sheet, re-sync. Expect their
    `validated_numbers` row gone, and a hand-inserted `sigiliu IS NULL` row untouched.
11. **Snapshot refresh.** Rename a technician in the sheet, re-sync. Expect `validated_refreshed = 1`
    and the new name on the validated row.
12. **Floor guard.** Temporarily raise the floor in `Build Sync Batch` above 476 and re-sync — this
    tests the guard without editing the shared production sheet. Expect the execution to fail at
    `Build Sync Batch` with *neither* table modified. Verify by row count before and after, not by
    inspection. Restore the floor to 100 afterwards.
13. **`AI_Whisper` regression.** Flag a validated row `ai_whisperer = true` and confirm the query at
    [agent.json:334](../../../workflows/agent.json) still returns rows.
