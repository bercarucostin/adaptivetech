# AI Admin Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admin users safely create, update, duplicate, and delete supported laboratory data through AI without misrouting one entity as another.

**Architecture:** Replace the work-order-only mutation contract with a typed operation envelope and server-side dispatcher. Each entity uses a dedicated validated handler; destructive or bulk operations use expiring previews, and request keys make retries idempotent.

**Tech Stack:** PostgreSQL/Supabase RPC, PL/pgSQL, n8n workflow JSON, OpenAI structured JSON prompting, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-10-ai-administration-financial-history-design.md`

**Execution prerequisite:** `psql`, `deno`, a non-production n8n instance, and the repository-required `node` command must be available. The current planning environment does not expose `node`, so executors must satisfy this before running workflow tests or the schema runner.

## Global Constraints

- This plan starts only after `2026-09-10-work-order-financial-history.md` is deployed and verified.
- Admin capabilities are explicit per entity and field; no arbitrary SQL executor is introduced.
- Role and laboratory are derived from the authenticated request.
- Manager receives no new Admin-only capability.
- Bulk and destructive effects require an unexpired preview bound to the same user and laboratory.
- A retry with the same request key cannot duplicate a payment, stock adjustment, row duplication, or create operation.
- AI reports success only from committed server output.

---

### Task 1: Typed operation envelope and preview persistence

**Files:**
- Create: `db/schema/10_tables/28_ai_operation_previews.sql`
- Create: `db/schema/10_tables/29_ai_operation_requests.sql`
- Create: `db/schema/20_functions/ai_preview_operation.sql`
- Create: `db/schema/20_functions/ai_execute_operation.sql`
- Create: `db/schema/30_policies/28_ai_operation_previews.sql`
- Create: `db/schema/30_policies/29_ai_operation_requests.sql`
- Modify: `db/schema/40_grants.sql`
- Create: `tests/sql/ai_operation_envelope.sql`
- Regenerate: `db/schema/apply.sql`

**Interfaces:**
- Produces envelope: `{entity text, operation text, target jsonb, fields jsonb, request_key text, preview_id uuid|null}`.
- Produces: `ai_preview_operation(p_envelope jsonb) returns jsonb` with `preview_id`, `expires_at`, `targets`, `before`, `after`, `checksum`.
- Produces: `ai_execute_operation(p_envelope jsonb) returns jsonb` with `ok`, `entity`, `operation`, `ids`, `count`, `values`, `request_key`.

- [ ] **Step 1: Write the failing envelope security test**

Assert missing entity/operation/request key is rejected; an unknown entity is rejected; payload fields outside a handler's allowlist are rejected; a Manager cannot execute `technician_cost.duplicate`; a preview made by Admin A cannot be used by Admin B; an expired or checksum-stale preview cannot execute; and repeating a successful request key returns its stored result without a second mutation.

- [ ] **Step 2: Run the test and confirm missing functions fail**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_operation_envelope.sql`

Expected: non-zero exit with `function ai_preview_operation ... does not exist`.

- [ ] **Step 3: Implement envelope validation and request ledger**

Validate JSON types and a closed `(entity, operation)` registry before dispatch. Store caller, lab, normalized envelope hash, state, result, and timestamps under `(lab_organization_id, request_key)`. If the key exists with another hash, reject it; if it exists completed, return the stored result. Run handler and request-state transition in one transaction.

- [ ] **Step 4: Implement five-minute previews**

Persist resolved IDs plus before/after values, caller, lab, envelope hash, checksum, and `expires_at = now() + interval '5 minutes'`. Require previews for delete, replace, duplicate-to-existing-target, and operations affecting more than one row. Lock resolved targets and invalidate when checksum or relevant `updated_at` values differ.

