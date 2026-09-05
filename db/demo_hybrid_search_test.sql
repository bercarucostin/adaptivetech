-- Two sessions, one chunk each. Session A must never see session B's row.
begin;

insert into demo_sessions (email, expires_at)
  values ('a@x.test', now() + interval '2h') returning id \gset a_
insert into demo_sessions (email, expires_at)
  values ('b@x.test', now() + interval '2h') returning id \gset b_

insert into demo_documents (session_id, content, metadata, embedding) values
  (:'a_id', 'procedura secreta a lui A', '{"original_file_name":"a.pdf"}',
   array_fill(0.02::real, array[1536])::vector),
  (:'b_id', 'procedura secreta a lui B', '{"original_file_name":"b.pdf"}',
   array_fill(0.02::real, array[1536])::vector);

select 'A sees only A' as check, count(*) filter (where content like '%lui A%') as mine,
       count(*) filter (where content like '%lui B%') as leaked,
       round(min(best_similarity)::numeric, 4) as best_similarity
from demo_hybrid_search('procedura secreta',
       array_fill(0.02::real, array[1536])::vector, :'a_id', 8);
-- best_similarity must be HIGH here: the query embedding is identical to
-- the stored chunk's, so cosine distance is 0 and best_similarity is 1.0.

select 'B sees only B' as check, count(*) filter (where content like '%lui B%') as mine,
       count(*) filter (where content like '%lui A%') as leaked,
       round(min(best_similarity)::numeric, 4) as best_similarity
from demo_hybrid_search('procedura secreta',
       array_fill(0.02::real, array[1536])::vector, :'b_id', 8);
-- Same as above: on-topic query, identical embedding, best_similarity 1.0.

-- Off-topic query against session A: neither the query text ("what is the
-- capital of France", in Romanian since demo_documents.fts is a 'romanian'
-- index) nor its embedding has anything to do with A's chunk. The query
-- embedding below is built to be orthogonal to the stored, uniform
-- 0.02-everywhere embedding (alternating +0.02/-0.02 sums to a zero dot
-- product against it), so cosine similarity is exactly 0 and
-- best_similarity must be LOW -- this is the case the retrieval
-- short-circuit depends on: row_count alone (hit_count = 1 here) would
-- wrongly say "on topic"; best_similarity correctly says it is not.
select 'A: off-topic query has LOW best_similarity, not just a row count' as check,
       count(*) as hit_count,
       round(min(best_similarity)::numeric, 4) as best_similarity
from demo_hybrid_search('care este capitala Frantei',
       (select array_agg((case when i % 2 = 0 then 0.02 else -0.02 end)::real)
        from generate_series(1, 1536) as i)::vector,
       :'a_id', 8);

rollback;
