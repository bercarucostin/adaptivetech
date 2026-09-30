-- =====================================================================
-- kb_folders -- whether each top-level knowledge base folder applies to
-- every product ('shared') or to one ('product').
--
-- Written by the ingestion workflow: a '#shared' / '#product' tag in the
-- Drive folder description wins ('drive'); otherwise a new folder is
-- classified once by an LLM ('llm'), and an LLM answer never overwrites a
-- row. 'manual' is for rows edited by hand here; ingestion never writes it.
-- Read by the agent on every message. Files at the root of the knowledge
-- base (no folder) are always shared and get no row.
-- Run after documents.sql.
-- =====================================================================

create table if not exists public.kb_folders (
  folder      text        primary key,
  kind        text        not null check (kind in ('shared', 'product')),
  decided_by  text        not null check (decided_by in ('drive', 'llm', 'manual')),
  decided_at  timestamptz not null default now()
);
