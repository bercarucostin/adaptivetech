# Flowrise storage monitoring and cleanup

The Admin configuration tab **Spațiu & curățare** shows live Storage usage
against the configured quota and actual database disk usage. Its three separate
actions operate on an inclusive reception-date interval in Europe/Bucharest,
including archived orders. Creation time is used when reception time is missing;
orders without either timestamp are excluded and counted.

| Action | Removed | Preserved |
| --- | --- | --- |
| Fișiere | Selected work-order objects and attachment metadata | Clinical and commercial/financial data |
| Date clinice | Patient cases and patient name | Files, commercial tooth/work-type items, prices, costs and payments |
| Toate detaliile despre lucrări | Orders, files, cases, items, prices, assignments, costs, adjustments, technician payments/reversals and financial audit | Configuration catalogs, accounts, independent chats and external backups |

Every action first creates a persistent preview, valid for 15 minutes, with
counts and paginated order IDs. Complete removal additionally requires typing
`ȘTERGE`. Confirmation uses that stored selection. Orders changed since preview,
ambiguous file attribution and payments linked to an unrelated reversal are
skipped rather than guessed. Each order is a separate unit of progress: successful
orders remain completed when another fails.

## Deploy in this order

1. Run [`20261001_storage_cleanup.sql`](../db/migrations/20261001_storage_cleanup.sql)
   in the Supabase SQL Editor. The migration installs tables, role checks,
   revision guards and clinical readers/writers; running it again preserves jobs.
   It does not execute a cleanup. Existing installations should use this focused
   migration; the generated full schema includes the same definitions for rebuilds.
2. Deploy `admin-storage-cleanup` with **all four files** from
   [`db/edge-functions/admin-storage-cleanup`](../db/edge-functions/admin-storage-cleanup):
   `index.ts`, `handler.mjs`, `metrics.mjs`, `worker.mjs`. Keep their relative paths.
   Disable the function gateway's JWT verification (`verify_jwt = false`, or
   `supabase functions deploy admin-storage-cleanup --no-verify-jwt`). The handler
   validates browser JWTs using Supabase Auth and requires an active Flowrise Admin;
   scheduled calls authenticate separately with a server secret.
3. Redeploy the updated
   [`authorize-work-order-file/index.ts`](../db/edge-functions/authorize-work-order-file/index.ts).
   It prevents issuing new upload/delete authorizations for an order being processed.
4. Configure the following in **Edge Functions → Secrets**, server-side only:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_MANAGEMENT_TOKEN` | Management API access token with permission to read this project's disk utilization (`infra_disk_config_read`) |
   | `SUPABASE_PROJECT_REF` | Project reference; defaults to the reference in `SUPABASE_URL` |
   | `FLOWRISE_STORAGE_QUOTA_BYTES` | `100000000000` for the initial 100 GB included Storage quota; adjust when the plan changes |
   | `FLOWRISE_CLEANUP_SCHEDULER_SECRET` | A newly generated random secret of at least 32 characters |

   Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`. Never copy the Management token, service key or
   scheduler secret into frontend configuration. Missing Management access only
   makes the disk measurement unavailable; Storage measurements and cleanup remain usable.
5. Enable the **Cron** (`pg_cron`), **pg_net** and **Vault** integrations in the
   Supabase project. In Vault, create exactly one secret with each name:

   | Vault name | Value |
   | --- | --- |
   | `flowrise_cleanup_url` | `https://<project-ref>.supabase.co/functions/v1/admin-storage-cleanup` |
   | `flowrise_cleanup_scheduler_secret` | Same value as the Edge scheduler secret |
   | `flowrise_cleanup_publishable_key` | This project's publishable API key (or legacy anon API key), for the gateway |

   Run [`20261001_storage_cleanup_schedule.sql`](../db/migrations/20261001_storage_cleanup_schedule.sql).
   It creates/updates the named `flowrise-storage-cleanup` job once per minute,
   reading credentials from Vault rather than embedding them in Cron text.
