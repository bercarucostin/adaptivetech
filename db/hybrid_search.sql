-- =====================================================================
-- hybrid_search -- pgvector ANN + Postgres FTS, fused with RRF
-- Run after documents.sql.
--
-- Return columns are id / content / metadata / similarity, which is what
-- the n8n Supabase vector-store node and LangChain both expect by name.
-- Adding a parameter later creates an OVERLOAD, not a replacement, and
-- makes existing 7-arg calls ambiguous -- drop the old one first if you
-- ever need to. (Changing a parameter's typmod is safe: Postgres ignores
-- typmods in function identity, and does not enforce them either -- the
-- column type is the real dimension guard.)
-- =====================================================================

create or replace function public.hybrid_search(
  query_text        text,
  query_embedding   vector(1536),
  filter            jsonb            default '{}'::jsonb,
  match_count       integer          default 10,
  semantic_weight   double precision default 0.5,
  full_text_weight  double precision default 0.5,
  rrf_k             integer          default 50
)
returns table (
  id         bigint,
  content    text,
  metadata   jsonb,
  similarity float
)
language plpgsql
stable
parallel safe
set search_path = public
as $$
declare
  -- Parsed once, not once per row three times over.
  -- The config MUST match documents.fts -- a 'simple' query against a
  -- 'romanian' index silently returns almost nothing.
  ts_query tsquery := websearch_to_tsquery('romanian', coalesce(query_text, ''));

  n     integer := greatest(coalesce(match_count, 10), 1);
  -- Candidate pool per branch. Never smaller than match_count.
  pool  integer := least(greatest(n * 4, 50), 500);

  k     integer          := greatest(coalesce(rrf_k, 50), 1);
  w_sem double precision := coalesce(semantic_weight, 0);
  w_fts double precision := coalesce(full_text_weight, 0);

  unfiltered boolean := filter is null or filter = '{}'::jsonb;
begin
  return query
  -- Semantic branch: top-`pool` ids by cosine distance. The LIMIT sits
  -- inside the subquery so the HNSW scan can stop early -- ranking with
  -- row_number() over the whole match set would force a sort of every
  -- filtered row before the limit applies.
  with semantic as (
    select
      c.doc_id,
      row_number() over (order by c.dist, c.doc_id) as rank_ix
    from (
      select
        d.id                            as doc_id,
        d.embedding <=> query_embedding as dist
      from documents d
      where unfiltered or d.metadata @> filter
      order by d.embedding <=> query_embedding
      limit pool
    ) c
  ),
  -- Lexical branch: top-`pool` ids by ts_rank.
  full_text as (
    select
      c.doc_id,
      row_number() over (order by c.ts_score desc, c.doc_id) as rank_ix
    from (
      select
        d.id                     as doc_id,
        ts_rank(d.fts, ts_query) as ts_score
      from documents d
      where (unfiltered or d.metadata @> filter)
        and d.fts @@ ts_query
      order by ts_rank(d.fts, ts_query) desc, d.id
      limit pool
    ) c
  ),
  -- Reciprocal rank fusion. Only ids and ranks cross the join;
  -- content/metadata are fetched once, at the end, for `n` rows.
  fused as (
    select
      coalesce(s.doc_id, f.doc_id) as doc_id,
      coalesce(w_sem / (k + s.rank_ix), 0.0)
      + coalesce(w_fts / (k + f.rank_ix), 0.0) as score
    from semantic s
    full outer join full_text f on f.doc_id = s.doc_id
  )
  select
    d.id,
    d.content,
    d.metadata,
    fu.score::float           -- RRF score, not a cosine similarity
  from fused fu
  join documents d on d.id = fu.doc_id
  order by fu.score desc, d.id    -- id tiebreak keeps paging deterministic
  limit n;
end;
$$;


-- ---------------------------------------------------------------------
-- Recall knob for the ANN branch, session-level and per connection.
-- Raise it when `filter` is selective: HNSW post-filters, so a narrow
-- filter can starve the candidate pool.
-- ---------------------------------------------------------------------
-- set hnsw.ef_search = 100;   -- default 40


-- ---------------------------------------------------------------------
-- Smoke test. Expect "Index Scan using documents_embedding_hnsw" in the
-- semantic branch and "Bitmap Index Scan on documents_fts_gin" in the
-- lexical branch. A Seq Scan on either means an index is missing or the
-- embedding column lost its dimension typmod.
-- ---------------------------------------------------------------------
-- explain (analyze, buffers)
-- select id, similarity
-- from public.hybrid_search(
--   'procedura de resetare',
--   (select embedding from public.documents limit 1),
--   '{}'::jsonb,
--   10
-- );
