create table public.n8n_chat_histories (
  id bigserial not null,
  session_id text not null,
  message jsonb not null,
  created_at timestamp with time zone not null default now(),
  wa_question_id text null,
  phone_e164 text null,
  constraint n8n_chat_histories_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists n8n_chat_histories_session_id_created_at_idx on public.n8n_chat_histories using btree (session_id, created_at desc) TABLESPACE pg_default;

create trigger trg_cleanup_n8n_chat_histories_after_insert
after INSERT on n8n_chat_histories for EACH row
execute FUNCTION cleanup_n8n_chat_histories_after_insert ();