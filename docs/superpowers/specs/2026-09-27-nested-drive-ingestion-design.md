# Nested-folder knowledge-base ingestion — design

Date: 2026-09-27
Scope: [workflows/ingestion.json](../../../workflows/ingestion.json) (knowledge-base branch only),
[workflows/agent.json](../../../workflows/agent.json) (two prompt rules),
[db/documents.sql](../../../db/documents.sql), and three new modules under `lib/`.

## Context

The knowledge-base sync lists one flat Drive folder (`documentation`, `1-y3bvqtTXEj2Vyl-lC5Em6aISbtqCcbm`)
and `Build Drive Manifest` discards every subfolder. The knowledge base is moving to a new root,
[`1g7SDhQdmKB-MVs5R21gZypwpKLPzee0q`](https://drive.google.com/drive/folders/1g7SDhQdmKB-MVs5R21gZypwpKLPzee0q),
which holds its documents in subfolders:

| Subfolder | Meaning |
|---|---|
| `DOCUMENTATIE COMUNA` | True for every machine |
| `PARTNER 200`, `PARTNER 300`, `PARTNER 600`, `PARTNER PF 80K`, `PARTNER TOUCH EVO` | Strictly about that machine |
| `TASTATURI VIRTUALE` | Virtual keyboards (an accessory, not a machine) |

Pointed at this root today, the sync would find zero files and stop at its empty-listing guard.
Nothing would be wiped, and nothing would be ingested.

The subfolder carries meaning the documents do not. A Partner 600 procedure retrieved for a
Partner 200 question is a wrong answer. So each chunk must say which subfolder it came from.

Facts established by reading the Drive folder rather than assumed:

- **Nesting is one level deep today.** Nothing guarantees it stays that way.
- **The same document exists in two subfolders.** "intervale serii care functioneaza cu memorii
  fiscale FLASH" (3347 bytes) sits in both `PARTNER 200` and `PARTNER 600`. The current unique
  index, `md5(content) + original_file_name` with `ON CONFLICT DO NOTHING`, would silently drop
  the second copy's chunks.
- **The root contains Google Slides (4) and Sheets (1).** `Download Knowledge Base File` only
  converts Docs to PDF. Slides and Sheets fall back to pptx/xlsx, which Gemini `inline_data` does
  not accept.
- **The largest file is fine.** The 22 MB Slides deck "Indrumar complet Update FW si conectare"
  exports to a 2.95 MB, 13-page PDF. That is well under Drive's ~10 MB export cap and Gemini's
  inline limit. No large-file path is needed.

Also, one failing file currently aborts the whole run. Moving to the new root means ingesting
about 30 files at once, and one bad file would block every file queued after it.

### Deliberately out of scope

- **Hard retrieval filtering by machine.** Chunks are labelled, and the folder is stored in
  metadata, but `hybrid_search` is not given a machine filter. A later change can add one using the
  existing `filter` parameter, and no re-ingestion will be needed.
- **`.docx`, `.xlsx`, `.pptx`, images and other uploaded non-Google files.** They are logged as
  unsupported and skipped.
- **Failure bookkeeping.** There is no failure-state table. A file that keeps failing is retried,
  and reported, on every run until someone fixes it. This is accepted.
- **Heading hierarchy and LLM-generated chunk context.** The extraction prompt only emits `##`,
  and each chunk already carries its folder, title and section.
- **The expert-feedback branch.** It is unchanged.

## Listing the tree

New flow for the knowledge-base branch:

```
Sync Trigger → Drive: All Folders → Build Folder Tree → Drive: Knowledge Base
            → Build Drive Manifest → Sync Check → Process One File → …
```

### `Drive: All Folders` (new)

Google Drive v3 node, search in query mode:

- query `mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
- Return All on;
- fields `*`. The node's field picker has no `parents` option, and `*` includes it;
- `alwaysOutputData: true`, so an account with no folders still reaches `Build Folder Tree`.

It lists every folder the credential can see, not only the ones under the root. At the current
account size, that is acceptable.

### `Build Folder Tree` (new Code node, logic in `lib/drive-tree.js`)

The module is pasted into the node verbatim, the same way `lib/sync-batch.js` is, and is unit
tested.

- **Root:** a constant, `KB_ROOT_ID = '1g7SDhQdmKB-MVs5R21gZypwpKLPzee0q'`.
- **Input:** items without an `id` are ignored. These are the empty item that `alwaysOutputData`
  emits.
- **Walk:** from the root, follow `parents` downward and collect every descendant folder at any
  depth. A visited set guards against cycles. Folders outside the root are ignored.
- **Per folder:** record `{ label, path }`.
  - `label` is the name of the root's direct child that the folder sits under, e.g. `PARTNER 600`.
  - `path` is the `/`-joined names from that child down, e.g. `PARTNER 600/Service`.
- **Output:** one item, `{ query, folders }`.
  - `folders` maps folder ID to `{ label, path }`.
  - `query` is
    `('<root>' in parents or '<f1>' in parents or …) and trashed = false and mimeType != 'application/vnd.google-apps.folder'`.
- **Guard:** more than 150 descendant folders throws, with a message saying the Drive query would
  be too long. That is far beyond current needs.

### `Drive: Knowledge Base` (changed)

Switched from folder mode to query mode, with `={{ $json.query }}`. Return All stays on, and fields
stay `*` (the timestamps depend on it).

## Manifest and sync check

### `Build Drive Manifest` (changed, logic moved to `lib/drive-manifest.js`)

The logic is pasted into the node verbatim and unit tested. Changes from today:

- **Folder:** each file gets `folder` and `folder_path` from `$('Build Folder Tree').first().json.folders`,
  keyed by the file's parent. A file directly in the root gets `''` for both.
- **MIME allowlist:** only these are kept:
  - `application/pdf`;
  - `application/vnd.google-apps.document`;
  - `application/vnd.google-apps.presentation`;
  - `application/vnd.google-apps.spreadsheet`.
  
  Everything else, shortcuts included, is left out. Each skipped file is logged as
  `unsupported type <mime>: <path>/<name>`. An excluded file is not in the manifest, so any rows it
  had are removed by the orphan sweep.
- **Zero-files guard:** unchanged. It now counts files after the allowlist is applied.
- **Run failure list:** the list of failed files for this run is reset (see
  [Per-file failures](#per-file-failures)).

The manifest recordset gains `folder text, folder_path text`.

### `Sync Check` SQL (changed)

- **`kb` CTE:** also selects `max(metadata->>'folder_path') AS folder_path`.
- **Re-process condition:** a file is re-processed when any of these holds:
  - `kb.file_id IS NULL` (new file);
  - `kb.last_modified IS DISTINCT FROM drive.last_modified` (edited);
  - `coalesce(kb.folder_path, '') IS DISTINCT FROM drive.folder_path` (moved).

  A move in Drive does not change `modifiedTime`. Without the third condition, a file moved from
  `PARTNER 200` to `DOCUMENTATIE COMUNA` would keep its old label indefinitely.
- **Output:** also returns `folder` and `folder_path`.
- **Order:** adds `ORDER BY drive.last_modified, drive.file_id`, so the processing order is the
  same on every run.
- **Unchanged:** the orphan sweep (keyed on `file_id`, limited to `source = 'knowledge_base'`).

## Download and extraction

- **`Download Knowledge Base File`:** `googleFileConversion` adds `slidesToFormat` and
  `sheetsToFormat` set to `application/pdf`, next to the existing `docsToFormat`.
- **Passing the folder along:**
  - `Prepare Gemini Request` reads `folder` and `folder_path` from the `Process One File` row, the
    same way it already reads `last_modified`.
  - `Format Gemini Result` passes them on to `Preparing Chunks`.

## Chunking

### `Preparing Chunks` (changed, logic moved to `lib/chunking.js`)

The logic is pasted into the node verbatim and unit tested. Constants:

| Name | Value | Meaning |
|---|---|---|
| `WORD_LIMIT` | 350 | Max words per chunk. Today's `TOKEN_LIMIT`, renamed because it counts words |
| `OVERLAP_WORDS` | 75 | Words carried into the next chunk of the same section |
| `WHOLE_DOC_WORDS` | 800 | Documents at or under this are one chunk |
| `MIN_SECTION_WORDS` | 60 | Sections under this merge into their neighbour |
| `EMBED_BATCH_SIZE` | 100 | Unchanged |

Per document:

1. **Short document:** if the extracted text is `WHOLE_DOC_WORDS` or fewer, the whole text is one
   chunk, with `section_heading = title`. Most documents in this corpus are short procedures, and
   retrieval should return a procedure whole rather than only one of its sections.
2. **Split into sections:** otherwise, split on `## ` headings, as today.
3. **Merge tiny sections:** a section under `MIN_SECTION_WORDS` merges into the *next* section, and
   the headings are joined as `A / B`. A small *last* section merges into the previous one instead.
4. **Pack lines:** each section is filled with whole lines, keeping the `\n` between them, until
   the next line would exceed `WORD_LIMIT`.
   - The next chunk starts with the trailing lines of the previous one, up to `OVERLAP_WORDS`
     words in total.
   - A single line longer than `WORD_LIMIT` is split into words, in windows of `WORD_LIMIT` that
     advance by `WORD_LIMIT - OVERLAP_WORDS`.
   - Line breaks survive. A numbered procedure stays one step per line and is no longer flattened
     into a single line.
5. **Label the chunk:**
   - Stored content: `[<folder>] <title> — <heading>\n\n<chunk>` when `folder` is non-empty, and
     `<title> — <heading>\n\n<chunk>` otherwise.
   - Embedding `title` field: `<folder> — <title> — <heading>`, or `<title> — <heading>` when
     there is no folder.
6. **Deduplicate:** by content within the file, as today.
   - **Title:** strip only a known file extension (`.pdf`, `.doc(x)`, `.ppt(x)`, `.xls(x)`) from
     the file name. Today's `/.[^.]+$/` turns the Google Doc "Instructiuni update firmware
     P200-300-600 19.01.2026" into "… 19.01". Google-native files have no extension.
7. **Empty result:** zero chunks throws `no chunkable text in "<name>"`. Otherwise an empty output
   would stop the loop without reaching `Process One File` again, and the rest of the batch would
   be skipped silently.

The label is part of the stored `content`. So it reaches the semantic branch, the full-text branch,
`hybrid-search-tool`'s `[Source: …]` blocks and the agent's pre-retrieval without any retrieval
change.

### `Format for Insert` (changed)

- **Metadata:** gains `folder` and `folder_path`. Everything else is unchanged:
  - `file_id`, `original_file_name`, `section_heading`, `chunk_index`;
  - `source: 'knowledge_base'`;
  - the `DELETE … WHERE metadata->>'file_id'` before the first insert.

## Database

### Unique index

Replace `documents_content_file_uniq` so that it is keyed on `file_id`:

```sql
drop index if exists public.documents_content_file_uniq;
create unique index documents_content_file_uniq
  on public.documents (
    md5(content),
    coalesce(metadata ->> 'file_id', metadata ->> 'original_file_name', '')
  ) tablespace pg_default;
```

- **Expert-feedback rows** already carry `file_id`, so they keep working.
- **Why:** with the old key, identical content in two files with the same name would be silently
  dropped. The folder prefix already separates the FLASH document's two copies. This fix closes the
  same-name, same-folder case too.
- **Where:** `db/documents.sql` is updated to match, and the migration ships as
  `db/migrations/2026-09-27-documents-uniq-by-file-id.sql`.

### Atomic per-file replace (already true; must stay that way)

Verified against the n8n 2.28.3 Postgres node source (`nodes/Postgres/v2/helpers/utils.ts`):

- **How it works:** `Insert Into Postgres Knowledge Base` uses the default `queryBatching`,
  `single`. It joins every incoming item's query into one multi-statement string
  (`pgp.helpers.concat`) and sends it in one round trip.
  - PostgreSQL runs a multi-statement simple query as one implicit transaction.
  - So a file's `DELETE` and all of its `INSERT`s already commit together or not at all.
- **On failure** with continue-on-error, `single` mode returns exactly **one** error item and
  nothing on the success output. The error path below relies on this.
- **`queryBatching` must not be set to `transaction`.** In that mode, a failing statement is
  caught inside the transaction callback, which then returns normally. PostgreSQL rolls the aborted
  transaction back, but the node still emits success items for the statements before the failure,
  plus an error item. Both outputs would fire for one file.
- **Guard:** a workflow test pins `queryBatching` to absent or `single`.

## Per-file failures

A failing file is skipped and reported. It does not abort the batch. Reporting goes through the
existing `errorWorkflow` (`error-handling-ingestion`), which already emails the team.

- **Error outputs:** these seven nodes in the per-file chain get `onError: 'continueErrorOutput'`:
  - `Download Knowledge Base File`;
  - `Prepare Gemini Request`;
  - `Gemini Text Extraction`;
  - `Format Gemini Result`;
  - `Preparing Chunks`;
  - `Format for Insert`;
  - `Insert Into Postgres Knowledge Base`.

  Each node's error output connects to `Note Failure`. Each of these nodes handles the whole file
  as a single unit, or runs once for all of the file's items. So a failure never sends the same
  file down both the success and error outputs.
- **`Generate Embeddings` is the exception.** It gets `onError: 'continueRegularOutput'`.
  - It runs once per embedding batch, so a file over 100 chunks could have one batch succeed and
    another fail. With `continueErrorOutput`, both outputs would fire for the same file.
  - With `continueRegularOutput`, a failed batch arrives at `Format for Insert` as an item without
    `embeddings`. `Format for Insert` already throws on that ("Embedding API error for batch i"),
    and its error output routes the file to `Note Failure` exactly once.
- **`Note Failure` (new Code node, run once for all items):**
  - appends `{ name, folder_path, error }` to `$getWorkflowStaticData('global').kbFailures`. The
    file identity comes from `$('Process One File').first().json`, since the loop takes one file
    per batch;
  - then returns one item, and its output connects back to `Process One File`, so the loop moves
    on.
- **Reset:** `Build Drive Manifest` sets `kbFailures = []` at the start of each run, so failures
  from earlier runs never carry over.
- **`Check Failures` (new Code node):** it is connected to the `done` output of `Process One File`.
  - If `kbFailures` is empty, it returns a single item, `{ ok: true }`. It does not pass on the
    items `done` collects from the loop. The run succeeds.
  - Otherwise it throws one error listing every failed file (`<folder_path>/<name>: <error>`,
    one per line). The run ends failed after every good file has been ingested, `errorWorkflow`
    fires, and the team gets one email per run naming all the failures.

Retries are implicit. A failed file was never written, or its implicit transaction rolled back, so the next
run's `Sync Check` still sees it as new or changed and picks it up again.

Failures in listing, the tree or the manifest still abort the run immediately, as today. These
include a bad credential, zero files and too many folders.

## Agent prompts

Two existing product-matching rules are extended with the same text. No new rule is added.

- `Build Prompt` rule 3;
- `AI Agent1` rule 4.

Text appended to each:

> Each document begins with the folder it came from in square brackets, e.g. [PARTNER 200]. A
> document from a machine's folder applies only to that machine — never apply it to another
> machine. [DOCUMENTATIE COMUNA] applies to all machines.

## Verification

### Unit tests (`node:test`)

- **`tests/drive-tree.test.js`:**
  - nested folders at depth 1 and depth 3 get the top-level label and the full path;
  - folders outside the root are ignored;
  - a parent cycle ends;
  - 151 folders throws;
  - the query string has the exact format.
- **`tests/drive-manifest.test.js`:**
  - `folder` and `folder_path` are attached, with `''` for root files;
  - allowlisted types are kept, and a shortcut and a `.docx` are skipped;
  - the zero-files guard throws;
  - the SQL contains the `folder_path IS DISTINCT FROM` condition and the `ORDER BY`;
  - `kbFailures` is reset.
- **`tests/chunking.test.js`:**
  - a numbered procedure keeps its `\n`;
  - a 700-word document with three `##` sections is one chunk;
  - a 20-word section merges into the next one with a joined heading, and a small last section
    merges into the previous one;
  - a 1000-word single line splits into word windows with 75-word overlap;
  - the `[FOLDER]` prefix and embedding title are right, with no prefix for root files;
  - zero chunks throws.

### Workflow tests

**`tests/ingestion-workflow.test.js`:**
- the listing chain is wired in order;
- the three `lib/` modules are pasted into their nodes verbatim;
- `KB_ROOT_ID` is the new root;
- the seven per-file nodes have `continueErrorOutput`, and their error outputs reach
  `Note Failure`;
- `Generate Embeddings` has `continueRegularOutput`;
- `Note Failure` loops back to `Process One File`;
- `done` reaches `Check Failures`;
- the Insert node's `queryBatching` is absent or `single`, and never `transaction`;
- the Slides and Sheets PDF conversions are set.

**`tests/agent-workflow.test.js`:** the folder sentence is present in both `Build Prompt` and
`AI Agent1`.

### Manual, after the first run

- **Folders:** `select metadata->>'folder', count(*) from documents where metadata->>'source' = 'knowledge_base' group by 1`.
  Every subfolder with a supported file appears.
- **Duplicate document:** the FLASH document has chunks under both `PARTNER 200` and `PARTNER 600`.
- **Line breaks:** a procedure's chunk shows one step per line.
- **Answers:** the same question asked about Partner 200 and then Partner 600 gets machine-correct
  answers.

## Rollout

- **Precondition:** anything in the old `documentation` folder that should stay must be copied
  into the new root first. The first run's orphan sweep deletes every row whose file is not under
  the new root.

1. **Index:** apply `db/migrations/2026-09-27-documents-uniq-by-file-id.sql`.
2. **Import:** import the updated `ingestion.json` and `agent.json` with the ingestion `Sync Trigger`
   **deactivated**.
3. **First run:** run the sync once by hand, off-hours.
   - It sweeps the old rows and re-ingests about 30 files, likely taking 15–40 minutes, and the
     knowledge base is thin in the meantime.
   - Running it by hand also keeps a scheduled run from starting on top of it and processing the
     same files twice.
4. **Check and activate:** run the manual checks, then reactivate `Sync Trigger`.
