# AI Materials and Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admins and technicians read and adjust shared material stock and read, create, and edit authorized personal/shared calendar events through AI.

**Architecture:** Add atomic domain RPCs for stock adjustments and calendar mutations, expose role-filtered datasets to AI, then register both domains in the typed dispatcher and workflow. Database authorization remains the final boundary for UI and AI alike.

**Tech Stack:** PostgreSQL/Supabase RPC and RLS, PL/pgSQL, n8n workflow JSON, vanilla JavaScript UI, Node.js tests.

**Spec:** `docs/superpowers/specs/2026-09-10-ai-administration-financial-history-design.md`

**Execution prerequisite:** `psql`, a disposable Supabase-compatible PostgreSQL test database, a non-production n8n instance, and the repository-required `node` command must be available. The current planning environment does not expose `node`, so executors must satisfy this before running workflow/UI tests or the schema runner.

## Global Constraints

- Admin and Technician can read stock and adjust quantities inside their laboratory.
- Stock supports `set`, `add`, and `subtract`; all changes are atomic and quantities never become negative.
- Technicians can read and edit shared events, including events created by colleagues.
- Technicians can read and edit only their own personal events.
- A technician cannot change event ownership or convert another user's personal event into a shared event.
- Dates use the laboratory timezone; use `Europe/Bucharest` until an organization timezone field exists.
- This plan consumes the typed dispatcher from `2026-09-10-ai-admin-operations.md`.

---

### Task 1: Atomic material adjustments

**Files:**
- Create: `db/schema/20_functions/adjust_material_quantity.sql`
- Modify: `db/schema/20_functions/update_material_quantity.sql`
- Create: `tests/sql/material_adjustments.sql`
- Modify: `db/schema/40_grants.sql`
- Regenerate: `db/schema/apply.sql`

**Interfaces:**
- Produces: `adjust_material_quantity(p_lab uuid, p_material_id bigint, p_mode text, p_value numeric, p_expected_quantity numeric default null, p_request_key text default null) returns jsonb` with `material_id`, `old_quantity`, `new_quantity`, `unit`, `request_key`.

- [ ] **Step 1: Write failing role, arithmetic, and concurrency tests**

Authenticate as Admin and Technician in turn. Assert `set 20`, `add 5`, and `subtract 3` return 20, 25, and 22. Assert subtracting 23 rolls back, another lab's material is invisible, an unknown mode fails, and two concurrent `add 1` calls produce +2 rather than a lost update. Assert a stale `p_expected_quantity` rejects absolute `set`, and repeating a request key applies once.

- [ ] **Step 2: Run tests and confirm the function is missing**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/material_adjustments.sql`

Expected: non-zero exit with `function adjust_material_quantity ... does not exist`.

- [ ] **Step 3: Implement a row-locked adjustment**

Require effective role Admin, Manager, or Technician. Select the material `for update` scoped to `p_lab`; compute the new numeric(14,3) value according to mode; reject negative values; and update quantity, timestamps, and author in one statement. For `set`, compare the optional expected value after locking. Reuse the AI request ledger when `p_request_key` is present. Make `update_material_quantity` call mode `set` so existing UI behavior stays compatible.

- [ ] **Step 4: Run tests and commit**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/material_adjustments.sql && node tools/build-db-apply.js --check`

```bash
git add db/schema tests/sql/material_adjustments.sql
git commit -m "feat(db): add atomic material stock adjustments"
```

### Task 2: Shared and personal calendar mutation boundary

**Files:**
- Create: `db/schema/20_functions/mutate_calendar_event.sql`
- Modify: `db/schema/30_policies/07_lab_calendar_events.sql`
- Create: `tests/sql/calendar_permissions.sql`
- Modify: `db/schema/40_grants.sql`
- Regenerate: `db/schema/apply.sql`

**Interfaces:**
- Produces: `mutate_calendar_event(p_action text, p_event_id bigint default null, p_fields jsonb default '{}', p_request_key text default null) returns jsonb` with saved event fields.

