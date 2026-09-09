-- Flowrise Supabase function: public.chat_clear_older_than_30_days(p_thread_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_clear_older_than_30_days(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_deleted bigint := 0;
begin
    if not public.chat_is_thread_participant(p_thread_id) then
        raise exception 'Conversation access denied';
    end if;

    with deleted as (
        delete from public.chat_messages m
        where m.thread_id=p_thread_id
          and m.created_at < now() - interval '30 days'
        returning 1
    )
    select count(*) into v_deleted from deleted;

    update public.chat_threads t
    set last_message_at=(
        select max(m.created_at)
        from public.chat_messages m
        where m.thread_id=t.id
    )
    where t.id=p_thread_id;

    return jsonb_build_object(
        'ok',true,
        'deleted_messages',v_deleted
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_thread_id uuid
