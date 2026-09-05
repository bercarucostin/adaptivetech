-- =====================================================================
-- documents -- chunk store for the RAG knowledge base
-- Target: PostgreSQL 15+ / Supabase, pgvector >= 0.7.0
-- Embeddings: gemini-embedding-001 @ outputDimensionality 1536,
--             L2-normalized client-side before insert.
-- =====================================================================

create extension if not exists vector;

set search_path = public;


create table public.documents (
  id            bigserial   primary key,
  content       text        not null,
  metadata      jsonb       not null default '{}'::jsonb,
  embedding     vector(1536) not null,
  -- max(createdTime, modifiedTime) of the source Drive file, as reported by
  -- the Drive API. The ingestion sync compares this against the live Drive
  -- listing to decide whether a file needs re-processing. Nullable: the
  -- expert-feedback branch writes into this table with no Drive manifest
  -- behind it, so it leaves this NULL.
  last_modified timestamptz,
  fts           tsvector generated always as
                  (to_tsvector('romanian'::regconfig, content)) stored,
  created_at    timestamptz not null default now()
) tablespace pg_default;


-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

-- Lexical branch of hybrid search.
create index documents_fts_gin
  on public.documents using gin (fts) tablespace pg_default;

-- Semantic branch. 1536 is under the 2000-dim HNSW ceiling, so this is
-- a plain vector_cosine_ops index -- no halfvec workaround needed.
-- Raise maintenance_work_mem before building on a large table.
create index documents_embedding_hnsw
  on public.documents using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64) tablespace pg_default;

-- Containment filters: metadata @> '{"file_id":"..."}'
create index documents_metadata_gin
  on public.documents using gin (metadata jsonb_path_ops) tablespace pg_default;

-- The btree indexes below are NOT redundant with the GIN above.
-- jsonb_path_ops serves @> only; it cannot serve the ->> equality and
-- NOT EXISTS predicates the ingestion sync actually issues:
--   DELETE FROM documents WHERE metadata->>'file_id' = $1
--   WHERE metadata->>'source' = 'knowledge_base' AND NOT EXISTS (...)
create index documents_file_name_idx
  on public.documents ((metadata ->> 'original_file_name')) tablespace pg_default;

create index documents_file_id_idx
  on public.documents ((metadata ->> 'file_id')) tablespace pg_default;

-- Which ingestion branch wrote the row: 'knowledge_base' or 'expert_feedback'.
-- Both branches share this table, and the sync's orphan sweep MUST stay scoped
-- to knowledge_base -- expert-feedback files live in a different Drive folder
-- and would otherwise be deleted as orphans on every run.
create index documents_source_idx
  on public.documents ((metadata ->> 'source')) tablespace pg_default;

-- Chunk-level dedupe within a file. coalesce() matters: without it,
-- rows missing original_file_name are all distinct under btree NULL
-- semantics and the constraint silently stops enforcing anything.
create unique index documents_content_file_uniq
  on public.documents (
    md5(content),
    coalesce(metadata ->> 'original_file_name', '')
  ) tablespace pg_default;
