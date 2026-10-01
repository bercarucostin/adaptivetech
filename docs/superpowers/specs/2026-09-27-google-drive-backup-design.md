# Google Drive Backup Design

## Outcome

Create a daily, recoverable export of the Flowrise Supabase data set and store it in the existing private Google Drive folder. A backup contains every `public` table, recoverable Auth user and identity metadata, every Supabase Storage bucket and object, and completion metadata. The n8n instance is restored from Git and is outside this backup's scope.

## Architecture

An importable n8n workflow runs daily at 02:00 Europe/Bucharest and also has a manual trigger. It connects directly to Supabase PostgreSQL, generates paginated JSON files of at most 1,000 rows for every public table, exports supported Auth metadata, enumerates Storage from `storage.objects`, downloads every object with a Supabase API credential, and uploads the result to Google Drive folder `1SanyMKe6-AKvzTX8hvbtbD2tkM2jc6IZ`.

Each run starts in an `incomplete` folder. The workflow writes `_BACKUP_COMPLETE.json` and renames the folder only after every upload succeeds. It retains two complete copies and refuses an estimated backup above 4 GiB, reserving up to 8 GiB of the 10 GB account. Google Drive, Supabase Postgres, and Supabase API credentials are selected after import and are never committed.

## Security and failure behavior

- No backup service, Docker mount, host directory, server environment variable, or shell command is required.
- n8n successful execution payloads are not retained. Secrets remain in n8n credentials and are absent from the workflow export.
- Password hashes, active sessions, and refresh tokens are excluded. A standalone JSON restore requires password resets; Supabase native backups remain the preferred Auth recovery path.
- Drive stores ordinary JSON and binary files in a Restricted folder. This design relies on Google Drive encryption at rest and account MFA; it is not client-side encrypted.
- A failed upload leaves an `incomplete` folder without a completion marker. Stale incomplete folders are removed after six hours.
- Retention permanently deletes only managed backup folders, preserves the newest complete copy before upload, and never touches unrelated files.
- Online backups are not cross-service point-in-time snapshots. A quiesced one-shot backup is required before risky migrations.
- A successful upload does not prove recovery. Production readiness requires an isolated restore drill and an independent dead-man monitor.

## Deployment constraints

The n8n Google OAuth app must be published beyond Google OAuth Testing before unattended use because Testing refresh tokens expire. The Drive folder stays Restricted. Operators configure a Supabase Postgres credential, Supabase API credential, and Google Drive credential inside n8n. No server change or secret in Git is required.
