# Per-Tooth Work Orders Design

## Goal

Make the configured teeth the only source of work scope, price, and technician cost. Remove the general work type, general material, and manually edited element count from the application and database.

## Domain model

- `lab_work_order_items` is the canonical scope of an active Work Order. Each row identifies a configured FDI tooth and its selected `work_type`.
- Every active Work Order must have at least one item and every item must have a valid active work type.
- The element count is derived as the sum of item quantities. It is never entered or stored on `lab_work_orders`.
- Work type summaries used by lists, filters, reports, PDF exports, and AI are derived from the item rows. Mixed cases expose all distinct types in deterministic FDI order.
- Sale prices are resolved and frozen per item. `lab_work_orders.snapshot_list_price` and `snapshot_final_price` remain frozen aggregate totals; the general unit-price snapshot is removed.
- Technician costs are resolved from each item's work type and frozen in assignment cost lines. Existing assignments, payments, and financial audit records remain immutable.
- The work-type, contract-price, and technician-cost catalogs remain because they provide the rules applied to each tooth.

## Removed concepts

- Drop `lab_work_orders.tip_lucrare`, `lab_work_orders.nr_elemente`, and `lab_work_orders.snapshot_unit_price`.
- Drop `lab_patient_cases.tip_lucrare` and `lab_patient_cases.material`.
- Remove general work type, material, and element-count controls from all Work Order and patient-case editors.
- Remove clinical material from tooth JSON, UI, reports, API parameters, and AI datasets. This does not affect `lab_materials_inventory` or the AI stock operations.
- Remove all price and technician-cost fallbacks that consult the removed scalar fields or current catalogs for an existing Work Order.

## Write flows

- Admin, Manager, Doctor, and Technician create a Work Order through role-safe RPCs that accept a non-empty JSON item array.
- Creation writes the order, patient case, item price snapshots, and initial technician assignment in one database transaction. Items exist before technician cost lines are calculated.
- Editing replaces the canonical items and patient-case clinical details atomically. Changes to scope recalculate the frozen sale snapshot for the new scope and create audited technician-cost adjustments or stage reassignment records without rewriting settled history.
- A Technician may create a Work Order and edit the teeth/work types for a Work Order they can access, subject to the same role and stage rules already enforced by the database.
- AI Work Order mutations use the same item-aware RPC path and require tooth numbers with work types for create or scope changes.

## Read flows

- Work Order RPCs return `items`, a derived `work_types` array, `work_type_summary`, and derived `element_count`.
- The browser maps these values for lists, searches, filters, KPIs, exports, patient reports, and production views.
- Patient-case reads return clinical fields and tooth JSON without general type or material.
- Historical prices come only from item snapshots and frozen aggregate totals. Historical technician amounts come only from assignment cost lines and payments.

## Existing data and cutover

- During schema deployment, Work Orders without `lab_work_order_items` are deleted as authorized by the product owner.
- Related patient cases, file metadata, stage cost lines, payments, assignments, and financial audit rows are removed in dependency order. Storage objects referenced only by those deleted Work Orders are removed where the schema permits transactional deletion.
- The cleanup runs before the invariant is enabled. All writers are changed in the same deployment so an active no-item Work Order cannot be created afterward.
- Obsolete function overloads are dropped, dependent readers are recreated, and the obsolete columns are dropped only after code no longer references them.

## UI behavior

- “Lucrare nouă” is available to Technician.
- The form contains patient, partner, dates, stage/status fields allowed by role, notes, files, and the tooth selector.
- The tooth popup contains work type, shade, and note. It contains no material control.
- Save is rejected until at least one tooth is configured and every selected tooth has a work type.
- Element counts and work-type labels may still appear as derived display information, never as general editable fields.

## Validation

- Static schema tests prove obsolete columns, parameters, and fallback branches are absent and all item-aware functions are included in dependency order.
- SQL integration tests cover atomic Technician creation, mixed work types, frozen price totals, item-based technician costs, role checks, and rejection of empty items.
- Browser tests cover removal of controls, per-tooth derivation, Technician create access, and payloads without material or scalar scope fields.
- Workflow tests cover item-aware AI mutations and ensure stock-material operations remain available.
