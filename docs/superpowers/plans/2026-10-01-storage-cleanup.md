# Flowrise Storage Monitoring and Bulk Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Admin configuration tab with accurate Supabase space charts and three date-scoped, previewed cleanup operations for Flowrise.

**Architecture:** A dedicated browser module renders the tab and calls an authenticated Edge Function. PostgreSQL owns immutable preview selections, authorization, job state and transactional deletion; the Edge worker removes Storage objects and retrieves disk metrics. A scheduled worker reconciles uploads authorized before cleanup, independently of the browser.

**Tech Stack:** Existing plain JavaScript frontend, CSS, Supabase JS v2, Deno Edge Functions, PostgreSQL, Supabase Cron with pg_net and Vault, Node test runner, isolated PGlite.

**Spec:** `docs/superpowers/specs/2026-10-01-storage-cleanup-design.md` (approved).

## Global Constraints

- Only active Flowrise Admins may read this tab's data or initiate cleanup; server scope is slug `flowrise-dental-lab`.
- Storage budget is initially `100000000000` bytes, in decimal GB, distinct from the existing `1073741824` byte per-file upload limit.
- Dates use `coalesce(data_receptie, created_at)` and inclusive calendar days in `Europe/Bucharest`, including archived orders. Missing timestamps are excluded and counted.
- Preview lifetime is 15 minutes. Confirmation operates on its stored selection, never a newly evaluated date range.
- Clinical-only cleanup deletes patient-case rows and clears the patient's name while preserving commercial items, finance and files. The UI must explain these limits.
- Complete cleanup includes payments, reversals, costs, assignments, financial audit, clinical data, Storage and order rows; unrelated catalogs and backups remain outside its scope.
- Credentials remain server-side. Unavailable disk measurements display unavailable, never simulated free space.
- No production deletion during development or verification. Preserve all preexisting staged files; commit only task-owned paths explicitly.
- Implement in an isolated worktree after plan approval. Use the existing temporary Node/PGlite installations if available; do not add product dependencies merely for validation.

## Review Focus

- An order changes through a child table without an `updated_at` change: invalidate its preview using an aggregate revision, tested in Task 1.
- Same numeric order ID exists in two labs and a file has a NULL lab: reject ambiguous attribution, tested in Tasks 1 and 4.
- Role revoked between confirmation and a scheduled retry: refuse another destructive batch, tested in Tasks 2 and 5.
- Browser disconnects after an unknown Storage deletion outcome: retries reconcile absence without dropping unrelated metadata, tested in Task 4.
- A clinic form opened before cleanup is submitted afterward: reject stale data and do not recreate the deleted case, tested in Tasks 3 and 6.

## File Structure and Shared Contracts

New modules follow the existing Edge `index.ts` plus testable `handler.mjs` pattern and frontend standalone-module pattern.

- SQL: `db/schema/10_tables/32_admin_cleanup.sql`, `db/schema/20_functions/admin_cleanup.sql`, `db/schema/30_policies/33_admin_cleanup.sql`; update `db/schema/40_grants.sql` and order-table schema.
- Edge: `db/edge-functions/admin-storage-cleanup/{index.ts,handler.mjs,metrics.mjs,worker.mjs}`.
- Browser: `website/app/storage-cleanup.js`; limited integration changes in `app.js`, `index.html`, `styles.css`.
- Delivery: `db/migrations/20261001_storage_cleanup.sql`, `db/migrations/20261001_storage_cleanup_schedule.sql`, `docs/storage-cleanup.md`, generated apply SQL.
- Tests: `tests/sql/storage-cleanup.integration.mjs`, `tests/sql/storage-cleanup-clinical.integration.mjs`, `tests/storage-cleanup/{metrics,handler,worker,scheduler}.test.mjs`, `tests/app/storage-cleanup.test.js`.

Action is exactly `files | clinical | all`. Job states are `preview | running | awaiting_uploads | completed | partial | failed | expired`; item states are `pending | processing | awaiting_uploads | completed | skipped | failed`.

Bytes and bigint order IDs cross JSON interfaces as decimal strings. Frontend uses BigInt for exact byte arithmetic and converts only ratios for rendering. UUID identifiers are strings. All public responses use `{ok:true,...}` or `{message:string,code:string}`.

Shared response types:

```text
Usage = {files:{used_bytes,quota_bytes,measured_at,buckets:[{name,used_bytes}]},
         database:{available:boolean,used_bytes?,available_bytes?,total_bytes?,measured_at?,reason?}}
Job = {id,action,state,from,to,expires_at,counts,bytes,missing_dates_count,
       progress:{total,completed,skipped,failed},reconcile_after,errors:[{order_id,code,message}]}
JobPage = {job:Job,orders:[{order_id,state,counts,bytes}],offset,limit,total}
```

