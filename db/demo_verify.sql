-- =====================================================================
-- demo_verify -- proves the three properties the demo's design rests on.
-- Run AFTER demo_schema.sql and demo_hybrid_search.sql, against the
-- dedicated demo Supabase project.
--
-- Written for a web SQL editor: no psql meta-commands (\gset), no client
-- variables. Paste the whole file and run it, then read the result grid.
-- It creates its own fixtures and deletes them again.
--
-- Every row it returns has a `verdict` column. Any FAIL is a stop-work.
-- =====================================================================

set search_path = public, extensions;

create table if not exists _demo_verify (
  seq        int,
  check_name text,
  detail     text,
  verdict    text
);
truncate _demo_verify;

do $$
declare
  a_id uuid;
  b_id uuid;
  up_id uuid;
  n_docs int;
  n_uploads int;
  n_msgs int;
  n_detached int;
  n_leads int;
  mine bigint;
  leaked bigint;
  sim numeric;
  hits bigint;
begin
  -- ---------------------------------------------------------------
  -- 1. RETENTION. Documents and uploads die with the session; questions
  --    detach and survive; leads sit outside every cascade. A CASCADE on
  --    demo_messages would silently destroy the product signal, and the
  --    loss is invisible until someone looks for data already gone.
  -- ---------------------------------------------------------------
  insert into demo_sessions (email, expires_at)
    values ('retention@x.test', now() + interval '2h') returning id into a_id;

  insert into demo_uploads (session_id, filename)
    values (a_id, 'f.pdf') returning id into up_id;

  insert into demo_documents (session_id, content, embedding)
    values (a_id, 'doomed', array_fill(0.1::real, array[1536])::vector);

  insert into demo_messages (session_id, role, content)
    values (a_id, 'user', 'this question must survive');

  insert into demo_leads (email) values ('retention@x.test');

  delete from demo_sessions where id = a_id;

  select count(*) into n_docs    from demo_documents where session_id = a_id;
  select count(*) into n_uploads from demo_uploads   where session_id = a_id;
  select count(*) into n_msgs    from demo_messages  where content = 'this question must survive';
  select count(*) into n_detached from demo_messages where content = 'this question must survive' and session_id is null;
  select count(*) into n_leads   from demo_leads     where email = 'retention@x.test';

  insert into _demo_verify values (1, 'documents die with the session',
    format('rows left: %s (want 0)', n_docs),
    case when n_docs = 0 then 'PASS' else 'FAIL' end);

  insert into _demo_verify values (2, 'uploads die with the session',
    format('rows left: %s (want 0)', n_uploads),
    case when n_uploads = 0 then 'PASS' else 'FAIL' end);

  insert into _demo_verify values (3, 'questions SURVIVE the session',
    format('rows left: %s (want 1)', n_msgs),
    case when n_msgs = 1 then 'PASS' else 'FAIL -- FK is CASCADE, must be SET NULL' end);

  insert into _demo_verify values (4, 'surviving question is detached',
    format('null session_id: %s (want 1)', n_detached),
    case when n_detached = 1 then 'PASS' else 'FAIL' end);

  insert into _demo_verify values (5, 'lead outlives the session',
    format('rows left: %s (want 1)', n_leads),
    case when n_leads = 1 then 'PASS' else 'FAIL' end);

  delete from demo_messages where content = 'this question must survive';
  delete from demo_leads where email = 'retention@x.test';

  -- ---------------------------------------------------------------
  -- 2. ISOLATION. Two sessions, one chunk each. Neither may see the
  --    other's row through demo_hybrid_search. This is the assertion the
  --    entire demo sits on top of.
  -- ---------------------------------------------------------------
  insert into demo_sessions (email, expires_at)
    values ('a@x.test', now() + interval '2h') returning id into a_id;
  insert into demo_sessions (email, expires_at)
    values ('b@x.test', now() + interval '2h') returning id into b_id;

  insert into demo_documents (session_id, content, metadata, embedding) values
    (a_id, 'procedura secreta a lui A', '{"original_file_name":"a.pdf"}',
     array_fill(0.02::real, array[1536])::vector),
    (b_id, 'procedura secreta a lui B', '{"original_file_name":"b.pdf"}',
     array_fill(0.02::real, array[1536])::vector);

  select count(*) filter (where content like '%lui A%'),
         count(*) filter (where content like '%lui B%'),
         round(min(best_similarity)::numeric, 4)
    into mine, leaked, sim
    from demo_hybrid_search('procedura secreta',
           array_fill(0.02::real, array[1536])::vector, a_id, 8);

  insert into _demo_verify values (6, 'session A sees only A',
    format('mine: %s, leaked: %s (want 1 and 0)', mine, leaked),
    case when mine = 1 and leaked = 0 then 'PASS' else 'FAIL -- STOP EVERYTHING' end);

  select count(*) filter (where content like '%lui B%'),
         count(*) filter (where content like '%lui A%')
    into mine, leaked
    from demo_hybrid_search('procedura secreta',
           array_fill(0.02::real, array[1536])::vector, b_id, 8);

  insert into _demo_verify values (7, 'session B sees only B',
    format('mine: %s, leaked: %s (want 1 and 0)', mine, leaked),
    case when mine = 1 and leaked = 0 then 'PASS' else 'FAIL -- STOP EVERYTHING' end);

  -- ---------------------------------------------------------------
  -- 3. THE SHORT-CIRCUIT SIGNAL. An on-topic query must score high, an
  --    off-topic one low -- even though BOTH return the same row count.
  --    The off-topic embedding alternates +/-0.02 against a uniform
  --    0.02 chunk, so their dot product is exactly zero by construction.
  --    Row count alone would call this "on topic"; best_similarity is
  --    what lets the chat refuse without paying for an LLM call.
  -- ---------------------------------------------------------------
  insert into _demo_verify values (8, 'on-topic query scores HIGH',
    format('best_similarity: %s (want > 0.9)', sim),
    case when sim > 0.9 then 'PASS' else 'FAIL' end);

  select count(*), round(min(best_similarity)::numeric, 4)
    into hits, sim
    from demo_hybrid_search('care este capitala Frantei',
           (select array_agg((case when i % 2 = 0 then 0.02 else -0.02 end)::real)
            from generate_series(1, 1536) as i)::vector,
           a_id, 8);

  insert into _demo_verify values (9, 'off-topic query scores LOW',
    format('hits: %s but best_similarity: %s (want < 0.3)', hits, sim),
    case when sim < 0.3 then 'PASS' else 'FAIL -- the retrieval short-circuit cannot work' end);

  -- Cleanup. The cascade takes the documents with the sessions.
  delete from demo_sessions where id in (a_id, b_id);
end $$;

select seq, check_name, detail, verdict from _demo_verify order by seq;

-- Tidy up the scratch table once you have read the results:
--   drop table _demo_verify;
