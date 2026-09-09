-- Flowrise Supabase function: public.chat_open_direct_thread(p_other_user uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_open_direct_thread(p_other_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_me uuid := auth.uid();
    v_key text;
    v_thread uuid;
begin
    if not public.chat_can_message(p_other_user) then
        raise exception 'You are not allowed to start this conversation';
    end if;

    v_key := case
        when v_me::text < p_other_user::text
            then v_me::text || ':' || p_other_user::text
        else p_other_user::text || ':' || v_me::text
    end;

    insert into public.chat_threads (
        thread_type,
        direct_key,
        created_by,
        created_at
    )
    values (
        'direct',
        v_key,
        v_me,
        now()
    )
    on conflict (direct_key)
    do update set direct_key=excluded.direct_key
    returning id into v_thread;

    insert into public.chat_thread_participants(thread_id,user_id,joined_at,last_read_at)
    values
        (v_thread,v_me,now(),now()),
        (v_thread,p_other_user,now(),null)
    on conflict (thread_id,user_id) do nothing;

    return v_thread;
end;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: p_other_user uuid
