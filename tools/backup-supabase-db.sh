#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

usage() {
  cat <<'EOF'
Usage:
  SUPABASE_DB_URL='postgresql://...' tools/backup-supabase-db.sh [output_directory]

Creates a verified custom-format PostgreSQL backup of the public schema.
The default output directory is ./backups.

Use the Session pooler connection string from Supabase Dashboard > Connect.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for command_name in pg_dump pg_restore; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: $command_name is not installed or is not in PATH." >&2
    echo "Install PostgreSQL client tools, then run this script again." >&2
    exit 1
  fi
done

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Error: SUPABASE_DB_URL is required." >&2
  usage >&2
  exit 1
fi

output_directory="${1:-backups}"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_name="flowrise-public-${timestamp}"
archive_path="${output_directory}/${backup_name}.dump"
temporary_path="${archive_path}.partial"
contents_path="${output_directory}/${backup_name}.contents.txt"
checksum_path="${archive_path}.sha256"

mkdir -p "$output_directory"

cleanup_partial() {
  rm -f "$temporary_path"
}
trap cleanup_partial EXIT INT TERM

if [[ -e "$archive_path" || -e "$temporary_path" ]]; then
  echo "Error: backup path already exists: $archive_path" >&2
  exit 1
fi

echo "Creating encrypted-permissions backup directory: $output_directory"
echo "Dumping Supabase public schema to: $archive_path"

# PGDATABASE accepts a libpq URI. Keeping it in the process environment avoids
# writing the connection string into the shell command arguments or output.
PGDATABASE="$SUPABASE_DB_URL" pg_dump \
  --format=custom \
  --compress=9 \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file="$temporary_path"

if [[ ! -s "$temporary_path" ]]; then
  echo "Error: pg_dump produced an empty archive." >&2
  exit 1
fi

pg_restore --list "$temporary_path" > "$contents_path"

if ! grep -Eq 'TABLE DATA public|TABLE public' "$contents_path"; then
  echo "Error: archive validation found no public tables." >&2
  exit 1
fi

mv "$temporary_path" "$archive_path"
trap - EXIT INT TERM

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$archive_path" > "$checksum_path"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$archive_path" > "$checksum_path"
else
  echo "Warning: neither sha256sum nor shasum is available; checksum skipped." >&2
  checksum_path=""
fi

archive_size="$(du -h "$archive_path" | awk '{print $1}')"

echo
echo "Backup completed and validated."
echo "Archive:  $archive_path ($archive_size)"
echo "Contents: $contents_path"
if [[ -n "$checksum_path" ]]; then
  echo "Checksum: $checksum_path"
fi
echo
echo "Validation command: pg_restore --list '$archive_path'"
echo "Important: this public-schema backup excludes Supabase Auth/Storage schemas and the actual Storage files."
