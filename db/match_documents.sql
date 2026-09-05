-- =====================================================================
-- match_documents -- pure-semantic search over the chunk store.
-- Kept for compatibility with the LangChain / n8n Supabase vector-store
-- node, which calls this exact signature. Nothing in this repository
-- calls it; hybrid_search() is what the retrieval tool uses.
-- Run after documents.sql.
-- =====================================================================

create or replace function public.match_documents (
  query_embedding vector(1536),
  match_count     int   default null,
  filter          jsonb default '{}'::jsonb
)
returns table (
  id         bigint,
  content    text,
  metadata   jsonb,
  similarity float
)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    jsonb_build_object('title', metadata->>'original_file_name') as metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;
