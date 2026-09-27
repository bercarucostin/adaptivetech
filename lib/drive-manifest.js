'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Drive Manifest" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

// Dollar-quoting: SQL-injection-proof escaping for PostgreSQL.
function dollarQuote(s) {
  let tag = 'q';
  while (s.includes('$' + tag + '$')) tag += '_';
  return '$' + tag + '$' + s + '$' + tag + '$';
}

const MANIFEST_FOLDER_MIME = 'application/vnd.google-apps.folder';

// What the extraction path can read: PDFs as-is, Google files exported to PDF
// by Download Knowledge Base File. Anything else never reaches Gemini.
const SUPPORTED_MIME = [
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
];

// Turns the Drive file listing into the manifest the sync compares against
// the database. `folders` is Build Folder Tree's { <folderId>: { label, path } };
// a file whose parent is not in it sits directly in the root and gets ''.
// Returns { manifest, skipped }: manifest rows are
// { file_id, file_name, last_modified, folder, folder_path }, where
// last_modified is max(createdTime, modifiedTime) as reported by Drive.
function buildManifest(files, folders) {
  const manifest = [];
  const skipped = [];
  for (const f of files || []) {
    if (!f || !f.id || f.mimeType === MANIFEST_FOLDER_MIME || f.trashed === true) continue;

    const parent = (f.parents || []).find((p) => folders && folders[p]);
    const where = parent ? folders[parent] : { label: '', path: '' };
    const name = f.name || f.id;

    if (!SUPPORTED_MIME.includes(f.mimeType)) {
      skipped.push({ mimeType: f.mimeType || 'unknown', path: (where.path ? where.path + '/' : '') + name });
      continue;
    }

    const created = f.createdTime || null;
    const modified = f.modifiedTime || null;
    if (!created && !modified) {
      throw new Error('Drive file "' + name + '" returned neither createdTime nor modifiedTime. Set the Google Drive node option Fields to [All] — without it the API omits both timestamps and every file would look changed on every run.');
    }
    const last = (created && modified)
      ? (new Date(modified) > new Date(created) ? modified : created)
      : (modified || created);

    manifest.push({
      file_id: f.id,
      file_name: name,
      last_modified: last,
      folder: where.label,
      folder_path: where.path,
    });
  }

  // An empty listing is far likelier to be an API or permission failure than a
  // genuinely empty folder, and the sweep would delete every knowledge_base
  // row. Refuse rather than wipe the knowledge base.
  if (manifest.length === 0) {
    throw new Error('Drive listing returned 0 usable files for the knowledge base folder tree. Refusing to run the orphan sweep, which would delete every knowledge_base row. Check the Drive credential, the root folder ID, and that "Return All" is enabled.');
  }
  return { manifest, skipped };
}

// One SQL statement that sweeps orphaned rows and returns the files still
// needing (re)processing.
//
// NOT EXISTS rather than NOT IN: NOT IN against a set containing any NULL
// evaluates to NULL and would silently delete nothing.
// IS DISTINCT FROM rather than <>: last_modified is nullable, and <> against
// NULL yields NULL, which would mark a file up-to-date and never reprocess it.
// folder_path: moving a file in Drive does not change modifiedTime, so a moved
// file is only caught by comparing where it was ingested from.
// All CTEs read one snapshot, so the DELETE in `orphans` does not perturb what
// `kb` sees; the work list is still computed against pre-delete state.
function buildSyncQuery(manifest) {
  return [
    'WITH drive AS (',
    '  SELECT * FROM jsonb_to_recordset(' + dollarQuote(JSON.stringify(manifest)) + '::jsonb)',
    '    AS x(file_id text, file_name text, last_modified timestamptz, folder text, folder_path text)',
    '),',
    'kb AS (',
    "  SELECT metadata->>'file_id' AS file_id, max(last_modified) AS last_modified,",
    "         max(metadata->>'folder_path') AS folder_path",
    '  FROM documents',
    "  WHERE metadata->>'source' = 'knowledge_base'",
    '  GROUP BY 1',
    '),',
    'orphans AS (',
    '  DELETE FROM documents d',
    "   WHERE d.metadata->>'source' = 'knowledge_base'",
    "     AND NOT EXISTS (SELECT 1 FROM drive WHERE drive.file_id = d.metadata->>'file_id')",
    '  RETURNING 1',
    ')',
    'SELECT drive.file_id AS id, drive.file_name AS name, drive.last_modified,',
    '       drive.folder, drive.folder_path',
    'FROM drive',
    'LEFT JOIN kb ON kb.file_id = drive.file_id',
    'WHERE kb.file_id IS NULL',
    '   OR kb.last_modified IS DISTINCT FROM drive.last_modified',
    "   OR coalesce(kb.folder_path, '') IS DISTINCT FROM drive.folder_path",
    'ORDER BY drive.last_modified, drive.file_id',
  ].join('\n');
}
// ---8<--- SHARED END ---8<---

module.exports = { buildManifest, buildSyncQuery, dollarQuote, SUPPORTED_MIME };