## Task 1: Durable scoped previews and actual Storage usage

**Files:** Create the three cleanup SQL files and `tests/sql/storage-cleanup.integration.mjs`; modify `db/schema/10_tables/15_lab_work_orders.sql`, `db/schema/40_grants.sql`.

**Interfaces:** SQL RPCs `admin_storage_usage() RETURNS jsonb`, `admin_cleanup_preview(p_action text,p_from date,p_to date) RETURNS jsonb`, `admin_cleanup_status(p_job_id uuid,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0) RETURNS jsonb`, `admin_cleanup_jobs(p_limit integer DEFAULT 20) RETURNS jsonb`. The last returns the caller's recent jobs, including resumable ones. Browser-callable RPCs require `auth.uid()` and active profile/Admin membership. They resolve Flowrise on the server. All tables are RLS-enabled with no authenticated write grants.

- [ ] Write isolated PGlite tests loading canonical schema dependencies and production SQL. Assert a one-day interval includes both boundaries, the March and October DST transitions, archived orders and reception-date fallback; undated orders are excluded and counted.
- [ ] Add assertions that Manager, Technician, Doctor, Dashboard, inactive Admin and foreign-lab Admin are denied; authenticated direct job writes are denied; one Admin cannot confirm another's preview.
- [ ] Add assertions for NULL-lab file ambiguity with duplicate order IDs; orphan objects only match the valid `work-orders/{id}/{uuid}_{filename}` namespace in `work-order-files`. Wrong buckets and malformed paths never enter the deletion selection. Metadata or objects that conflict about ownership block the affected order.
- [ ] Run `node tests/sql/storage-cleanup.integration.mjs /tmp/flowrise-partner-validation/node_modules/@electric-sql/pglite/dist/index.js`; expect failure before SQL exists.
- [ ] Implement jobs, items and file manifests with UUID keys, owner/lab, dates, status, aggregate counts, bigint bytes, revision snapshots, leases and timestamps. Persist no clinical or financial payload. Add `cleanup_revision bigint NOT NULL DEFAULT 0`, `clinical_cleanup_generation bigint NOT NULL DEFAULT 0` and `clinical_cleared_at timestamptz` to orders. Generation permanently records whether cleanup occurred, even after an explicit new case resets the cleared timestamp.
- [ ] Implement mutation triggers that lock the parent order and increment its revision for order and associated clinical, file and financial writes. Derive payment parents through assignments. Take locks in deterministic order; cleanup-internal changes use a service-role-only execution path, not a caller-controlled bypass flag. Assert child-only edits invalidate previews.
- [ ] Implement preview and paginated status with strict action/date/page validation and actual file size sums using safe bigint parsing of Storage metadata. Missing/invalid sizes yield unknown-size counts, never false precise totals. Counts cover every dependent category from the spec.
- [ ] Rerun the integration test twice against the same migration/schema fixture; expect all checks to pass and reruns to preserve jobs. Commit only Task 1 paths with `git commit --only <task paths> -m 'Add scoped Admin cleanup previews and usage data'`.

## Task 2: Transactional cleanup and job execution contracts

**Files:** Extend `admin_cleanup.sql`, policy/trigger SQL and the Task 1 integration test.

**Interfaces:** Browser RPC `admin_cleanup_confirm(p_job_id uuid,p_confirmation text DEFAULT '') RETURNS jsonb`. Service-only RPCs `admin_cleanup_claim(p_job_id uuid,p_worker_id uuid) RETURNS jsonb`, `admin_cleanup_files(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 100) RETURNS jsonb`, `admin_cleanup_finish(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_storage_success boolean,p_error_code text DEFAULT NULL) RETURNS jsonb`, `admin_cleanup_due(p_limit integer DEFAULT 10) RETURNS jsonb`, `admin_cleanup_reconcile_finish(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_storage_success boolean) RETURNS jsonb`. Claim returns one leased item and manifest counts; files returns its manifest page. Finish and reconciliation finish revalidate lease and Admin owner, including when the original order no longer exists. Lease is 120 seconds; simultaneous workers cannot own the same item.

Service-only `admin_cleanup_checkpoint(p_job_id uuid,p_order_id bigint,p_worker_id uuid,p_paths text[],p_reconciliation boolean DEFAULT false) RETURNS jsonb` marks only validated manifest paths processed and renews the lease. File pagination uses a stable manifest index; successful initial deletion and successful later reconciliation have distinct progress markers.