- [ ] **Step 1: Write the failing calendar permission matrix**

Create Admin, Technician A, and Technician B. Assert both technicians read shared events; Technician B can update Technician A's shared title/date/description; Technician B cannot update/delete Technician A's personal event, change a shared event's owner, or expose another personal event; each technician can create/edit their personal and shared events; Admin can manage all shared events. Assert title/date/scope validation, end-before-start rejection, cross-lab isolation, and idempotent creation.

- [ ] **Step 2: Run the test and confirm colleague shared edits fail**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/calendar_permissions.sql`

Expected: non-zero exit because current RLS permits colleague shared updates only to management.

- [ ] **Step 3: Implement the role-safe calendar RPC**

Derive lab and `auth.uid()` internally. Require title and start date on create, constrain scope to `personal|shared`, validate date order, and force personal owner to caller. On update, load the row `for update`; permit technicians to edit shared content fields while preserving owner/scope, and permit personal edits only for owner. Use the request ledger for create retries. Return stored values after mutation.

- [ ] **Step 4: Align RLS with the RPC contract**

Change update policy so active technicians can update rows with `calendar_scope='shared'`, while `with check` preserves the same lab, owner, and shared scope. Keep personal reads/updates owner-only and existing delete restrictions. Test both direct PostgREST-style updates and the RPC, since the browser accesses Supabase directly.

- [ ] **Step 5: Run tests and commit**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/calendar_permissions.sql && node tools/build-db-apply.js --check`

```bash
git add db/schema tests/sql/calendar_permissions.sql
git commit -m "feat(db): let technicians edit shared calendar events"
```

### Task 3: Role-filtered AI datasets

**Files:**
- Modify: `db/schema/20_functions/get_ai_bootstrap.sql`
- Modify: `db/schema/20_functions/ai_read_dataset.sql`
- Modify: `db/schema/20_functions/ai_read_datasets.sql`
- Create: `db/schema/20_functions/ai_read_materials.sql`
- Create: `db/schema/20_functions/ai_read_calendar.sql`
- Create: `tests/sql/ai_material_calendar_reads.sql`

**Interfaces:**
- Produces datasets `materials_inventory` and `calendar_events` for Admin/Manager/Technician.
- Produces: `ai_read_materials() returns jsonb` and `ai_read_calendar(p_from date, p_to date) returns jsonb`.

- [ ] **Step 1: Write failing dataset visibility tests**

Assert a technician bootstrap catalog includes materials and calendar. Assert material results contain current-lab stock fields but no unrelated configuration. Assert calendar results contain shared plus caller-owned personal events and omit other personal events. Assert Admin receives all current-lab calendar rows, and Doctor/Dashboard AI availability remains unchanged.

- [ ] **Step 2: Run tests and confirm technician catalog entries are absent**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_material_calendar_reads.sql`

Expected: non-zero exit because technician bootstrap currently lists only work orders, receivables, and work types.

- [ ] **Step 3: Implement dedicated SECURITY DEFINER readers**

Check effective role and active membership inside each function, scope by `get_flowrise_lab_id()`, and explicitly select allowed columns. Calendar reads apply shared-or-owner filtering for technicians and accept a bounded 366-day range. Register only these role-safe functions in the dataset multiplexer; do not expose a raw arbitrary dataset name path to technicians.

- [ ] **Step 4: Run tests and commit**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_material_calendar_reads.sql && node tools/build-db-apply.js --check`

```bash
git add db/schema tests/sql/ai_material_calendar_reads.sql
git commit -m "feat(db): expose role-safe material and calendar AI data"
```

### Task 4: Register material/calendar AI operations and workflow routes

**Files:**
- Modify: `db/schema/20_functions/ai_execute_operation.sql`
- Modify: `db/schema/20_functions/ai_preview_operation.sql`
- Modify: `workflows/Flowrise Dental - AI Client V17.4.json`
- Create: `tests/sql/ai_material_calendar_operations.sql`
- Create: `tests/workflows/ai-material-calendar-routing.test.js`

