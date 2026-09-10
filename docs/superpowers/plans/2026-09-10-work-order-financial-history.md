# Work Order Financial History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each work order's sale price, technician assignment cost, and payment history so later catalog changes never rewrite historical amounts.

**Architecture:** Add immutable financial snapshots beside the existing operational work-order fields: sale-price columns on orders/items, one assignment row per technician stage tenure, and an append-only payment ledger. All reads and writes move through SQL functions that resolve catalog values once, preserve existing snapshots, and expose provenance for migrated estimates.

**Tech Stack:** PostgreSQL 15/Supabase, PL/pgSQL, Row Level Security, PostgREST RPC, vanilla JavaScript UI, Node.js schema runner.

**Spec:** `docs/superpowers/specs/2026-09-10-ai-administration-financial-history-design.md`

**Execution prerequisite:** `psql`, a disposable Supabase-compatible PostgreSQL test database, and the repository-required `node` command must be available. The current planning environment does not expose `node`, so executors must satisfy this before running schema-runner or Node test commands.

## Global Constraints

- Existing work orders keep their effective current price at migration; recoverable per-tooth prices take precedence.
- Missing catalog prices remain `NULL`; an explicit zero remains zero.
- Technician cost is fixed when a technician is assigned to a stage.
- Catalog changes never update existing financial snapshots.
- Historic paid flags become migration balances without invented payment dates.
- Admin can explicitly adjust a saved price or assignment amount, and every adjustment records before/after values and author.
- Doctor, dashboard, technician, and cross-organization visibility remain restricted by existing role rules.

---

### Task 1: Canonical financial tables and schema smoke test

**Files:**
- Create: `db/schema/10_tables/24_work_order_items.sql`
- Create: `db/schema/10_tables/25_work_order_stage_assignments.sql`
- Create: `db/schema/10_tables/26_technician_payments.sql`
- Create: `db/schema/10_tables/27_work_order_financial_audit.sql`
- Modify: `db/schema/10_tables/15_lab_work_orders.sql`
- Create: `db/schema/30_policies/24_work_order_items.sql`
- Create: `db/schema/30_policies/25_work_order_stage_assignments.sql`
- Create: `db/schema/30_policies/26_technician_payments.sql`
- Create: `db/schema/30_policies/27_work_order_financial_audit.sql`
- Create: `tests/sql/financial_schema.sql`
- Modify: `db/schema/40_grants.sql`
- Regenerate: `db/schema/apply.sql`

**Interfaces:**
- Produces: `lab_work_orders.snapshot_unit_price numeric(14,2)`, `snapshot_list_price numeric(14,2)`, `snapshot_final_price numeric(14,2)`, `price_source text`, `price_fixed_at timestamptz`, `price_migrated boolean`.
- Produces: `lab_work_order_items(lab_organization_id, work_order_id, tooth_number, work_type, contract, unit_price, quantity, line_total, price_source, price_fixed_at, price_migrated)` with primary key `(lab_organization_id, work_order_id, tooth_number)`.
- Produces: `lab_work_order_stage_assignments(id uuid, lab_organization_id uuid, work_order_id bigint, stage_key text, technician_user_id uuid, technician_name text, unit_cost numeric, quantity numeric, agreed_amount numeric, cost_source text, fixed_at timestamptz, started_at timestamptz, ended_at timestamptz, migrated boolean)`.
- Produces: `technician_payments(id uuid, assignment_id uuid, amount numeric, currency text, paid_on date, recorded_at timestamptz, recorded_by_user_id uuid, request_key text, reversal_of uuid, migration_balance boolean)`.
- Produces: `work_order_financial_audit(id uuid, lab_organization_id uuid, work_order_id bigint, entity_type text, entity_id text, action text, before_value jsonb, after_value jsonb, changed_at timestamptz, changed_by_user_id uuid)`.

- [ ] **Step 1: Write the failing schema test**

```sql
begin;
select snapshot_unit_price, snapshot_final_price, price_source, price_migrated
from public.lab_work_orders limit 0;
select id, stage_key, technician_name, agreed_amount, ended_at
from public.lab_work_order_stage_assignments limit 0;
select id, assignment_id, amount, paid_on, reversal_of, migration_balance
from public.technician_payments limit 0;
select before_value, after_value from public.work_order_financial_audit limit 0;
rollback;
```