- [ ] **Step 5: Run tests and commit**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_operation_envelope.sql && node tools/build-db-apply.js --check`

```bash
git add db/schema tests/sql/ai_operation_envelope.sql
git commit -m "feat(db): add typed AI operation dispatcher"
```

### Task 2: Admin handlers for work orders and financial configuration

**Files:**
- Create: `db/schema/20_functions/ai_admin_work_order_operation.sql`
- Create: `db/schema/20_functions/ai_admin_price_operation.sql`
- Create: `db/schema/20_functions/ai_admin_technician_cost_operation.sql`
- Modify: `db/schema/20_functions/ai_execute_operation.sql`
- Modify: `db/schema/20_functions/ai_preview_operation.sql`
- Create: `tests/sql/ai_admin_financial_operations.sql`

**Interfaces:**
- Consumes: `set_work_order_price_snapshot` and financial history functions from the financial plan.
- Produces handlers for `work_order.create|update|delete`, `work_order_price.set`, `contract_price.create|update|delete|duplicate`, and `technician_cost.create|update|delete|duplicate`.

- [ ] **Step 1: Write failing handler tests**

Cover creation and update of a work order, explicit saved-price change with audit, tariff update that leaves old orders unchanged, contract duplication, and Denis-to-Kiki technician-cost duplication. Assert the latter copies every `(tip_lucrare, etapa, cost)` in one transaction, does not create a work order, and never emits `Nume_Pacient is required`. Test absent/ambiguous source, an existing Kiki target requiring preview plus conflict mode `append|replace|cancel`, and rollback when any copied row is invalid.

- [ ] **Step 2: Run tests and confirm unsupported operations fail**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_admin_financial_operations.sql`

Expected: non-zero exit with `Unsupported AI entity`.

- [ ] **Step 3: Implement work-order and saved-price handlers**

Map explicit fields to existing RPCs, preserving their validation and patient-case synchronization. Route individual price edits only through `set_work_order_price_snapshot`. Archive work orders with financial history instead of cascading ledger deletion; retain existing hard delete only when no financial history exists and the preview says so.

- [ ] **Step 4: Implement tariff and technician-cost handlers**

Validate nonempty contract/technician/work type/stage and nonnegative amounts. Allocate `source_row_no` while holding an organization-scoped advisory transaction lock. Duplicate all source rows with one `insert ... select` and enforce the previewed conflict mode. Return created IDs and counts.

- [ ] **Step 5: Run focused tests and commit**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_admin_financial_operations.sql && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/work_order_price_snapshots.sql`

```bash
git add db/schema tests/sql/ai_admin_financial_operations.sql
git commit -m "feat(db): add AI work order and pricing operations"
```

### Task 3: Admin handlers for remaining laboratory configuration

**Files:**
- Create: `db/schema/20_functions/ai_admin_config_operation.sql`
- Modify: `db/schema/20_functions/ai_execute_operation.sql`
- Modify: `db/schema/20_functions/ai_preview_operation.sql`
- Modify: `db/edge-functions/admin-users/index.ts`
- Create: `tests/sql/ai_admin_config_operations.sql`
- Create: `tests/edge/admin-users-ai-operations.test.ts`

**Interfaces:**
- Produces handlers for `work_type.create|update|delete`, `partner.update`, and the configuration kinds supported by `admin_bulk_config_import`.
- Produces authenticated Edge Function actions `create_user`, `update_user`, `deactivate_user` callable by an Admin operation adapter without exposing service-role credentials.

- [ ] **Step 1: Write failing allowlist and role tests**

For every supported entity assert allowed fields mutate only the current lab; unknown columns, role changes outside Admin rules, cross-lab IDs, authentication secrets, audit rows, and arbitrary table names are rejected. Assert user deactivation preserves financial history and active assignments are reported in preview.

- [ ] **Step 2: Run tests and confirm handlers are unavailable**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_admin_config_operations.sql && deno test db/edge-functions/admin-users/index.ts tests/edge/admin-users-ai-operations.test.ts`

Expected: non-zero exit from missing operation adapters.

- [ ] **Step 3: Implement explicit configuration mappings**

Use fixed maps from API field names to database columns and reuse `admin_bulk_config_import` validation where its semantics match. Require previews for deletes with dependencies. Keep organization relationships under their existing authorization functions; do not accept table or column identifiers from the model.

- [ ] **Step 4: Add the Admin user-operation adapter**

Reuse the Edge Function's JWT and active Admin membership check. Accept only the three operation names and non-secret profile fields already managed by that function. Return the same structured result shape as SQL handlers and accept a request key for idempotency.