- [ ] Add failing SQL cases for preview expiry after 15 minutes, edited revisions, repeated confirmation, wrong confirmation text for `all`, concurrent claims, expired leases and revoked owner membership. Confirming an expired preview never deletes data.
- [ ] Add complete-cleanup fixtures containing assignment cost lines, adjustments, payments and reversals, price lines, clinical rows, items and financial audit. Assert all selected dependents disappear, unselected orders and catalogs survive, and an external reversal link blocks deletion without widening scope.
- [ ] Run the Task 1 integration command and confirm these new cases fail.
- [ ] Implement confirm under row locks, including the exact `ȘTERGE` confirmation for `all`. Store `reconcile_after=confirmed_at+2 hours+5 minutes` for file actions; the margin covers signed-upload validity and clock skew. Empty selections complete without destructive calls.
- [ ] Implement claim with `FOR UPDATE SKIP LOCKED`, revision comparison, persistent locks and revalidation of owner access. Stale items become skipped; do not reselect dates. Trigger guards reject concurrent public mutation while an item is processing. A worker losing its lease cannot finalize data.
- [ ] Implement clinical deletion and complete relational deletion in explicit dependency order. Complete deletion requires successful Storage processing; financial audit is deleted after dependent operations that might append audit and before the order. Keep a job-local item journal after the order disappears; do not cascade jobs away with order rows.
- [ ] Implement partial-error and retry semantics, with reconciliation manifests retained through `awaiting_uploads` and checkpointed after each Storage batch. Reject checkpoint paths outside the leased manifest. Prevent order-ID reuse after purge by retaining existing sequence/high-water state. Add an assertion that the next created order does not reuse a removed ID.
- [ ] Run integration tests; expect pass. Commit only this task's changes.

## Task 3: Clinical deletion state and stale-form rejection

**Files:** Modify `db/schema/20_functions/save_work_order_clinical_case.sql`, `db/schema/20_functions/get_work_orders_page.sql`, `db/schema/20_functions/admin_cleanup.sql`. Create `tests/sql/storage-cleanup-clinical.integration.mjs`. Compound writer tests exercise existing `update_management_work_order_v188.sql`, `update_doctor_work_order.sql`, `upsert_patient_case.sql` and `save_my_work_order_case.sql` through their shared clinical writer; alter a wrapper only if the test proves its transaction can bypass the shared validation.

**Interfaces:** The dashboard JSON reader exposes `clinical_cleared_at` and `cleanup_revision` as additive fields. New RPC `get_work_order_cleanup_state(p_lab_organization_id uuid,p_work_order_id bigint) RETURNS jsonb` returns these fields after existing `can_access_work_order` and permitted clinical-role checks. It supplements table-returning readers without changing their return signatures. Clinical writers accept reserved JSON field `expected_cleanup_revision` within `p_case` without altering RPC argument signatures. Existing unversioned clients work before first cleanup; when `clinical_cleanup_generation>0`, explicit matching revision is required even after a new case has reset `clinical_cleared_at`.

- [ ] Write tests that clinical cleanup removes all selected patient-case rows, clears the patient name and preserves files, commercial items, price totals, assignments, payments and audit. An old or absent revision cannot restore a cleared case; a fresh explicit save succeeds and resets `clinical_cleared_at` atomically.
- [ ] Run `node tests/sql/storage-cleanup-clinical.integration.mjs /tmp/flowrise-partner-validation/node_modules/@electric-sql/pglite/dist/index.js`; expect failure.
- [ ] Add validation before any work-order/clinical mutation, including compound RPCs that save items before cases, so a stale case rolls back the whole transaction. Extend the clinical JSON allowlist deliberately; preserve existing role and stage rules. Ensure ordinary non-clinical status/payment edits do not recreate an empty case.
- [ ] Fetch `get_work_order_cleanup_state` alongside case data wherever the original reader cannot return the additive fields. Preserve existing table-returning RPC signatures; do not drop functions with CASCADE. Do not expose restricted clinical content to Dashboard. Assert unversioned stale writes remain rejected after an explicit new case has been saved.
- [ ] Run the clinical and existing per-tooth/connection integration tests; expect pass. Commit only Task 3 paths.

## Task 4: Metrics and authenticated Edge worker

**Files:** Create the four Edge files and `tests/storage-cleanup/{metrics,handler,worker}.test.mjs`; modify `authorize-work-order-file/index.ts` for server cleanup locks.

