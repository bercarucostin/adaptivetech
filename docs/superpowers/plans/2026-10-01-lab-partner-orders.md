# Lab Partner Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship secure Lab Partner commercial orders, external approval, and contract-based processing/urgency pricing.

**Architecture:** Preserve `lab_work_orders` as the common order envelope. Add partner-specific commercial rows and price snapshots alongside existing clinical teeth rows, with all authorization and pricing resolved through security-definer RPCs. Extend the single-page app and edge function only through these server boundaries.

**Tech Stack:** PostgreSQL/Supabase RLS and RPCs, Deno Supabase Edge Functions, vanilla JavaScript UI, Node-based SQL/browser source tests.

**Spec:** `docs/superpowers/specs/2026-10-01-lab-partner-orders-design.md`

## Global Constraints

- Preserve all existing clinical order, clinical case, and frozen price behavior.
- Resolve Lab Partner identity via a one-partner mapping, never profile-name matching.
- Use `Europe/Bucharest` and server time for urgency.
- All create/update/resubmit/review mutations use security-definer RPCs; direct table writes stay unavailable.
- Historical orders remain `internal` and `approved`; catalog edits never rewrite historical snapshots.

## Review Focus

- A Lab Partner attempts to read, mutate, price, or upload files for another partner’s order: deny it at every server boundary.
- A deadline exactly at the urgency boundary: it is non-urgent; less than the configured hours is urgent.
- A work type without processing enabled receives `processing_requested=true`: reject it.
- A rejected external order is resubmitted: keep review history, clear active refusal, and return it to pending.
- A contract lacks a partner-specific row: resolve the Admin-configured default contract deterministically.

---

### Task 1: Database migration and authoritative RPCs

**Files:**
- Create: `db/migrations/20261001_lab_partner_orders.sql`
- Modify: `db/schema/10_tables/09_lab_contract_work_prices.sql`, `db/schema/10_tables/15_lab_work_orders.sql`, `db/schema/10_tables/16_lab_work_types.sql`
- Modify: `db/schema/20_functions/effective_lab_role.sql`, `db/schema/20_functions/get_work_order_reference_data.sql`, `db/schema/apply.supabase.sql`
- Test: `tests/sql/test_lab_partner_orders.py`

**Interfaces:**
- Produces `estimate_lab_partner_work_order_price(p_lab uuid,p_items jsonb,p_deadline_at timestamptz) returns jsonb`.
- Produces `create_lab_partner_work_order(p_lab uuid,p_deadline_at timestamptz,p_items jsonb,p_note text default null) returns bigint`.
- Produces `update_lab_partner_work_order(...)`, `review_external_work_order(p_lab uuid,p_order bigint,p_decision text,p_reason text default null)` and partner access helpers.

- [ ] Write source/SQL tests that assert the migration creates partner links, order approval fields, commercial rows, pricing configuration, and all RPC role/ownership guards.
- [ ] Run the test and verify it fails because the migration/RPC definitions do not exist.
- [ ] Implement one idempotent migration: schema changes, backfill, helper functions, partner estimate/create/update/resubmit/review RPCs, datetime deadline writes, pricing precedence and production-state guards.
- [ ] Mirror new objects in the split schema sources and generated apply file.
- [ ] Run the SQL test and repository SQL checks; verify they pass.
- [ ] Commit: `feat: add lab partner order database workflow`.

### Task 2: Role administration, reference data, and file authorization

**Files:**
- Modify: `db/edge-functions/admin-users/index.ts`
- Modify: `db/edge-functions/authorize-work-order-file/index.ts`
- Modify: `db/schema/70_email_notifications.sql`, `db/migrations/20261001_lab_partner_orders.sql`
- Test: `tests/workflows/lab-partner-access.test.mjs`

**Interfaces:**
- Consumes Task 1 `lab_partner_user_links`, `lab_partner_can_access_order`, and `effective_lab_role`.
- Produces Admin user payload property `Partner_ID` for Lab Partner mappings.

- [ ] Write failing tests for accepting `Lab Partner` only with a valid active partner mapping, and for edge-file access scoped to the mapped partner.
- [ ] Run the tests and verify expected failure.
- [ ] Extend user create/edit/list to validate and persist the explicit partner link; include the role in reference data and notifications.
- [ ] Extend file authorization with Lab Partner list/download/upload and Doctor-equivalent deletion restrictions, using the server helper rather than text matching.
- [ ] Run focused tests and the affected workflow suite; verify pass.
- [ ] Commit: `feat: authorize lab partner users and files`.

### Task 3: Admin configuration and order application UI

**Files:**
- Modify: `website/app/app.js`
- Modify: `website/app/styles.css`
- Test: `tests/app/lab-partner-orders.test.js`

**Interfaces:**
- Consumes Task 1 estimate/create/update/review RPCs and reference data fields.
- Consumes Task 2 user `Partner_ID` mapping.
- Produces Lab Partner form rows `{work_type,color,quantity,processing_requested}` and approval UI actions.

- [ ] Write failing browser-source tests for Lab Partner role detection, commercial form controls without odontogram/patient fields, live urgency warning, and Admin/Manager review actions.
- [ ] Run tests and verify expected failure.
- [ ] Implement role-aware navigation, Lab Partner order create/edit/resubmit modal, date-time deadline, live server estimates, upload integration, order approval details/actions, and list/case-sheet badges.
- [ ] Extend Admin Config for Lab Partner partner assignment, processing flag, default contract, urgency window, contract globals, and per-type overrides.
- [ ] Run focused browser tests and existing order/pricing browser tests; verify pass.
- [ ] Commit: `feat: add lab partner order experience`.

### Task 4: Regression verification and deployment documentation

**Files:**
- Modify: `docs/backup-restore.md` only if migration/deployment documentation has an existing section for database releases; otherwise no documentation change.
- Test: `tests/sql/test_lab_partner_orders.py`, `tests/workflows/lab-partner-access.test.mjs`, `tests/app/lab-partner-orders.test.js`

- [ ] Add regression cases for historical orders, automatic internal approval, rejected resubmission history, config fallback, and urgency boundary.
- [ ] Run the complete available test set; record any unavailable runner honestly.
- [ ] Verify migration idempotency through source-level checks and `git diff --check`.
- [ ] Commit: `test: cover lab partner order workflow`.

