# Lab Partner Orders Design

## Goal

Add a `Lab Partner` role that can submit commercial work orders for exactly one catalog partner, while retaining the existing clinical Doctor order flow. Add review states for external orders and date-time based urgency pricing.

## Scope

- `Lab Partner` is a direct active membership of the Flowrise laboratory.
- Every Lab Partner user has exactly one explicit active mapping to a `lab_partners` record. The mapping is administered from the existing user configuration; it is never inferred from a profile name.
- A Lab Partner may read, create, edit, resubmit and manage files only for orders that belong to its mapped partner.
- Lab Partner orders have commercial rows: work type, optional color, positive integer quantity, optional processing (`Prelucrare`) and price snapshots. They have no patient, clinical case or odontogram.
- Doctor and Lab Partner submissions begin `pending`; Admin and Manager submissions, and Technician-created orders, begin `approved`.
- Admin and Manager can approve or reject external orders. Rejection may include an optional reason. Rejected external orders may be edited and resubmitted; resubmission returns them to `pending`.
- All roles who can read an order can see its approval state, reviewer, review time and latest rejection reason.
- New forms use a deadline date and time. Urgency is calculated in `Europe/Bucharest` from server submission time to that deadline.
- A contract has a global urgency percentage. A work type may opt into a different percentage for that contract. A work type can enable processing; processing has a contract-wide absolute amount with an optional per-work-type override.

## Data model

### Identity and origin

Add `lab_partner_user_links`:

| Column | Purpose |
| --- | --- |
| `lab_organization_id`, `user_id` | laboratory and authenticated account |
| `partner_id` | referenced active `lab_partners` row |
| `created_at`, `updated_at` | audit timestamps |

Its primary key is `(lab_organization_id, user_id)` so a Lab Partner user has only one partner. A unique constraint on `(lab_organization_id, partner_id, user_id)` is redundant but may be omitted. The user must have an active laboratory membership whose normalized role is `lab partner` / `lab_partner`.

Extend `lab_work_orders` with:

- `order_origin`: `doctor`, `lab_partner`, or `internal`; historical rows become `internal`.
- `partner_id`: nullable FK to `lab_partners`; new Doctor and Lab Partner orders set it, while historical rows retain their text partner value.
- `deadline_at timestamptz`: deadline selected in Bucharest time. `deadline` remains populated with its local calendar date for legacy screens and reports.
- `approval_state`: `approved`, `pending`, `rejected`; historical rows and internal orders are `approved`.
- `approval_reviewed_at`, `approval_reviewed_by_user_id`, `approval_reason`.

Add `lab_work_order_approval_events` for every submit, approve and reject transition. It stores the state, optional reason, actor, timestamp and submission sequence. This preserves a reason after resubmission without keeping the order in a rejected state.

### Lab Partner lines and prices

Add `lab_partner_work_order_items`, keyed by `(lab_organization_id, work_order_id, line_no)`, with `work_type`, `color`, `quantity`, `processing_requested`, and the frozen base/processing/urgency amount fields used by the order. Quantity is an integer from 1 upwards; color is optional free text capped at 120 characters.

Add `lab_partner_work_order_price_lines` for the immutable price explanation of each submitted item: contract, base unit price, base subtotal, processing amount, urgency percentage and surcharge, final line total, source metadata and fixed-at timestamp. `lab_work_orders.snapshot_list_price` and `snapshot_final_price` remain order totals and are recomputed only by server RPCs.

The clinical `lab_work_order_items` and `lab_work_order_price_lines` remain unchanged for Doctor/internal clinical orders.

### Configuration

Add `lab_order_pricing_settings` per laboratory:

- `default_contract`: administrator-selected fallback contract, initially `General` when that contract exists;
- `urgent_window_hours`: integer, initially 24;
- `timezone`: fixed to `Europe/Bucharest`.

Extend `lab_contract_work_prices` with nullable overrides:

- `urgent_percent_override` — when null, inherit the contract global urgency percent;
- `processing_amount_override` — when null, inherit the contract global processing amount.

Add `lab_contract_pricing_defaults` per `(lab, contract)` with `urgent_percent` and `processing_amount`, both non-negative. The contract price screen exposes these as global values and exposes an “override this work type” control on each work type price row.

Extend `lab_work_types` with `processing_enabled boolean not null default false`. The Lab Partner form shows the processing selector only for enabled types. A request for processing is invalid for a type where this is false.

## Authoritative workflows

