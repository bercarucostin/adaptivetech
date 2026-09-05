create or replace function public.cleanup_n8n_chat_histories_after_insert()
returns trigger
language plpgsql
as $$
declare
  msg_type text;
  has_tool_calls boolean;
begin
  msg_type := new.message->>'type';

  has_tool_calls :=
    (new.message ? 'tool_calls')
    and jsonb_typeof(new.message->'tool_calls') = 'array'
    and jsonb_array_length(new.message->'tool_calls') > 0;

  -- păstrăm mesajele human
  if msg_type = 'human' then
    return null;
  end if;

  -- păstrăm mesajele ai doar dacă NU au tool_calls
  if msg_type = 'ai' and not has_tool_calls then
    return null;
  end if;

  -- ștergem tot ce nu ne dorim
  delete from public.n8n_chat_histories
  where id = new.id;

  return null;
end;
$$;