- [ ] **Step 2: Run the test and confirm the first missing relation/column fails**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/financial_schema.sql`

Expected: non-zero exit with `column "snapshot_unit_price" does not exist` or `relation ... does not exist`.

- [ ] **Step 3: Define tables, constraints, indexes, and RLS**

Use `gen_random_uuid()` for ledger identifiers; constrain stages to `model`, `modelare`, `cer_fin`; constrain money and quantity to nonnegative values; constrain `reversal_of` to a prior payment; enforce one active assignment with a partial unique index on `(lab_organization_id, work_order_id, stage_key) where ended_at is null`; and make `request_key` unique per laboratory for retry safety. Management may read financial audit and all payments; technicians may read assignments/payments matching `auth.uid()` only. Revoke direct insert/update/delete on assignment, payment, and audit tables from `authenticated`; mutations occur through later SECURITY DEFINER functions.

- [ ] **Step 4: Regenerate and apply the canonical schema**

Run: `node tools/build-db-apply.js && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/apply.sql`

Expected: `wrote apply.sql` followed by `COMMIT`.

- [ ] **Step 5: Run the schema test**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/financial_schema.sql && node tools/build-db-apply.js --check`

Expected: exit 0 and `apply.sql is up to date`.

- [ ] **Step 6: Commit**

```bash
git add db/schema tests/sql/financial_schema.sql
git commit -m "feat(db): add work order financial history schema"
```

### Task 2: Snapshot price resolution and creation paths

**Files:**
- Create: `db/schema/20_functions/resolve_work_order_price_snapshot.sql`
- Create: `db/schema/20_functions/set_work_order_price_snapshot.sql`
- Modify: `db/schema/20_functions/create_work_order.sql`
- Modify: `db/schema/20_functions/create_technician_work_order.sql`
- Modify: `db/schema/20_functions/replace_work_order_items.sql`
- Modify: `db/schema/20_functions/update_management_work_order.sql`
- Modify: `db/schema/20_functions/update_doctor_work_order.sql`
- Create: `tests/sql/work_order_price_snapshots.sql`
- Regenerate: `db/schema/apply.sql`

**Interfaces:**
- Consumes: sale-price columns and `lab_work_order_items` from Task 1.
- Produces: `resolve_work_order_price_snapshot(p_lab uuid, p_partner text, p_contract text, p_work_type text, p_quantity numeric, p_discount numeric) returns jsonb` with `unit_price`, `list_price`, `final_price`, `matched_contract`, `price_source`.
- Produces: `set_work_order_price_snapshot(p_lab uuid, p_work_order_id bigint, p_unit_price numeric, p_discount numeric, p_reason text) returns jsonb`, management-only and audited.

- [ ] **Step 1: Add a failing transactional test for frozen prices**

Create fixtures inside `begin` for one organization, one active work type, and a General tariff of 100. Set authenticated admin JWT claims and membership using the project's existing auth fixture pattern. Call `create_work_order`, assert `snapshot_unit_price = 100` and `snapshot_final_price = 200` for quantity 2; change the catalog tariff to 150; assert the same order remains 100/200; create a second order and assert 150/300. Assert a missing tariff produces `NULL`, while a catalog tariff of zero produces zero. End with `rollback`.