### Doctor and Lab Partner submission

Doctor submission continues to require patient and tooth items. Lab Partner submission requires one or more commercial rows and does not accept patient/case/tooth input. Both resolve the partner and contract server-side:

1. Doctor resolves its currently connected clinic partner.
2. Lab Partner resolves its link table partner.
3. A contract named exactly like the resolved partner is preferred.
4. If absent for a requested work type, the configured default contract is used.

The client receives a live estimate, but `create_*` and `resubmit_*` RPCs validate the role, partner, active work types, quantity, processing eligibility, deadline and configuration again and calculate the final frozen prices themselves.

An external order is created or resubmitted in `pending` and cannot be assigned to a technician, advanced in production, locked, archived, or edited by an external submitter while pending. A rejected external order is editable by its owner if it is otherwise not locked. Attachments retain the existing role rules and are available during pending/rejected states.

### Internal orders

Existing Admin, Manager and Technician creation paths stamp `order_origin = internal` and `approval_state = approved`. Their normal production flow remains available immediately.

### Review

`review_external_work_order(p_lab, p_order, p_decision, p_reason default null)` permits only Admin or Manager. It locks the row and permits only `pending` Doctor/Lab Partner orders. `approve` transitions to `approved`; `reject` transitions to `rejected`; both create an event and set reviewer metadata. Rejection reason is optional, limited to 1,000 characters.

## Pricing and urgency

For each Lab Partner commercial row:

```
base = selected contract work-type price × quantity
processing = processing amount × quantity, only when requested
subtotal = base + processing
urgent = deadline_at - server clock in Europe/Bucharest < urgent_window_hours
surcharge = subtotal × selected urgency percentage / 100, only when urgent
line total = subtotal + surcharge
```

The selected urgency percentage is per-work-type override when present, otherwise its contract global. Processing similarly uses the type override when present, otherwise its contract global amount. Order totals are sums of frozen line totals. The UI displays the applied contract, urgency window, percentage, surcharge and a Romanian warning before submission. Server timestamps and `deadline_at` decide urgency, never browser time.

Existing Doctor/internal clinical pricing remains compatible. The implementation extends the common snapshot/read APIs so urgency metadata and deadline timestamps are visible where applicable, without recomputing historical prices.

## Interface and permissions

### App

- Add `isLabPartner()` and role-aware navigation/actions alongside `isDoctor()`.
- Add a Lab Partner create/edit modal based on the supplied commercial-row layout: searchable work type, optional color, processing selector when enabled, quantity stepper, attachments, deadline date/time, notes, live total and submit/resubmit action.
- Hide patient, clinical case, tooth chart and stage controls for Lab Partner order editing.
- Add approval badge/details to work-order list, case sheet and production views. Admin/Manager receive Approve and Refuse actions for pending external orders, with optional reason input.
- Extend Admin Config: role selection, Lab Partner partner mapping, work-type processing checkbox, contract defaults, work-type urgency/processing overrides, default-contract selector and urgency window.

### APIs and database

- Extend `effective_lab_role`, access checks, reference-data RPC, list/detail RPCs and file authorization to recognize Lab Partner scope.
- Add dedicated Lab Partner create/update/resubmit/estimate RPCs and review RPC; do not let table RLS bypass their validation.
- Update the storage authorization edge function so Lab Partner can list/download/upload its own partner’s order files and delete under the same lifecycle restrictions as Doctor.
- Update notification recipients for pending submission, approval and rejection without exposing other partner data.

## Compatibility and migration

- A single idempotent dated migration changes production tables, backfills historical orders to `internal` / `approved`, maps `deadline_at` from existing dates at 23:59 Bucharest only for display compatibility, and preserves all price snapshots.
- Schema source files and `apply.supabase.sql` are updated to describe the new objects for fresh deployments.
- Existing clinical forms keep their current date-only legacy field until their screens are migrated to date-time input; their RPCs write both `deadline` and `deadline_at`.
- No price catalog change rewrites an existing order’s snapshot. Resubmission deliberately creates a new snapshot and an audit event.

## Validation

- SQL tests cover partner isolation, role grants, approval transitions, rejected resubmission, implicit internal approval, contract fallback, processing eligibility, type/global override precedence, Bucharest deadline boundary and frozen prices.
- Browser tests cover Lab Partner form visibility, quantity/input validation, urgency warning and approval status/actions.
- Edge-function tests cover Lab Partner file access only to its linked partner’s orders.

