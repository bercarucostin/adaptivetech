-- Flowrise Supabase function: public.chat_cleanup_preview(p_thread_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_cleanup_preview(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_paths jsonb := '[]'::jsonb;
    v_messages bigint := 0;
    v_files bigint := 0;
begin
    if not public.chat_is_thread_participant(p_thread_id) then
        raise exception 'Conversation access denied';
    end if;

    select count(*)
      into v_messages
    from public.chat_messages m
    where m.thread_id=p_thread_id
      and m.created_at < now() - interval '30 days';

    select
        count(*),
        coalesce(jsonb_agg(a.storage_path order by a.created_at),'[]'::jsonb)
      into v_files,v_paths
    from public.chat_attachments a
    join public.chat_messages m on m.id=a.message_id
    where m.thread_id=p_thread_id
      and m.created_at < now() - interval '30 days';

    return jsonb_build_object(
        'message_count',v_messages,
        'file_count',v_files,
        'storage_paths',v_paths
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_thread_id uuid
