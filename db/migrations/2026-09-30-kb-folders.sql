-- =====================================================================
-- kb_folders: shared / product kind of each top-level knowledge base folder.
--
-- Run once against the production database before importing the updated
-- ingestion and agent workflows. Safe to re-run. The next ingestion run
-- fills the table; until then the agent treats every folder as a product
-- folder.
-- =====================================================================

create table if not exists public.kb_folders (
  folder      text        primary key,
  kind        text        not null check (kind in ('shared', 'product')),
  decided_by  text        not null check (decided_by in ('drive', 'llm', 'manual')),
  decided_at  timestamptz not null default now()
);
