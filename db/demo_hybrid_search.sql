-- =====================================================================
-- demo_hybrid_search -- session-scoped exact cosine + FTS, fused with RRF
-- Run after db/demo_schema.sql.
--
-- There is deliberately no `filter jsonb` parameter. hybrid_search()'s
-- filter defaults to '{}' meaning "search everything"; a function whose
-- unsafe mode is its default is the wrong shape for per-visitor
-- isolation. p_session_id is required, so the dangerous call is
-- unrepresentable rather than merely discouraged.
-- =====================================================================

create or replace function public.demo_hybrid_search(
  query_text       text,
  query_embedding  vector(1536),
  p_session_id     uuid,
  match_count      integer          default 8,
  semantic_weight  double precision default 0.5,
  full_text_weight double precision default 0.5,
  rrf_k            integer          default 50
)
returns table (
  id              bigint,
  content         text,
  metadata        jsonb,
  similarity      float,
  best_similarity float
)
language plpgsql
stable
parallel safe
-- `extensions`, not just `public`: this targets a brand-new Supabase
-- project, and pgvector lands in the `extensions` schema when enabled
-- through the dashboard toggle (the documented path) but in `public` when
-- enabled by running this schema's own `create extension`. Without
-- `extensions` on the path, `<=>` resolves fine on a project where the
-- schema installed the extension and fails everywhere else with
-- "operator does not exist: vector <=> vector".
set search_path = public, extensions
as $$
declare
  -- Must match demo_documents.fts -- a 'simple' query against a
  -- 'romanian' index silently returns almost nothing.
  ts_query tsquery := websearch_to_tsquery('romanian', coalesce(query_text, ''));

  n     integer := greatest(coalesce(match_count, 8), 1);
  pool  integer := least(greatest(n * 4, 50), 500);

  k     integer          := greatest(coalesce(rrf_k, 50), 1);
  w_sem double precision := coalesce(semantic_weight, 0);
  w_fts double precision := coalesce(full_text_weight, 0);
begin
  if p_session_id is null then
    raise exception 'demo_hybrid_search requires a session_id';
  end if;

  return query
  -- Semantic branch: EXACT cosine over this session's rows only. No ANN.
  -- One session holds one document (150-400 chunks), so the btree scan
  -- plus exact distance beats an approximate index and cannot under-recall.
  --
  -- `dist` is carried through here and into `fused` below: `similarity`
  -- (the RRF score, ~0-0.02, derived purely from rank position) tells the
  -- caller nothing about whether a chunk is actually a good match -- a
  -- session with one uploaded document returns *some* row for every
  -- query, on-topic or not, because rank position always exists even when
  -- every candidate is a poor match. `best_similarity` is the real cosine
  -- similarity (1 - distance) for that row, so a caller (the chat
  -- workflow's retrieval short-circuit) can threshold on "is this actually
  -- close to the question" rather than on "did retrieval return 8 rows".
  with semantic as (
    select c.doc_id, c.dist, row_number() over (order by c.dist, c.doc_id) as rank_ix
    from (
      select d.id as doc_id, d.embedding <=> query_embedding as dist
      from demo_documents d
      where d.session_id = p_session_id
      order by d.embedding <=> query_embedding
      limit pool
    ) c
  ),
  -- Lexical branch. ALSO scoped: fusing a scoped semantic branch with an
  -- unscoped lexical one would leak other sessions' content through RRF.
  full_text as (
    select c.doc_id, row_number() over (order by c.ts_score desc, c.doc_id) as rank_ix
    from (
      select d.id as doc_id, ts_rank(d.fts, ts_query) as ts_score
      from demo_documents d
      where d.session_id = p_session_id
        and d.fts @@ ts_query
      order by ts_rank(d.fts, ts_query) desc, d.id
      limit pool
    ) c
  ),
  fused as (
    select
      coalesce(s.doc_id, f.doc_id) as doc_id,
      coalesce(w_sem / (k + s.rank_ix), 0.0)
      + coalesce(w_fts / (k + f.rank_ix), 0.0) as score,
      s.dist as dist
    from semantic s
    full outer join full_text f on f.doc_id = s.doc_id
  )
  -- A chunk that only matched via full_text (outside the semantic branch's
  -- top `pool` by distance) has no `fu.dist` to reuse; recompute its exact
  -- distance directly rather than leaving best_similarity null. This only
  -- runs for the final `n` (<=8) rows, so it is not the pool-wide scan the
  -- semantic branch above was written to avoid.
  select
    d.id, d.content, d.metadata, fu.score::float as similarity,
    (1 - coalesce(fu.dist, d.embedding <=> query_embedding))::float as best_similarity
  from fused fu
  join demo_documents d on d.id = fu.doc_id
  order by fu.score desc, d.id
  limit n;
end;
$$;
