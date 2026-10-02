# Lab Partner portal — 2 October 2026

Lab Partners see the current production status in their order list and a dedicated
production dashboard containing only their orders. Patients and Materials are
hidden. The order dialog groups details, line items, pricing and attachments.
The order list becomes cards on narrow screens; production columns stack.

Partners can edit only their own unarchived, unlocked orders while the overall
status and every production stage remain `Not Started`. Resubmitting recalculates
the price, increments the submission revision and returns the order to pending
approval. Read-only orders retain attachment viewing and downloading. SQL and
file authorization enforce the restrictions independently of the interface.

Admin/Manager can approve or reject from the order dialog. Approval checks the
submission revision so an older dialog cannot approve a newer, unseen submission.
Pending orders can be locked, but cannot start production or receive new
technician assignments until approval.

Partner chat recipients are active Admin/Manager users in the mapped laboratory.
The same rules govern thread creation, sending to existing threads and uploading
attachments after a role or membership changes. Existing message history remains
readable under the existing participant policies.

Admin configuration uses consistent headings, fonts, inputs, checkboxes and
buttons. Mobile pricing rows become cards with both action buttons visible.

## Verification

- 21 new automated tests pass: 8 UI/DOM, 10 PostgreSQL and 3 Edge Function tests.
- The full suite reports 287 tests: 283 pass and 4 fail. All four failures also
  occur on the original HEAD, before this change:
  - `tests/app/per-tooth-work-orders.test.js`: technicians/new order item scope.
  - `tests/app/work-type-billing-modes.test.js`: Admin CRUD/CSV billing mode.
  - `tests/workflows/google-drive-backup.test.mjs`: inactive/scheduling/payload
    configuration and n8n-only workflow expectations (two failures).
- Chrome checks pass at 1440×1000, 1024×768, 390×844 and 320×740. They exercise
  the actual app scripts and styles with offline authentication/RPC fixtures:
  navigation, current status, dashboard refresh, editing and read-only orders,
  chat with a manager, approval/rejection and admin configuration. Geometry
  checks cover viewport overflow, mobile actions and touch target sizes.
- PostgreSQL behavior is exercised with PGlite; the migration was also reapplied
  to check idempotence. The Edge tests execute the actual TypeScript handler
  with a mocked Supabase boundary.
- JavaScript syntax, whitespace and generated SQL freshness checks pass. A
  separate code review found four authorization/concurrency issues that were
  reproduced, fixed and covered by regression tests.

These checks do not exercise a live Supabase deployment. Browser screenshots and
`results.json` are retained in the adjacent workspace directory
`../flowrise-review-20261002/` (relative to the repository root).

## Release order

1. Apply `db/migrations/20261002_lab_partner_portal.sql` inside a transaction,
   after `20261001_lab_partner_orders.sql`. This replaces the external-order
   review RPC with its submission-revision-aware signature. Generated
   `db/schema/apply.sql` and `apply.supabase.sql` also include this migration.
2. Redeploy `db/edge-functions/authorize-work-order-file/index.ts`, retaining
   the existing deployment authentication configuration.
3. Publish the updated `website/app` files. Their asset versions are bumped.
4. With actual Partner and Admin/Manager accounts, check own-order visibility,
   editing before production, management locks, chat recipients, attachment
   permissions and approval of the displayed revision.

No production migration, Edge Function deployment or frontend push was performed
as part of this implementation and offline verification.
