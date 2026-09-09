-- Flowrise Supabase function: public.chat_get_messages(p_thread_id uuid, p_before timestamp with time zone, p_limit integer)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_get_messages(p_thread_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100)
 RETURNS TABLE(id bigint, sender_id uuid, sender_name text, body text, created_at timestamp with time zone, attachments jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if not public.chat_is_thread_participant(p_thread_id) then
        raise exception 'Conversation access denied';
    end if;

    return query
    select *
    from (
        select
            m.id,
            m.sender_id,
            coalesce(p.display_name,p.username)::text as sender_name,
            m.body,
            m.created_at,
            coalesce(
                (
                    select jsonb_agg(
                        jsonb_build_object(
                            'id',a.id,
                            'storage_path',a.storage_path,
                            'file_name',a.file_name,
                            'mime_type',a.mime_type,
                            'size_bytes',a.size_bytes
                        )
                        order by a.created_at,a.id
                    )
                    from public.chat_attachments a
                    where a.message_id=m.id
                ),
                '[]'::jsonb
            ) as attachments
        from public.chat_messages m
        join public.profiles p on p.id=m.sender_id
        where m.thread_id=p_thread_id
          and (p_before is null or m.created_at < p_before)
        order by m.created_at desc,m.id desc
        limit greatest(1,least(coalesce(p_limit,100),300))
    ) q
    order by q.created_at,q.id;
end;
$function$
;

-- Security definer: True
-- Return type: TABLE(id bigint, sender_id uuid, sender_name text, body text, created_at timestamp with time zone, attachments jsonb)
-- Identity arguments: p_thread_id uuid, p_before timestamp with time zone, p_limit integer
