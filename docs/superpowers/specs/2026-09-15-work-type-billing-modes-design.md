# Work-Type Billing Modes Design

## Goal

Allow each laboratory work type to define whether partner prices and technician costs are charged per selected tooth, per involved arch, or once per work piece, while preserving the financial history of every saved Work Order.

## Billing modes

`lab_work_types.billing_mode` accepts exactly:

- `per_tooth`: one billable unit for every selected FDI tooth carrying the work type.
- `per_arch`: one billable unit for the upper arch when at least one tooth in quadrants 1 or 2 carries the work type, plus one billable unit for the lower arch when at least one tooth in quadrants 3 or 4 carries it. The same tariff applies to either arch.
- `per_piece`: one billable unit when the work type appears anywhere in the Work Order.

The default is `per_tooth` for every existing and newly created work type. An Admin changes only exceptional types to `per_arch` or `per_piece`.

`element_count` continues to mean the number of configured teeth. It is independent from billable quantity.

## Shared financial scope

A single canonical database helper derives billing units from tooth items and a resolved billing mode. Each unit has a stable identity:

- `tooth:11` through `tooth:48` for `per_tooth`;
- `arch:upper` and `arch:lower` for `per_arch`;
- `piece` for `per_piece`.

Partner prices and technician costs consume this same financial scope. A mixed Work Order derives and sums the units for each work type independently.

## Frozen partner prices

Tooth rows remain the clinical scope. Financial values move to `lab_work_order_price_lines`, with one row per work type and billing-unit identity. Each line freezes its work type, billing mode, billing scope, contract, unit price, line total, source, and timestamp.

When a work type first enters a Work Order, its billing mode and catalog tariff are copied to the Work Order price lines. Later changes to the catalog mode or tariff do not rewrite those lines. Adding another unit for the same work type in that Work Order reuses the already frozen mode and tariff. A work type introduced later uses the catalog configuration current at that time.

Scope edits retain unchanged billing-unit lines, add lines for newly involved units, and remove lines that are no longer involved. Every before/after price state is written to the existing financial audit. Aggregate list and final prices on `lab_work_orders` are calculated only from the saved price lines.

Existing Work Orders are migrated one-to-one from their current per-tooth snapshots. Migration never obtains historical money from the current catalogs.

## Frozen technician costs

Technician assignment cost lines store the billing mode and aggregate billable quantity for each work type. The amount is:

`configured technician cost for technician + work type + stage × billable quantity`

The same billing quantity applies independently to every assigned technician stage. Missing configuration blocks assignment or save with an error naming the technician, work type, and stage.

Scope changes compare billable quantities, not tooth counts. They append signed adjustment rows and never rewrite an original assignment, payment, or settled amount. Therefore:

- another tooth on an already involved `per_arch` arch creates no cost adjustment;
- the first tooth on the other arch creates a `+1` adjustment;
- removing the last tooth from an arch creates a `-1` adjustment;
- `per_piece` remains one unit while at least one tooth of the type remains.

Existing technician cost lines and adjustments are marked `per_tooth` without recalculating their saved amounts.

## Administration and AI

The Admin work-type editor has an explicit selector labeled `Per dinte`, `Per arcadă`, and `Per piesă`. Create defaults to `Per dinte`. Direct CRUD, CSV export/import, and the bulk import RPC carry `billing_mode`; missing CSV values default to `per_tooth`, while unknown values are rejected.

Admin AI work-type create/update operations accept `billing_mode`. The prompt and parser recognize only the three canonical values. Technicians may read the configured mode with work-type reference data, but they cannot change catalog configuration and never receive partner prices.

Price and cost interfaces use the neutral word `Tarif` and display both the billing mode and the number of billable units. The selected-tooth count remains available as separate clinical information.

## Security and compatibility

Price lines use the same commercial visibility boundary as current item price snapshots: Admin/Manager and connected Doctor access only. Technicians and Dashboard users continue through scrubbed security-definer read models.

The canonical schema remains idempotent. Deploying it gives every catalog row `per_tooth`, migrates existing saved price and cost lines without changing totals, and allows an Admin to opt selected work types into the other modes afterward. The generated Supabase SQL Editor bundle must match `db/schema/apply.sql`.

## Validation

Automated tests cover the default and enum constraint; one and two arches; per-piece across both arches; mixed modes; clinical versus billable counts; all technician stages; missing prices and costs; no-op edits inside the same arch; first/last unit adjustments; frozen catalog mode and tariff behavior; idempotent migration; Admin UI/CSV; AI parsing; access boundaries; generated schema consistency; and JavaScript/JSON syntax.