- [ ] **Step 2: Run the price test and confirm snapshot assertions fail**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/work_order_price_snapshots.sql`

Expected: non-zero exit because creation does not populate the snapshot columns.

- [ ] **Step 3: Implement one-time price resolution in all creation paths**

`resolve_work_order_price_snapshot` must reproduce the current precedence: exact contract, partner, then General. `create_work_order` and `create_technician_work_order` call it after validation and write the returned values in the same transaction. Existing signatures remain compatible. The technician response must not expose sale prices.

- [ ] **Step 4: Preserve per-tooth rows and require explicit repricing**

Change `replace_work_order_items` to retain the snapshot for an unchanged `(tooth_number, work_type)` row, price only new/changed rows from the current catalog, then set order totals from saved lines. `update_management_work_order` and `update_doctor_work_order` recalculate totals from saved unit prices when quantity or discount changes and never consult the catalog merely because contract/type metadata changed. `set_work_order_price_snapshot` is the only direct order-price override and writes a `work_order_financial_audit` row.

- [ ] **Step 5: Run focused and schema tests**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/work_order_price_snapshots.sql && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/financial_schema.sql && node tools/build-db-apply.js --check`

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add db/schema tests/sql/work_order_price_snapshots.sql
git commit -m "feat(db): freeze work order sale prices"
```

### Task 3: Technician assignments and append-only payments

**Files:**
- Create: `db/schema/20_functions/sync_work_order_stage_assignment.sql`
- Create: `db/schema/20_functions/record_technician_payment.sql`
- Create: `db/schema/20_functions/reverse_technician_payment.sql`
- Modify: `db/schema/20_functions/update_management_work_order.sql`
- Modify: `db/schema/20_functions/ai_mutate_work_order.sql`
- Modify: `db/schema/20_functions/set_stage_payment_status.sql`
- Create: `tests/sql/technician_financial_history.sql`
- Regenerate: `db/schema/apply.sql`

**Interfaces:**
- Consumes: stage assignments, payment ledger, and audit table from Task 1.
- Produces: `sync_work_order_stage_assignment(p_lab uuid, p_work_order_id bigint, p_stage text, p_technician_name text) returns uuid`.
- Produces: `record_technician_payment(p_assignment_id uuid, p_amount numeric, p_paid_on date, p_request_key text) returns uuid`.
- Produces: `reverse_technician_payment(p_payment_id uuid, p_reason text, p_request_key text) returns uuid`.

- [ ] **Step 1: Write a failing assignment/payment history test**

Create a work order with quantity 2 and Denis cost 20 for Model. Assign Denis and assert active `agreed_amount = 40`. Change the catalog cost to 30 and assert the assignment stays 40. Record a 15 RON payment twice with the same request key and assert one ledger row and paid total 15. Reassign to Kiki, assert Denis is closed and Kiki's new assignment uses Kiki's current catalog cost. Reverse the 15 RON payment and assert net paid is zero while both ledger entries remain.

- [ ] **Step 2: Run the history test and confirm missing functions fail**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/technician_financial_history.sql`

Expected: non-zero exit with `function sync_work_order_stage_assignment ... does not exist`.

- [ ] **Step 3: Implement assignment synchronization**

Resolve technician identity from an active profile when the name has one match; reject ambiguous matches. If the requested technician equals the active assignment, return its ID unchanged. Otherwise close the old assignment and create a new one from the current `lab_technician_costs` rule, with `NULL` cost/source when no rule exists. Refuse reassignment with an outstanding old balance unless the caller supplies the explicit settlement choice through the management update path. Call synchronization whenever any of the three technician fields changes.

- [ ] **Step 4: Implement idempotent payments and bridge the legacy paid control**

Require management for recording/reversing payments. Lock the assignment, reject overpayment, insert using the unique request key, and return the existing ID on retry. A `Paid` transition calls `record_technician_payment` for the exact outstanding balance; a `Not Paid` transition reverses the latest unreversed payment created by the legacy control. Never delete ledger rows.

- [ ] **Step 5: Run the financial tests**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/technician_financial_history.sql && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/work_order_price_snapshots.sql`

Expected: both scripts exit 0.

- [ ] **Step 6: Commit**

```bash
git add db/schema tests/sql/technician_financial_history.sql
git commit -m "feat(db): preserve technician assignment and payment history"
```

### Task 4: Idempotent historical backfill

**Files:**
- Create: `db/schema/20_functions/backfill_work_order_financial_history.sql`
- Create: `tests/sql/financial_backfill.sql`
- Modify: `db/schema/40_grants.sql`
- Regenerate: `db/schema/apply.sql`

**Interfaces:**
- Consumes: snapshot resolver and financial tables from Tasks 1–3.
- Produces: `backfill_work_order_financial_history(p_lab uuid) returns jsonb`, callable only by Admin, returning counts for `prices`, `assignments`, `migration_balances`, and `missing_prices`.

- [ ] **Step 1: Write a failing idempotency and provenance test**

Insert one old per-tooth order with saved line prices, one legacy order with only a matching current tariff, one order with no tariff, one assigned stage with current technician cost, and one legacy `Paid` flag. Run the backfill twice. Assert per-tooth values win, current tariff rows use `price_source = 'migration_catalog'`, missing tariff remains `NULL`, exactly one assignment exists per stage, and the paid flag creates one `migration_balance = true` ledger entry with `paid_on is null`.

- [ ] **Step 2: Run the backfill test and confirm the function is missing**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/financial_backfill.sql`

