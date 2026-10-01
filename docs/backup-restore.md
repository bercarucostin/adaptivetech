# Supabase backup to Google Drive

The production backup is the importable n8n workflow
`workflows/Flowrise Dental - Complete Backup to Google Drive.json`. It needs no
Docker image, volume mount, host directory, or server environment variable.

Each successful run creates a dated folder in the private Google Drive folder
`1SanyMKe6-AKvzTX8hvbtbD2tkM2jc6IZ` containing:

- paginated JSON files, with at most 1,000 rows each, for every base table in
  the Supabase `public` schema;
- `auth-users.json` with recoverable user and identity metadata;
- `storage-manifest.json` with bucket configuration, object metadata, original
  paths, and the generated Drive filename for every object;
- every Storage object as a numbered binary file;
- `_BACKUP_COMPLETE.json`, written only after every preceding upload succeeds.

Database schema, functions, triggers, RLS policies, Edge Functions, frontend,
and n8n workflows are restored from Git. Password hashes, active Auth sessions,
and refresh tokens are intentionally excluded. After a standalone JSON restore,
users must reset their passwords. Supabase's native database backup remains the
preferred way to restore Auth without that reset. Supabase database backups do
not include Storage object bytes.

## n8n credentials

Create or select these three credentials in n8n. Do not put their values in the
workflow export, Git, or chat.

1. **Postgres** for the Supabase database. Use the direct connection or Session
   Pooler on port 5432, database `postgres`, the `postgres.PROJECT_REF` user when
   required by the pooler, SSL enabled, and the database password.
2. **Supabase API** with the project URL and the Secret key (or legacy
   `service_role` key). This credential is used only to download private Storage
   objects and automatically sends both required headers.
3. **Google Drive OAuth2**, connected to the account that owns the private
   backup folder.

## Activation

1. Import `workflows/Flowrise Dental - Complete Backup to Google Drive.json`.
2. The workflow already contains the nonsecret project URL
   `https://qlynvfltjgjgeipndior.supabase.co`.
3. Select the Postgres credential in every Postgres node, the Supabase API
   credential in **Download storage objects**, and the Google Drive credential
   in every Google Drive node.
4. Leave the workflow unpublished and run **Manual test**.
5. Confirm that the resulting folder has a final name such as
   `flowrise-supabase-20260927T020000Z`, contains `_BACKUP_COMPLETE.json`, one
   one or more files for every public table, `auth-users.json`, `storage-manifest.json`, and
   the number of Storage files declared by both manifests.
6. Download a sample table JSON and several Storage files. Compare row counts,
   file sizes, and original paths with Supabase.
7. Publish the workflow only after the manual run is complete. It runs daily at
   02:00 Europe/Bucharest.

The workflow keeps two complete copies. Before a new backup it permanently
deletes complete copies older than the newest one and incomplete folders older
than six hours. Unrelated Drive files and a possibly active incomplete folder
are ignored. Before creating a folder, it estimates the public database and
Storage size and stops above 4 GiB so two copies stay below the reserved 8 GiB
budget in the 10 GB account.

## Restore drill

Perform the first drill in a separate Supabase project:

1. Apply the SQL schema and functions from Git.
2. Import table files in dependency order. Disable or defer foreign-key checks
   only in the isolated restore environment, then validate all constraints.
3. Recreate Storage buckets using `storage-manifest.json`.
4. For every manifest entry, upload its numbered Drive file to the recorded
   bucket and original object path. Verify the recorded metadata and size.
5. Recreate Auth users from `auth-users.json` through the supported Admin API
   and issue password-reset links. Do not insert active sessions or tokens.
6. Verify representative users, cases, work orders, chat attachments, and case
   files. Record the archive name, date, counts, discrepancies, and duration.

A green n8n execution proves that files were uploaded. Production readiness
requires a successful isolated restore drill and monitoring for a missed daily
execution.