**Interfaces:**
- Produces operations `material.set|add|subtract` and `calendar_event.create|update` for Admin/Manager/Technician; `calendar_event.delete` retains the role policy from Task 2.

- [ ] **Step 1: Write failing Romanian routing and end-to-end SQL tests**

Cover `setează gipsul la 20 kg`, `adaugă 5 kg la gips`, `scade 2 kg`, `pune mâine la 10 o ședință în calendarul comun`, and editing a colleague's shared event. Assert ambiguous material names and missing personal/shared scope clarify before mutation. Assert `mâine` resolves using Europe/Bucharest and that unit mismatch, negative stock, another personal calendar, and cross-lab targets are rejected server-side.

- [ ] **Step 2: Run tests and confirm operations are unsupported**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_material_calendar_operations.sql && node --test tests/workflows/ai-material-calendar-routing.test.js`

Expected: failures for unsupported material/calendar operation entities.

- [ ] **Step 3: Register dispatcher handlers**

Map material modes to `adjust_material_quantity` and calendar actions to `mutate_calendar_event`. Resolve model-provided names to exactly one current-lab ID; return structured ambiguity candidates otherwise. Require previews for changes to more than one material/event and for deletes; single validated create/update operations execute directly with request keys.

- [ ] **Step 4: Extend prompts and workflow result handling**

Add technician rules for stock and authorized calendars while retaining the ban on client prices and colleagues' pay. Include timezone and mandatory calendar scope behavior. Route typed envelopes through the shared preview/execute nodes and render saved quantities/events from committed results.

- [ ] **Step 5: Run tests and commit**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_material_calendar_operations.sql && node --test tests/workflows/ai-material-calendar-routing.test.js tests/workflows/ai-admin-routing.test.js && git diff --check`

```bash
git add db/schema workflows tests
git commit -m "feat(ai): add material and calendar operations"
```

### Task 5: UI permission alignment and full acceptance

**Files:**
- Modify: `website/app/app.js`
- Create: `tests/app/material-calendar-permissions.test.js`
- Create: `tests/acceptance/material-calendar-ai.md`
- Modify: `db/README.md`

**Interfaces:**
- Consumes: material/calendar RPCs and policies from Tasks 1–4.
- Produces: UI controls that expose exactly the same Technician permissions as AI.

- [ ] **Step 1: Write failing UI permission tests**

Assert Technician UI loads material rows, calls `adjust_material_quantity`, shows shared colleague events as editable, keeps other personal events absent, and never sends owner/scope changes for a colleague's shared event. Assert errors preserve the last server-confirmed value.

- [ ] **Step 2: Run the UI test and confirm current restrictions fail**

Run: `node --test tests/app/material-calendar-permissions.test.js`

Expected: failing assertions for shared-event edit controls and atomic adjustment RPC.

- [ ] **Step 3: Align UI calls and optimistic state**

Use RPC responses as the source of displayed stock/event values. Disable save while a request is active, include expected quantity for absolute stock changes, and restore the server-confirmed value on error. Show edit controls on shared events to active technicians without exposing ownership controls.

- [ ] **Step 4: Run automated and manual acceptance**

Run: `for f in tests/sql/material_adjustments.sql tests/sql/calendar_permissions.sql tests/sql/ai_material_calendar_*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done && node --test tests/app/material-calendar-permissions.test.js tests/workflows/ai-material-calendar-routing.test.js tests/workflows/ai-admin-routing.test.js && node tools/build-db-apply.js --check`

In a non-production environment, execute the five Romanian prompts from Task 4 as both Admin and Technician, verify table deltas and forbidden reads, and record request keys/results in `tests/acceptance/material-calendar-ai.md`.

- [ ] **Step 5: Document deployment order and commit**

Document database deployment before UI/workflow import, RLS rollback, n8n import verification, and the Europe/Bucharest assumption.

```bash
git add website/app/app.js tests db/README.md
git commit -m "feat: align material and calendar UI permissions"
```
