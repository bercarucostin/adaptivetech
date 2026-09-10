# Database

Supabase project `qlynvfltjgjgeipndior`. The browser talks to it **directly**
with the publishable key, so RLS and function privileges are the security
boundary — not an internal detail.

```
db/
  schema/
    apply.sql              runs everything, in order (generated)
    00_prerequisites.sql   extensions and enum types
    10_tables/             structure, constraints, indexes, RLS enabled
    20_functions/          96 functions
    30_policies/           policies, triggers, function-dependent constraints
    40_grants.sql          privileges, including the profiles fix
    50_storage.sql         storage buckets
  edge-functions/          Deno functions deployed to Supabase, not the database
```

## Applying it

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/apply.sql
```

Run from the repository root — the `\i` paths are relative to it. Every
statement is idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, guarded
`DO` blocks), so re-running is safe and is the normal way to apply a change.

### Financial snapshots and AI mutations (2026-09-10)

Deploy these changes in this order:

1. Apply `db/schema/apply.sql` to create the snapshot, assignment, payment,
   AI-operation, material, and calendar functions and policies.
2. In an authenticated Admin session, call
   `backfill_work_order_financial_history(<lab uuid>)` once. Review the returned
   `prices`, `assignments`, `migration_balances`, and `missing_prices` counts.
   Calling it again is safe and must report no new rows.
3. Deploy `website/app/app.js`.
4. Import `workflows/Flowrise Dental - AI Client V17.4.json` into a
   non-production n8n environment first, verify its Supabase URL/credentials,
   then publish it.

Do not update contract prices or technician cost rules between applying the
schema and completing the backfill. Rows marked `migration_missing` require an
Admin decision; they are deliberately not converted to zero. Legacy `Paid`
flags become undated migration balances, not invented payment dates.

Rollback the UI/workflow before the database functions. Financial ledger rows
are append-only; preserve them when rolling back application behavior.

After adding or removing a file under `schema/`, regenerate the runner:

```bash
node tools/build-db-apply.js          # rewrite
node tools/build-db-apply.js --check  # fail if stale
```

## Why the phases exist

The previous layout was one file per object, alphabetical. It could not
rebuild a database, for four separate reasons — all of which the phase order
fixes:

| Problem | Phase that fixes it |
|---|---|
| `membership_status`, `relationship_status`, `lab_visibility`, `organization_type` and `citext` were used everywhere and **defined nowhere** | `00` |
| Tables have foreign keys to other tables | `10`, ordered by dependency — the filename number *is* the order |
| 43 policies call functions (`is_org_member`, `has_org_role`, …), and a policy's expression is resolved when it is created | `30`, after `20` |
| `lab_profiles` has a CHECK constraint calling `organization_is_type()` | moved to `30` with the policies |

Functions still reference tables, so `20` must follow `10`; and they call each
other in no fixed order, which is why `apply.sql` sets
`check_function_bodies = off` for the transaction — the same thing
`pg_restore` does.

The split moved statements between files without rewriting any of them. It was
verified statement-for-statement against the previous export: **370 statements
before, 369 after**, the single difference being the one policy deliberately
not recreated (below).

## The profiles policy

`profiles self update` is **dropped and not recreated**. It restricted which
*row* a user could write but not which *columns*, so any authenticated user
could rewrite `display_name`, `legacy_partner_name`, `legacy_user_id`,
`technician_name` and `active` — the exact fields sixteen functions read to
decide who owns which work order. A doctor could rename themselves onto
another partner's cases; a technician onto another's assignments; a
deactivated user could re-enable themselves.

Applied to production on 2026-09-09. The full reasoning, and the second layer
(`revoke update … from authenticated`), is in `schema/40_grants.sql`.

Nothing legitimate used it: the frontend never touches `profiles`, no SQL
function writes it, and the Edge Functions write it through `service_role`.

## Two things still unverified

Both are called out in the files themselves, and neither can be settled from
this repository:

1. **The enum labels in `00_prerequisites.sql` are reconstructed**, not
   exported — inferred from column defaults, cast literals and the Edge
   Function code. A missing label makes a rebuilt database reject rows that
   production accepts. `00_prerequisites.sql` carries the query to confirm
   them.
2. **Function `EXECUTE` grants are unknown.** Postgres grants `EXECUTE` to
   `PUBLIC` by default, so `anon` can probably call every function here.
   Most refuse anonymous callers on their own; three leak small facts.
   `40_grants.sql` carries the query and the revoke pattern.

## Edge Functions

`edge-functions/` holds the Deno sources deployed to Supabase Functions. They
are not database objects and `apply.sql` does not touch them.

| Function | Auth |
|---|---|
| `login-with-identifier` | **public** — JWT verification disabled by design; resolves nickname → identity, then delegates the password check to Supabase Auth |
| `authorize-work-order-file` | validates the caller's JWT, then gates by role before issuing signed storage URLs |
| `admin-users` | validates the JWT, then requires an active `Admin` membership in the lab org |

`login-with-identifier` sends `Access-Control-Allow-Origin: *` and has no rate
limiting. Because attempts are proxied through it, Supabase Auth sees the
function's egress IP rather than the caller's, which weakens its per-IP
throttle against password guessing. Worth fixing before launch.