**Interfaces:** `createAdminStorageCleanupHandler({createClient,getEnv,fetch,now}) -> (Request)->Promise<Response>`; `readDiskUsage({projectRef,token,fetch}) -> Promise<Usage['database']>`; `processCleanupJob({admin,jobId,workerId,maxOrders,deadlineMs,now}) -> Promise<Job>`. POST operations: `usage`, `preview` with action/from/to, `jobs`, `status` with job_id/offset/limit, `confirm` with job_id/confirmation, `process` with job_id. Use the caller's authenticated client for preview/jobs/status/confirm and service-only RPCs for worker calls.

- [ ] Write Node tests using injected clients/fetch/time: invalid JWT, inactive Admin, foreign lab, malformed JSON/date/action, wrong job owner, CORS preflight and methods other than POST. Assert rejection precedes Storage calls and no secret enters responses/logs.
- [ ] Add metrics assertions for a 120 GB live total against 100 GB, real disk response keys, missing token, invalid/negative metrics, upstream 401/429/timeouts and unknown file size. Disk failure must leave file measurements available.
- [ ] Add worker assertions for no SQL deletion after Storage failure; unknown outcomes retried as absent; metadata-only failed uploads; 1,001 paths split into batches no larger than 100; worker lease loss; processing one order per claim; elapsed request budget; and revoked role before subsequent batches.
- [ ] Run `node --test tests/storage-cleanup/metrics.test.mjs tests/storage-cleanup/handler.test.mjs tests/storage-cleanup/worker.test.mjs`; expect failures before implementation.
- [ ] Implement JWT validation with `auth.getUser()` and active profile/membership checks. Configure `SUPABASE_MANAGEMENT_TOKEN`, `SUPABASE_PROJECT_REF` and `FLOWRISE_STORAGE_QUOTA_BYTES` server-side; validate project ref and quota, with fixed Supabase host for disk requests. Time-bound metrics fetch; sanitized error codes only.
- [ ] Implement worker requests with at most 10 orders and 20 seconds of application time per call. Delete only server-returned manifest paths. Treat confirmed absence as success, other Storage errors as recoverable. Checkpoint each successful batch through Task 2's RPC so an order larger than one request budget resumes at remaining paths rather than restarting. Only call finish after every initial manifest path has succeeded. Keep manifests paginated and expose partial progress through status.
- [ ] Add a server RPC cleanup-lock check before signed upload/delete issuance in `authorize-work-order-file`. File-row mutation triggers provide the final lock check if processing starts after authorization. Read/download follow existing permissions.
- [ ] Run Edge tests and existing upload-cap/auth tests; expect pass. Commit only Task 4 paths.

## Task 5: Scheduled progress and late-upload reconciliation

**Files:** Extend `handler.mjs` and `worker.mjs`; create `db/migrations/20261001_storage_cleanup_schedule.sql`, `tests/storage-cleanup/scheduler.test.mjs`.

**Interfaces:** Server-only `scheduled` operation requires `X-Cleanup-Scheduler-Secret` equal to `FLOWRISE_CLEANUP_SCHEDULER_SECRET`, independently of browser JWTs. Calls `admin_cleanup_due`, processes active jobs and due manifests; each batch still revalidates its creator's current Admin access. SQL schedule uses Vault values `flowrise_cleanup_url`, `flowrise_cleanup_scheduler_secret` and project's publishable/anon API key for the Edge gateway, never stores literals in repository.

- [ ] Write failing tests that a browser JWT cannot use the scheduler operation; a wrong secret cannot claim jobs; correct secret continues after browser disconnect; reconciliation cannot finish before the deadline; and late objects are removed only at recorded paths. Add an actual SQL fixture for token-era manifests from before deployment.
- [ ] Run `node --test tests/storage-cleanup/scheduler.test.mjs`; expect fail.
- [ ] Implement scheduler request authentication and bounded processing. Reconcile exact manifest paths at or after `reconcile_after`, retry outages and finalize `completed` only on success. Failed items remain visible and retryable; no background job invents a new selection.
- [ ] Add an idempotent named Cron schedule running once per minute using pg_net and Vault. The schedule migration is separate from core schema so missing extensions or secrets cannot break ordinary schema installation; validate all required secret names and report setup instructions. Store no secret in Cron text.
- [ ] Run scheduler and worker tests; expect pass. Commit only Task 5 paths.

## Task 6: Admin tab with graphs, preview and progress

**Files:** Create `website/app/storage-cleanup.js`, `tests/app/storage-cleanup.test.js`; modify `website/app/app.js`, `website/app/index.html`, `website/app/styles.css`.

