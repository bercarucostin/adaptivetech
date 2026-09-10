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
3. Create a Work Order with patient, partner, a nonempty `items` array of
   `{tooth_number, work_type}` objects, and optional technician assignments.
   Use two FDI teeth with different work types. Verify the response ID, saved
   aggregate price snapshot, derived element count, and work-type summary.
   The AI must ask for a tooth number and work type when either is missing.
   It must not send or ask for a general work type, element count, or clinical
   material. Optional patient clinical JSON belongs in `fields.case` and must
   not contain material.
4. Update the scope of that Work Order through AI with a replacement nonempty
   `items` array. Verify each saved tooth/work type matches the request and
   that the response uses the server-derived summary. Try `items: []` and an
   item without `work_type`; expect clarification and no mutation. As a
   Technician who can access the Work Order, repeat a valid tooth-scope update
   and verify the same role and stage restrictions as the browser flow.
5. Change a current contract tariff. Verify existing Work Orders retain their
   saved price and a newly created Work Order uses the changed tariff.
6. Change one Work Order price with `unit_price`, `discount`, and a reason.
   Verify `work_order_financial_audit` contains before/after values.
7. Request a multi-order update or delete. Expect a five-minute preview. Change
   one target directly before confirmation; expect the confirmation to be
   rejected as stale.
8. Try a Technician-only name that resolves to zero or multiple distinct
   identities. Expect clarification and no database mutation.
9. Authenticate as Manager and request a technician-cost or tariff change.
   Expect an Admin-only refusal. Authenticate against another laboratory and
   reuse a target ID; expect no cross-laboratory mutation.

For every successful execution, verify the AI response describes values
returned by the server. A success response must never be produced for
`ok=false`.