6. Publish the updated `website/app` assets together (`index.html`, `app.js`,
   `styles.css`, `storage-cleanup.js`). Open **Configurare admin → Spațiu & curățare**
   with an active Flowrise Admin account and verify the two measurements without
   confirming any deletion.

For CLI deployment, this repository's `db/edge-functions` directory must first
be copied into the CLI project's `supabase/functions` directory. Deploy the two
named functions individually; disable gateway JWT verification only for the new
scheduler-capable function. Follow the official
[deployment guide](https://supabase.com/docs/guides/functions/deploy) and
[Cron/Vault setup](https://supabase.com/docs/guides/functions/schedule-functions).

## Progress and recovery

The browser and scheduler advance the same job in bounded batches. Closing the
browser does not discard confirmed selections. Reopen the tab and select the
recent operation to see saved progress or retry a failure. Each batch checks that
the job's creator is still an active Flowrise Admin. Revoking that access stops
further destructive work; a different Admin cannot take over their preview.

Storage deletion precedes relational deletion. Objects are removed through the
Storage API, never by SQL deletion of `storage.objects`. Checkpoints record the
exact authorized paths; an interrupted request can resume an uncertain deletion
without touching unrelated files. A processing lease temporarily blocks edits
to that order; expired leases are recoverable.

Previously signed upload URLs can remain valid for two hours. Jobs with selected
file paths therefore show **În așteptarea verificării încărcărilor** after the
initial deletion. After two hours and five minutes, the scheduler removes late
objects at those exact recorded paths and completes reconciliation. Keep the
schedule enabled; without it, closing the browser leaves this verification pending.

Clinical cleanup increments a permanent generation token. Older open forms are
rejected on save, even after a new case has been created. A fresh form displays an
empty clinical case and can explicitly create a new one; commercial items never
automatically reconstruct a cleared case.

## Reading the graphs

Storage uses the actual object metadata across **all project buckets**, while
cleanup is limited to Flowrise work-order paths. The 100 GB quota is a configured
billing allowance, not a hard project capacity. A quota overrun remains visible;
unknown object sizes are identified as partial measurements. The separate 1 GiB
per-file upload cap is unaffected. Storage billing uses a monthly average, so
current object size is not a billing forecast.

The disk graph uses the Management API's physical filesystem total, used and
available bytes, with the reported measurement timestamp. Gray space represents
reserved capacity. Deleting SQL rows may free reusable space inside PostgreSQL
without immediately shrinking physical disk usage. This screen does not run
`VACUUM FULL` or change disk provisioning.

If the disk card is unavailable, check the Management token, project reference
and token permissions. If the entire tab fails, check the core migration and
Edge deployment. For jobs stuck awaiting reconciliation, inspect Cron run history,
Vault secret names, matching scheduler secrets and gateway JWT configuration.
Never expose secret values while collecting diagnostics.

## Local verification

Node tests cover Edge authorization, metrics, Storage batching, scheduling and
frontend behavior. PGlite integration tests execute the actual SQL for date/DST
scoping, role grants, revision changes, leases, dependent deletion, stale clinical
forms and applying the core migration twice. Desktop/mobile browser inspection
uses fictitious data. No verification step deletes production data.

```sh
node --test
node tests/sql/storage-cleanup.integration.mjs /path/to/pglite/dist/index.js
node tests/sql/storage-cleanup-clinical.integration.mjs /path/to/pglite/dist/index.js
node tests/sql/storage-cleanup-migration.integration.mjs /path/to/pglite/dist/index.js
python3 -m unittest discover -s tests/sql -p 'test_schema_idempotency.py'
node tools/build-db-apply.js --check
python3 tools/build-supabase-editor-sql.py --check
```

PGlite does not provide Supabase's hosted Cron, pg_net, Vault or Edge runtime;
their final connectivity must be verified after deployment. The separate schedule
migration keeps those project-specific integrations out of ordinary schema rebuilds.
