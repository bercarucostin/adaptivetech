# Per-Tooth Work Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tooth items the sole source of Work Order type, quantity, price, and technician cost while removing general work type and clinical material everywhere.

**Architecture:** Role-safe transactional RPCs write the Work Order, patient case, tooth items, frozen prices, and technician costs in dependency order. Read models aggregate item rows for display, reporting, and AI, and a final schema cleanup deletes unsupported no-item orders before dropping legacy scalar columns.

**Tech Stack:** PostgreSQL/Supabase SQL, browser JavaScript/HTML/CSS, n8n workflow JSON, Node.js static tests.

**Spec:** `docs/superpowers/specs/2026-09-10-per-tooth-work-orders-design.md`

## Global Constraints

- Work directly on `flowrisedental-prod`; the user explicitly declined another worktree.
- Do not add or modify untracked `.DS_Store` files.
- Clinical material is removed; `lab_materials_inventory` and its AI operations remain.
- Every active Work Order has at least one configured tooth with a valid work type.
- Existing no-item Work Orders and their dependent records may be deleted.
- Existing item price snapshots and technician payment history must not be recalculated from current catalogs.

---

### Task 1: Canonical per-tooth database API and cleanup

**Files:**
- Modify: `db/schema/10_tables/11_lab_patient_cases.sql`
- Modify: `db/schema/10_tables/15_lab_work_orders.sql`
- Modify: `db/schema/10_tables/24_work_order_items.sql`
- Modify: `db/schema/20_functions/*.sql` for Work Order create/update/read, patient case, price, cost, and AI operations
- Modify: `db/schema/40_grants.sql`
- Create: `db/schema/60_per_tooth_work_order_cutover.sql`
- Modify: `db/schema/apply.sql`
- Create/modify: `tests/sql/per_tooth_work_orders.sql`, `tests/sql/financial_schema.sql`, and affected SQL tests

**Interfaces:**
- Consumes: item JSON objects `{tooth_number: integer, work_type: text}`.
- Produces: atomic role-safe writers plus read rows containing `items`, `work_types`, `work_type_summary`, and `element_count`.

- [ ] Add failing SQL/static assertions for the item-only invariant, removed columns/parameters, atomic Technician creation, mixed price snapshots, and item-based cost lines; run them and confirm the expected failures.
- [ ] Replace create/update and AI mutation RPC contracts with non-empty item arrays, insert price-snapshotted items before assignments, and derive all summaries from items.
- [ ] Rebuild patient-case and Work Order readers without clinical material or scalar scope fields and remove catalog-based historical fallbacks.
- [ ] Add the ordered cleanup for no-item Work Orders and obsolete overloads, then drop the legacy columns and enforce the active-order item invariant.
- [ ] Update grants and `apply.sql`, then run SQL static tests and any available database integration tests until green.
- [ ] Commit the database unit with message `feat(db): make work orders item based`.

### Task 2: Browser Work Order editor and reporting cutover

**Files:**
- Modify: `website/app/index.html`
- Modify: `website/app/app.js`
- Modify: `website/app/styles.css` only if selectors become obsolete
- Create/modify: `tests/app/per-tooth-work-orders.test.js` and affected app tests

**Interfaces:**
- Consumes: Task 1 item-aware RPCs and aggregate read fields.
- Produces: payloads containing item arrays and clinical tooth JSON without material or scalar type/count.

- [ ] Add failing browser/static tests proving the three general controls and all clinical material paths are absent, Technician can open create mode, and mixed item summaries/counts are derived; run them and confirm the failures.
- [ ] Remove the general controls, material draft fields, material table columns, synchronization checkbox, mismatch UI, and every DOM dependency.
- [ ] Make a pure tooth-item derivation helper validate at least one selected tooth and a work type for every tooth.
- [ ] Route all role create/edit submissions through item-aware RPC payloads and load canonical item rows before editing.
- [ ] Update lists, filters, reports, KPIs, print/PDF, pricing, and technician-cost display to consume derived item summaries and frozen financial data.
- [ ] Run the browser tests and JavaScript syntax checks until green.
- [ ] Commit the browser unit with message `feat(app): use tooth configuration for work orders`.

### Task 3: AI workflow item-only Work Order operations

**Files:**
- Modify: the active n8n workflow JSON under `workflows/`
- Modify: `tests/workflows/ai-admin-routing.test.js`
- Create/modify: `tests/workflows/ai-per-tooth-work-orders.test.js`
- Modify: relevant acceptance documentation under `tests/acceptance/`

**Interfaces:**
- Consumes: Task 1 AI operations requiring `items` for create/scope changes.
- Produces: validated AI payloads with tooth numbers/work types and no general material/type/count fields.

- [ ] Add failing workflow tests for item-aware create/update, missing-tooth rejection, absence of clinical material, and unchanged inventory-material commands; run them and confirm the failures.
- [ ] Update prompts, parsers, allowlists, previews, and execution routing to use tooth items.
- [ ] Remove singular Work Order type/count/material assumptions from AI responses while retaining work-type catalog and stock-material tools.
- [ ] Run workflow syntax/routing and acceptance checks until green.
- [ ] Commit the workflow unit with message `feat(ai): mutate work orders by tooth`.

### Task 4: Cross-layer verification and deployment instructions

**Files:**
- Modify: `README.md` or deployment documentation only if existing instructions require correction
- Modify: affected tests discovered by the full verification run

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a deployable schema/app/workflow set and exact rollout sequence.

- [ ] Run the schema include/order checker, all Node test files, JSON parsing, JavaScript syntax checks, and `git diff --check`.
- [ ] Search production files for removed clinical fields and classify every remaining `material` or `tip_lucrare` occurrence as inventory/catalog-only.
- [ ] Review the no-item deletion SQL and document the required Supabase schema apply, n8n import/publish, and web deployment order.
- [ ] Commit only necessary fixes or documentation, excluding `.DS_Store` files.
