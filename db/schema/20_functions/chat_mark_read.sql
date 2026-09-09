-- Flowrise Supabase function: public.chat_mark_read(p_thread_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_mark_read(p_thread_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if not public.chat_is_thread_participant(p_thread_id) then
        raise exception 'Conversation access denied';
    end if;

    update public.chat_thread_participants
    set last_read_at=now()
    where thread_id=p_thread_id
      and user_id=auth.uid();
end;
$function$
;

-- Security definer: True
-- Return type: void
-- Identity arguments: p_thread_id uuid