Expected: non-zero exit with `function backfill_work_order_financial_history ... does not exist`.

- [ ] **Step 3: Implement guarded backfill**

Lock each selected work order while deriving snapshots. Populate only fields that have never been fixed; use saved item lines before catalog lookup. Create assignments only where an operational technician exists and no assignment history exists. Represent a legacy paid total as an undated migration balance linked to that assignment. Do not grant this function to ordinary `authenticated`; execution is an explicit deployment step with an Admin session or controlled service role.

- [ ] **Step 4: Run backfill twice and execute the full SQL suite**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/financial_backfill.sql && for f in tests/sql/financial_*.sql tests/sql/work_order_price_snapshots.sql tests/sql/technician_financial_history.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done`

Expected: every script exits 0 and the second backfill reports zero new rows.

- [ ] **Step 5: Commit**

```bash
git add db/schema tests/sql/financial_backfill.sql
git commit -m "feat(db): backfill work order financial snapshots"
```

### Task 5: Move financial readers and UI to snapshots

**Files:**
- Modify: `db/schema/20_functions/get_my_work_orders.sql`
- Modify: `db/schema/20_functions/get_my_work_orders_v188.sql`
- Modify: `db/schema/20_functions/get_my_salary.sql`
- Modify: `db/schema/20_functions/get_my_production.sql`
- Modify: `db/schema/20_functions/ai_technician_receivables.sql`
- Modify: `db/schema/20_functions/ai_technician_work_orders.sql`
- Modify: `db/schema/20_functions/ai_read_dataset.sql`
- Modify: `db/schema/20_functions/get_ai_context.sql`
- Modify: `website/app/app.js`
- Create: `tests/sql/financial_read_models.sql`
- Create: `tests/app/financial-snapshots.test.js`

**Interfaces:**
- Consumes: persisted price, assignment, and payment records from Tasks 1–4.
- Produces: existing work-order response columns with snapshot-backed `unit_price`, `list_price`, `final_price`; technician receivable breakdown with `Assignment_ID`, `Agreed_Amount`, `Paid_Amount`, `Outstanding_Amount`, `Cost_Source`.

- [ ] **Step 1: Write failing reader tests**

The SQL test creates an order and assignment, changes both catalogs, records a partial payment, then asserts every reader returns the saved sale price/cost and the same paid/outstanding totals. It authenticates once as Admin and once as the assigned technician and asserts the technician cannot read client sale price or another technician's history. The Node test loads `website/app/app.js` source and asserts order totals use API snapshot fields without locally consulting current price lists during edit rendering.

- [ ] **Step 2: Run tests and observe current catalog-derived failures**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/financial_read_models.sql && node --test tests/app/financial-snapshots.test.js`

Expected: SQL assertions fail because current readers join live catalogs.

- [ ] **Step 3: Replace catalog joins in historical readers**

Use saved item totals when an order has items, otherwise saved order totals. Salary/receivables aggregate active and closed assignments plus net payment ledger entries; preserve technician row filtering. Include migration provenance for management and omit client prices for technicians.

- [ ] **Step 4: Update the work-order editor and history presentation**

Render the API's saved unit/list/final values. Only the explicit admin price action calls `set_work_order_price_snapshot`. Add a management history view showing assignment tenure, agreed amount, payment rows, reversals, provenance, and undated migration balances; technicians see the same fields for their own assignments.

- [ ] **Step 5: Run all financial tests and schema checks**

Run: `for f in tests/sql/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done && node --test tests/app/financial-snapshots.test.js && node tools/build-db-apply.js --check && git diff --check`

Expected: exit 0 throughout.

- [ ] **Step 6: Commit**

```bash
git add db/schema website/app/app.js tests
git commit -m "feat: read work order financial snapshots everywhere"
```
