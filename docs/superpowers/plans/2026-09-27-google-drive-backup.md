# n8n-only Supabase Backup Implementation Plan

**Goal:** Export Supabase application data and Storage to Google Drive every day using only n8n.

**Architecture:** An importable n8n workflow connects directly to Supabase PostgreSQL and Storage, uploads a structured backup folder to Google Drive, marks completion, and prunes old managed folders.

**Spec:** `docs/superpowers/specs/2026-09-27-google-drive-backup-design.md`

## Constraints

- No Docker image, host volume, server environment variable, or shell command.
- No credential value in the workflow export, Git, or documentation.
- Discover future `public` tables, Storage buckets, and Storage objects automatically.
- Keep two complete backups within the estimated 8 GiB budget.
- Do not mark a folder complete until all uploads succeed.
- Restore schema and automation code from Git.
- Exclude password hashes, sessions, and refresh tokens; document the password-reset requirement.

## Tasks

- [x] Remove the server-side backup runner and Compose wiring.
- [x] Add the inactive daily/manual n8n workflow.
- [x] Export every `public` table to JSON pages of at most 1,000 rows.
- [x] Export supported Auth users and identities without authentication secrets.
- [x] Export Storage bucket/object metadata and every object byte stream.
- [x] Add incomplete/final folder states, completion manifest, capacity guard, and bounded retention.
- [x] Add workflow contract tests and operator documentation.
- [ ] Configure the three credentials in n8n and run the first manual backup.
- [ ] Complete and record an isolated restore drill before the next client deployment.
