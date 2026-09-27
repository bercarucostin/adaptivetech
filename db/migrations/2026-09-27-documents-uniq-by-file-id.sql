-- =====================================================================
-- documents_content_file_uniq: key chunk dedupe on file_id, not file name.
--
-- The old key, md5(content) + original_file_name, silently dropped the
-- chunks of a second file with the same name and identical content -- the
-- ingestion INSERT is ON CONFLICT DO NOTHING. The knowledge base now holds
-- the same document in several machine folders, so the key has to be the
-- Drive file. original_file_name stays as the fallback for any row without
-- a file_id.
--
-- Run once against the production database before importing the updated
-- ingestion workflow. Safe to re-run.
--
-- PRE-CHECK -- run this first; it must return no rows:
--
--   select md5(content),
--          coalesce(metadata ->> 'file_id', metadata ->> 'original_file_name', '') as k,
--          count(*)
--   from public.documents
--   group by 1, 2
--   having count(*) > 1;
--
-- The new key is stricter than the old one for rows that share a file_id
-- under two different names (a file renamed without its old rows being
-- deleted). Any row it returns would make the CREATE below fail. Decide per
-- row which copy to keep before running this migration.
--
-- The swap runs in one transaction: if the CREATE fails, the DROP rolls
-- back with it and the old index stays in place.
-- =====================================================================

begin;

drop index if exists public.documents_content_file_uniq;

create unique index documents_content_file_uniq
  on public.documents (
    md5(content),
    coalesce(metadata ->> 'file_id', metadata ->> 'original_file_name', '')
  ) tablespace pg_default;

commit;