- [ ] **Step 5: Run tests and commit**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_admin_config_operations.sql && deno test db/edge-functions/admin-users/index.ts tests/edge/admin-users-ai-operations.test.ts`

```bash
git add db/schema db/edge-functions/admin-users/index.ts tests
git commit -m "feat: add AI adapters for admin configuration"
```

### Task 4: n8n parsing, routing, confirmation, and response

**Files:**
- Modify: `workflows/Flowrise Dental - AI Client V17.4.json`
- Create: `tests/workflows/ai-admin-routing.test.js`
- Create: `tests/helpers/n8n-code-node.js`

**Interfaces:**
- Consumes: typed envelope, preview, and execute RPCs from Tasks 1–3.
- Produces model JSON: `{intent:"answer|clarify|preview|execute", reply:string, operation:{entity,operation,target,fields,request_key,preview_id}}`.

- [ ] **Step 1: Write failing workflow routing tests**

Extract named Code-node source from workflow JSON and execute it with mocked `$()` inputs. Feed Romanian examples for work-order creation, saved-price update, tariff update, and Denis-to-Kiki cost duplication. Assert each produces the correct entity/operation and the duplication never routes to `ai_mutate_work_order_role_safe`. Test an invalid entity, confirmation without preview, expired preview response, retry key reuse, and Romanian database error translation.

- [ ] **Step 2: Run tests and confirm cost duplication is misrouted**

Run: `node --test tests/workflows/ai-admin-routing.test.js`

Expected: failing assertion because the workflow supports only create/update/delete work-order intent.

- [ ] **Step 3: Update retrieval and final prompts with the typed schema**

Include the server capability catalog and require entity plus operation. Give concrete Romanian examples, enumerate mandatory/allowed fields, and require clarification for ambiguous target names. Remove wording that permits Admin mutations only for work orders.

- [ ] **Step 4: Route previews and execution through dedicated nodes**

Add Supabase nodes for `ai_preview_operation` and `ai_execute_operation`; add the Admin Edge Function branch only for user operations. Preserve the normalized input/auth token explicitly across nodes. Store preview identity in chat context, and accept a confirmation only when caller, session, envelope, and unexpired preview match.

- [ ] **Step 5: Normalize committed results and failures**

Return confirmation from saved result fields after `ok=true`. Map validation errors to clear Romanian clarification without changing the entity or fabricating fields. Preserve the old work-order RPC temporarily only for technician create until the material/calendar plan completes its unified role-safe routes.

- [ ] **Step 6: Run workflow and database regression tests**

Run: `node --test tests/workflows/ai-admin-routing.test.js && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/ai_admin_financial_operations.sql && git diff --check`

Expected: exit 0 throughout.

- [ ] **Step 7: Commit**

```bash
git add workflows tests/workflows tests/helpers
git commit -m "feat(workflow): route typed Admin AI operations"
```

### Task 5: Integrated Admin acceptance suite

**Files:**
- Create: `tests/acceptance/admin-ai-operations.md`
- Modify: `db/README.md`

**Interfaces:**
- Consumes: completed Admin operation stack.
- Produces: repeatable deployment and n8n import checklist with observed results.

- [ ] **Step 1: Document exact acceptance prompts and expected effects**

Include at minimum: `duplică tehnicianul Denis pentru costuri, numele nou Kiki`; create a work order; change one saved order price; change a future tariff; bulk delete preview/cancel; ambiguous technician; cross-lab target; and retry of the same request. For each, record expected table deltas and response text semantics.

- [ ] **Step 2: Run automated suites before manual import**

Run: `for f in tests/sql/ai_operation_envelope.sql tests/sql/ai_admin_*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done && node --test tests/workflows/ai-admin-routing.test.js && node tools/build-db-apply.js --check`

Expected: exit 0 throughout.

- [ ] **Step 3: Import workflow into a non-production n8n environment and execute acceptance prompts**

Record request key, preview ID where applicable, returned IDs, and database assertions in `tests/acceptance/admin-ai-operations.md`. Verify no production URL or credential is introduced by export/import drift.

- [ ] **Step 4: Update deployment documentation and commit**

Document database-first deployment, backfill verification, application deployment, n8n import, rollback boundaries, and the fact that production migration requires an explicit operational action.

```bash
git add tests/acceptance/admin-ai-operations.md db/README.md
git commit -m "docs: add Admin AI operation acceptance procedure"
```
