# Work-Type Billing Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate frozen partner prices and technician costs per tooth, per arch, or per piece according to an Admin-selected mode on each work type.

**Architecture:** Tooth items remain clinical scope while a canonical billing-unit helper derives financial scope. Work-order price lines freeze one row per billable unit; technician base lines and signed adjustments consume the same quantities, so catalog changes never rewrite saved Work Orders.

**Tech Stack:** PostgreSQL/Supabase SQL, browser JavaScript/HTML/CSS, n8n workflow JSON, Python unittest, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-09-15-work-type-billing-modes-design.md`

## Global Constraints

- Work directly on `flowrisedental-prod`; do not create another worktree.
- Do not add, modify, delete, or commit `.DS_Store` files.
- `billing_mode` accepts exactly `per_tooth`, `per_arch`, and `per_piece`; its database and UI default is `per_tooth`.
- FDI quadrants 1 and 2 are the upper arch; quadrants 3 and 4 are the lower arch.
- `element_count` remains the count of selected teeth; financial quantity is derived separately.
- Partner price and every technician stage use the same billable quantity for a work type, with independent catalog amounts.
- Existing saved prices, assignment costs, adjustments, and payments must not be recalculated from current catalogs.
- Technicians may see a work type's mode but must not receive partner tariffs or mutate work-type configuration.
- The canonical schema and its data migration must be idempotent.

---

### Task 1: Canonical billing units and frozen price lines

**Files:**
- Modify: `db/schema/10_tables/16_lab_work_types.sql`
- Create: `db/schema/10_tables/24a_work_order_price_lines.sql`
- Create: `db/schema/20_functions/derive_billing_units.sql`
- Create: `db/schema/20_functions/work_order_billing_scope.sql`
- Create: `db/schema/20_functions/get_work_order_price_lines.sql`
- Modify: `db/schema/20_functions/estimate_work_order_items.sql`
- Modify: `db/schema/20_functions/replace_work_order_items.sql`
- Modify: `db/schema/20_functions/work_order_item_scope.sql`
- Modify: `db/schema/20_functions/set_work_order_price_snapshot.sql`
- Modify: `db/schema/20_functions/backfill_work_order_financial_history.sql`
- Modify: `db/schema/20_functions/get_work_order_financial_history.sql`
- Modify: `db/schema/20_functions/delete_management_work_order.sql`
- Modify: `db/schema/20_functions/delete_doctor_work_order.sql`
- Create: `db/schema/30_policies/24a_work_order_price_lines.sql`
- Modify: `db/schema/40_grants.sql`
- Modify: `db/schema/apply.sql`
- Create: `tests/sql/billing_modes.sql`
- Create: `tests/sql/test_billing_modes.py`
- Modify: `tests/sql/financial_schema.sql`
- Modify: `tests/sql/work_order_price_snapshots.sql`
- Modify: `tests/sql/financial_backfill.sql`

**Interfaces:**
- Consumes: item JSON objects `{tooth_number: integer, work_type: text}` and mode rows `{work_type: text, billing_mode: text}`.
- Produces: `public.derive_billing_units(p_items jsonb,p_modes jsonb)` returning `work_type text,billing_mode text,billing_scope text,tooth_number integer`; `public.work_order_billing_scope(p_lab uuid,p_order bigint)` returning `work_type text,billing_mode text,quantity numeric`; and `public.get_work_order_price_lines(p_lab uuid,p_order bigint)` returning a role-safe JSON result.
- Produces table: `public.lab_work_order_price_lines` keyed by `(lab_organization_id,work_order_id,work_type,billing_scope)` with frozen `billing_mode`, `contract`, `unit_price`, `line_total`, provenance, and timestamps.

- [ ] **Step 1: Add failing static and runtime contracts.** Add Python assertions that the mode column/default/check, new table, shared helper, price-line authority, access policy, and `apply.sql` includes exist. Add `tests/sql/billing_modes.sql` scenarios asserting `per_tooth` returns three units for three teeth, `per_arch` returns upper only once and both arches twice, `per_piece` returns once across both arches, and mixed modes preserve `element_count` separately. Run `python3 -m unittest tests.sql.test_billing_modes -v` and confirm it fails because the schema and helpers do not exist.
- [ ] **Step 2: Add catalog mode and price-line schema.** Add idempotent `billing_mode text NOT NULL DEFAULT 'per_tooth'` plus a named check constraint to `lab_work_types`. Create the price-line table, indexes, RLS, commercial read policy, and write revokes. Populate missing historical lines from `lab_work_order_items` as `per_tooth` scopes `tooth:<FDI>` using the saved item values; use `ON CONFLICT DO NOTHING` and never consult price catalogs during migration.
- [ ] **Step 3: Implement the shared billing-unit helpers.** Normalize work-type matching case-insensitively; emit one stable scope per tooth, distinct involved arch, or piece. Reject an unknown mode. Aggregate saved lines through `work_order_billing_scope` without consulting current catalog modes.
- [ ] **Step 4: Rewrite price estimation and replacement.** Make estimates use current catalog modes and return line objects containing `work_type`, `billing_mode`, `billing_scope`, `quantity`, `unit_price`, and `subtotal`, while returning clinical `element_count`. Make replacement validate/canonicalize tooth types, snapshot existing financial scope before mutation, retain unchanged price units, reuse an existing frozen tariff/mode for added units of the same saved type, resolve current catalog data only when a type first enters the order, delete absent active price units, aggregate order totals from price lines, audit before/after line arrays, and pass billable scopes to technician adjustment logic.
- [ ] **Step 5: Move price reads, overrides, history, deletion, and backfill to price lines.** Keep clinical item reads free of financial authority; expose saved price lines through the guarded RPC. Apply an explicit whole-order unit-tariff override to every active price line and calculate total from billable units. Include price lines in financial history and AI management reads. Treat price lines as financial history when deciding archival deletion. Backfill only from legacy item snapshots and never from current catalogs.
- [ ] **Step 6: Verify Task 1.** Run the new Python static test, existing SQL static tests, Node SQL-contract tests, and `git diff --check`. If a disposable Postgres/Supabase database is configured, apply the schema and run `tests/sql/billing_modes.sql`; otherwise record that runtime SQL remains deployment validation. Commit the reviewed unit as `feat(db): add work type billing modes`.

### Task 2: Billable technician costs and append-only adjustments

**Files:**
- Modify: `db/schema/10_tables/25_work_order_stage_assignments.sql`
- Modify: `db/schema/20_functions/resolve_work_order_technician_costs.sql`
- Modify: `db/schema/20_functions/adjust_work_order_scope_costs.sql`
- Modify: `db/schema/20_functions/sync_work_order_stage_assignment.sql`
- Modify: `db/schema/20_functions/backfill_work_order_financial_history.sql`
- Modify: `db/schema/20_functions/get_work_order_financial_history.sql`
- Modify: `tests/sql/billing_modes.sql`
- Modify: `tests/sql/test_billing_modes.py`
- Modify: `tests/sql/technician_financial_history.sql`
- Modify: `tests/sql/test_per_tooth_integration.py`

**Interfaces:**
- Consumes: `public.work_order_billing_scope(uuid,bigint)` from Task 1 and billable before/after JSON arrays `{work_type,billing_mode,quantity}` produced by `replace_work_order_items`.
- Produces: assignment cost lines and signed adjustments carrying `billing_mode`, with assignment `quantity` equal to total billable units.

- [ ] **Step 1: Add failing technician-mode tests.** Assert cost resolution multiplies the configured technician/stage cost by the canonical billable quantity; cover one versus two arches, piece across both arches, mixed types, every stage, and an exact missing-cost error. Assert scope edits on another tooth in the same arch produce no adjustment, the first tooth on the other arch produces `+1`, removing the last tooth produces `-1`, and piece remains unchanged while present. Run focused Python/Node contracts and confirm failure because technician code still counts teeth.
- [ ] **Step 2: Freeze mode on technician history.** Add `billing_mode NOT NULL DEFAULT 'per_tooth'` with the same enum check to cost lines and adjustments using idempotent upgrades. Existing rows retain their amounts and become `per_tooth` without catalog lookup.
- [ ] **Step 3: Use canonical quantities for new assignments.** Rewrite `resolve_work_order_technician_costs` to consume `work_order_billing_scope`; include mode in its return and in `sync_work_order_stage_assignment` inserts. Make assignment summary quantity the sum of billable quantities and preserve the current exact missing configuration behavior.
- [ ] **Step 4: Use billable deltas for scope edits.** Compare normalized work type plus billing mode between the before and after scopes, append only nonzero signed deltas, and reuse the assignment's frozen unit cost. Do not update base lines or payments. Keep repeated identical saves idempotent.
- [ ] **Step 5: Expose mode in history and verify Task 2.** Return `billing_mode` with technician base and adjustment lines. Run focused billing tests, all financial-history static tests, all Python SQL tests, and `git diff --check`. Commit the reviewed unit as `feat(db): bill technician costs by work type mode`.

### Task 3: Admin UI, CSV, AI, and deployment artifact

**Files:**
- Modify: `website/app/app.js`
- Modify: `website/app/styles.css` only if the existing grid needs a selector column adjustment
- Modify: `db/schema/20_functions/get_work_order_reference_data.sql`
- Modify: `db/schema/20_functions/admin_bulk_config_import.sql`
- Modify: `db/schema/20_functions/ai_admin_config_operation.sql`
- Modify: `db/schema/20_functions/ai_preview_operation.sql`
- Modify: `db/schema/20_functions/ai_execute_operation.sql`
- Modify: `db/schema/20_functions/ai_technician_work_types.sql`
- Modify: `db/schema/20_functions/get_ai_bootstrap.sql`
- Modify: `db/schema/20_functions/ai_read_dataset.sql`
- Modify: `workflows/Flowrise Dental - AI Client V17.4.json`
- Modify: `tests/app/per-tooth-work-orders.test.js`
- Create: `tests/app/work-type-billing-modes.test.js`
- Modify: `tests/workflows/ai-admin-routing.test.js`
- Modify: `tests/sql/test_billing_modes.py`
- Modify: `db/schema/apply.sql`
- Regenerate: `db/schema/apply.supabase.sql`

**Interfaces:**
- Consumes: `billing_mode` catalog field, estimate/saved price lines from Tasks 1–2, and `get_work_order_price_lines`.
- Produces: explicit Admin selector/CSV/AI controls, mode-neutral financial rendering, technician-visible mode metadata without partner prices, and the deployable SQL Editor bundle.

- [ ] **Step 1: Add failing browser, CSV, and workflow contracts.** Test that create defaults to `per_tooth`; every existing row renders a three-option selector; direct CRUD and CSV carry `Billing_Mode`; unknown import modes fail; price rendering shows `Per dinte`, `Per arcadă`, or `Per piesă` and billable units without assuming one row per tooth; the AI prompt documents the enum/default; and the parser rejects other values. Run focused Node/Python tests and confirm the expected failures.
- [ ] **Step 2: Update Admin configuration and CSV.** Select/map `billing_mode`; add create/edit selectors with Romanian labels; send the field in inserts and updates; add `Billing_Mode` to type export/import; default blank CSV values to `per_tooth`; validate in both browser and `admin_bulk_config_import`; change price/cost column wording from per-element wording to `Tarif` where needed.
- [ ] **Step 3: Update price-line display.** Render billing scope and billable units from estimate/replace/get-price-lines results. Preserve selected-tooth display as clinical count. On an existing Work Order, obtain saved price lines through the guarded RPC rather than recalculating from the current catalog. Keep partner price data hidden from technicians.
- [ ] **Step 4: Update reference data and AI database contracts.** Expose `billing_mode` in work-type reference data, technician work-type reads, and management datasets. Add it to work-type create/update allowlists and validate/store it in `ai_admin_config_operation`; keep work-type mutations Admin-only.
- [ ] **Step 5: Update the active n8n workflow.** Document `{work_type,active?,billing_mode?}` and the exact enum/default in `AI - Build Final Prompt`; validate and normalize the field in `AI - Parse Final`; preserve existing item-only Work Order, material inventory, and calendar behavior.
- [ ] **Step 6: Regenerate and verify the deployment bundle.** Add every new schema/policy/function include in dependency order, run `python3 tools/build-supabase-editor-sql.py`, then run its `--check` mode. Run all Python tests under `tests/sql`, all Node tests under `tests/app`, `tests/sql`, and `tests/workflows`, parse every workflow JSON, run JavaScript syntax checks, search for stale per-element assumptions in affected financial UI, and run `git diff --check`. Commit the reviewed unit as `feat: configure billing mode per work type`.

### Task 4: Cross-layer review and rollout notes

**Files:**
- Modify: files identified by final review only when required for correctness
- Modify: deployment documentation only if the existing instructions would otherwise be incomplete

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: one reviewed deployable change set and an exact Supabase/web/n8n rollout sequence.

- [ ] **Step 1: Run a complete fresh verification.** Re-run all project tests and syntax checks from Task 3, the generated-bundle check, and `git diff --check`; inspect every failure rather than relying on earlier agent reports.
- [ ] **Step 2: Review requirements line by line.** Match each billing mode, history, role, UI, CSV, and AI requirement in the spec to an implementation and test. Dispatch a whole-branch code review and fix every Critical or Important finding with focused regression tests.
- [ ] **Step 3: Prepare rollout guidance.** Record that `db/schema/apply.supabase.sql` runs first, followed by web deployment and replacement/publishing of the included n8n workflow. State that existing rows default/migrate to `per_tooth`, no backfill command is needed beyond schema application, and Admin then changes only exceptional work types.
