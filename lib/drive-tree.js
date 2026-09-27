'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Folder Tree" Code node in workflows/ingestion.json.
// tests/ingestion-workflow.test.js fails if the two drift apart.

const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Every folder adds one "'<id>' in parents" clause to the Drive query. 150
// clauses keep it well inside Drive's query length limit.
const MAX_FOLDERS = 150;

// Walks a flat Drive folder listing down from rootId, to any depth.
// Returns:
//   folders: { <folderId>: { label, path } } for every folder under the root.
//            label = name of the root's direct child the folder sits under
//            (the machine, e.g. "PARTNER 600"); path = '/'-joined names from
//            that child down (e.g. "PARTNER 600/Service").
//   query:   the Drive query listing every non-folder directly in the root or
//            in any of those folders.
function buildFolderTree(listing, rootId) {
  const children = new Map();
  for (const f of listing || []) {
    if (!f || !f.id) continue;
    if (f.mimeType && f.mimeType !== FOLDER_MIME) continue;
    for (const parent of f.parents || []) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(f);
    }
  }

  const folders = {};
  // The visited set is what stops a parent cycle from looping forever.
  const visited = new Set([rootId]);
  const queue = (children.get(rootId) || [])
    .map((f) => ({ folder: f, label: f.name, path: f.name }));
  while (queue.length) {
    const { folder, label, path } = queue.shift();
    if (visited.has(folder.id)) continue;
    visited.add(folder.id);
    folders[folder.id] = { label, path };
    for (const child of children.get(folder.id) || []) {
      queue.push({ folder: child, label, path: path + '/' + child.name });
    }
  }

  const ids = Object.keys(folders);
  if (ids.length > MAX_FOLDERS) {
    throw new Error('The knowledge base root has ' + ids.length + ' subfolders; the limit is ' +
      MAX_FOLDERS + '. Each one adds a clause to the Drive query, which would grow too long ' +
      'for Drive to accept. Flatten the folder tree or raise MAX_FOLDERS after testing a query ' +
      'of that size.');
  }

  const parents = [rootId].concat(ids).map((id) => "'" + id + "' in parents").join(' or ');
  const query = '(' + parents + ') and trashed = false and mimeType != \'' + FOLDER_MIME + '\'';
  return { query, folders };
}
// ---8<--- SHARED END ---8<---

module.exports = { buildFolderTree, MAX_FOLDERS, FOLDER_MIME };