**Interfaces:** Browser global `FlowriseStorageCleanup.mount(root,{request,onClinicalCleared,onOrdersDeleted}) -> {destroy()}`. `request(operation,payload)` invokes `admin-storage-cleanup` using the existing Supabase client/session. Mount only in the `storage` Admin tab; destroy on tab change or logout. Standalone module may export via CommonJS for Node tests, matching existing browser modules.

- [ ] Write tests for decimal byte formatting, bigint order IDs, actual used/free/overage ratios, unavailable disk status, zero/invalid capacity, measured timestamp and text equivalents for graphs. Assert ratios are clamped only for the drawn segment, not the reported occupied percentage.
- [ ] Add flow tests for distinct `files`, `clinical`, `all` requests, required date interval, changing dates/action invalidating preview, paginated IDs, exact full-delete confirmation, double-click prevention, progress/retry, interrupted sessions and late responses after logout. Assert strings returned by the server are escaped or inserted with textContent.
- [ ] Add a stale clinical draft test: after cleanup, localStorage/session draft/cache entries are invalidated and canonical items do not reconstruct a case. A fresh explicit save carries `expected_cleanup_revision`; an already open stale form is rejected server-side as pinned in Task 3.
- [ ] Run `node --test tests/app/storage-cleanup.test.js`; expect failure.
- [ ] Implement the isolated module, CSS conic-gradient graphs and accessible text, table pagination and modal preview. Display clinical retention limits, included payments for complete purge, missing-date/ambiguous/stale counts and physical-disk measurement timing. A failed measurement never disables unrelated cleanup controls.
- [ ] Add the tab to base `renderAdminConfig`, preserving later wrappers, existing partner config and spreadsheet controls. Load the module before `app.js` and bump changed asset versions. Integrate cleanup result callbacks with existing reload/cache invalidation; prevent duplicate polling across rerenders. Recover active jobs from server status on reentry.
- [ ] Update clinical draft/read/save code to consume Task 3 fields and show the cleared-case state. Keep financial calculations based on preserved commercial items.
- [ ] Run frontend tests and inspect a local browser fixture on desktop and mobile for labels, overflow, modal keyboard focus, destructive-action wording and charts. Commit only Task 6 paths.

## Task 7: Migration, deployment documentation and final verification

**Files:** Create core migration and `docs/storage-cleanup.md`; modify `db/schema/apply.sql`, `db/schema/apply.supabase.sql`, `db/README.md` and fixture loading where needed.

**Interfaces:** Core migration installs all Task 1–3 SQL and required guards/readers in dependency order; schedule migration remains separately applied after Edge deployment and Vault setup.

- [ ] Build `db/migrations/20261001_storage_cleanup.sql` from the canonical definitions, including additive reader/writer updates, grants, triggers and `NOTIFY pgrst, 'reload schema'`. Assert two applications preserve job state and do not create duplicate triggers.
- [ ] Run `node tools/build-db-apply.js`, then `python3 tools/build-supabase-editor-sql.py`; verify generated parity with their `--check` modes. Do not edit generated outputs manually.
- [ ] Write deployment instructions: core migration, Edge deployment, server secrets, Vault/schedule setup and frontend release; specify gateway JWT configuration for scheduler requests. Include diagnostics for missing metrics, interrupted jobs and role revocation. Explain disk reuse versus immediate disk shrink and Storage live size versus monthly average. Never put example real credentials in documentation.
- [ ] Run all new SQL/Edge/frontend tests plus affected existing upload, partner, financial, per-tooth, clinical, QR and dashboard tests. Use `/tmp/node-v22.14.0-darwin-arm64/bin/node` when `node` is absent and the external PGlite path above. Run `python3 -m unittest discover -s tests/sql -p 'test_schema_idempotency.py'`, frontend syntax checks and `git diff --check`.
- [ ] Run `node --test tests` once, compare failures to baseline and report any preexisting Google Drive workflow failures separately. No production cleanup command is part of validation.
- [ ] Perform fresh whole-change review under `requesting-code-review`; check every Review Focus case and fixes with targeted reruns. Commit task-owned migration/documentation/generated files explicitly, preserving unrelated staged work. Record checks and remaining deploy requirements in the final user report; push/deploy only under the user's applicable authorization.

## Source References

- [Signed upload URLs are valid for two hours](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
- [Cron, pg_net and Vault for scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).
- Metrics endpoints and billing definitions are linked in the approved spec.

## Execution Handoff

Recommended method: Native execution in this session, followed by an independent whole-change review. The SQL selection, worker and browser share one job contract, so implementing them consecutively avoids coordination overhead while retaining review of the destructive behavior before delivery.

Implementation starts after the user reviews this plan and selects or confirms the execution method. The next implementation skill for Native execution is `superpowers:executing-plans`.
