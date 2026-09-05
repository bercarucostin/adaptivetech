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
       count(*) filter (where content like '%lui B%') as leaked
from demo_hybrid_search('procedura secreta',
       array_fill(0.02::real, array[1536])::vector, :'a_id', 8);

select 'B sees only B' as check, count(*) filter (where content like '%lui B%') as mine,
       count(*) filter (where content like '%lui A%') as leaked
from demo_hybrid_search('procedura secreta',
       array_fill(0.02::real, array[1536])::vector, :'b_id', 8);

rollback;
