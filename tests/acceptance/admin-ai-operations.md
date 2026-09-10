# Admin AI operations acceptance

Run this checklist in a non-production environment after applying
`db/schema/apply.sql`, running the financial backfill, deploying the web app,
and importing the n8n workflow.

Record the authenticated Admin user, request key, preview ID, response, and
database rows for each case. Use a fresh chat session for each numbered case.

1. Ask `duplică tehnicianul Denis pentru costuri, numele nou Kiki`.
   Expect a preview that identifies `technician_cost.duplicate` and reports the
   number of Denis cost rows. It must not ask for a patient. Confirm using the
   displayed code. Verify all Denis `(tip_lucrare, etapa, cost)` rows were copied
   to Kiki and no Work Order was created. Repeat the HTTP request with the same
   `client_request_id`; no additional rows may appear.
2. Repeat case 1 when Kiki already has cost rows. Expect clarification for
   `append` or `replace`, followed by a new preview. Cancel it and verify no row
   changed.
3. Create a Work Order with patient, partner, type, quantity, and optional
   technician assignments. Verify the response ID and saved price snapshot.
4. Change a current contract tariff. Verify existing Work Orders retain their
   saved price and a newly created Work Order uses the changed tariff.
5. Change one Work Order price with `unit_price`, `discount`, and a reason.
   Verify `work_order_financial_audit` contains before/after values.
6. Request a multi-order update or delete. Expect a five-minute preview. Change
   one target directly before confirmation; expect the confirmation to be
   rejected as stale.
7. Try a Technician-only name that resolves to zero or multiple distinct
   identities. Expect clarification and no database mutation.
8. Authenticate as Manager and request a technician-cost or tariff change.
   Expect an Admin-only refusal. Authenticate against another laboratory and
   reuse a target ID; expect no cross-laboratory mutation.

For every successful execution, verify the AI response describes values
returned by the server. A success response must never be produced for
`ok=false`.
