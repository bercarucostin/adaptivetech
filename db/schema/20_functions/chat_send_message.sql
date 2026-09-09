-- Flowrise Supabase function: public.chat_send_message(p_thread_id uuid, p_body text, p_attachments jsonb)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_send_message(p_thread_id uuid, p_body text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_me uuid := auth.uid();
    v_message_id bigint;
    v_attachment jsonb;
    v_path text;
    v_name text;
    v_mime text;
    v_size bigint;
begin
    if not public.chat_is_thread_participant(p_thread_id) then
        raise exception 'Conversation access denied';
    end if;

    if jsonb_typeof(coalesce(p_attachments,'[]'::jsonb)) <> 'array' then
        raise exception 'Invalid attachments payload';
    end if;

    if nullif(trim(coalesce(p_body,'')),'') is null
       and jsonb_array_length(coalesce(p_attachments,'[]'::jsonb)) = 0 then
        raise exception 'Message is empty';
    end if;

    if jsonb_array_length(coalesce(p_attachments,'[]'::jsonb)) > 10 then
        raise exception 'Maximum 10 files per message';
    end if;

    insert into public.chat_messages(thread_id,sender_id,body,created_at)
    values (
        p_thread_id,
        v_me,
        nullif(trim(coalesce(p_body,'')),''),
        now()
    )
    returning id into v_message_id;

    for v_attachment in
        select * from jsonb_array_elements(coalesce(p_attachments,'[]'::jsonb))
    loop
        v_path := trim(coalesce(v_attachment->>'storage_path',''));
        v_name := trim(coalesce(v_attachment->>'file_name',''));
        v_mime := nullif(trim(coalesce(v_attachment->>'mime_type','')),'');
        v_size := coalesce(nullif(v_attachment->>'size_bytes','')::bigint,0);

        if v_path = ''
           or v_name = ''
           or v_size < 0
           or v_size > 26214400 then
            raise exception 'Invalid attachment';
        end if;

        -- Expected private object path:
        -- <thread_uuid>/<sender_uuid>/<random>_<filename>
        if split_part(v_path,'/',1) <> p_thread_id::text
           or split_part(v_path,'/',2) <> v_me::text then
            raise exception 'Invalid attachment path';
        end if;

        insert into public.chat_attachments(
            message_id,
            thread_id,
            uploaded_by,
            storage_path,
            file_name,
            mime_type,
            size_bytes,
            created_at
        )
        values (
            v_message_id,
            p_thread_id,
            v_me,
            v_path,
            v_name,
            v_mime,
            v_size,
            now()
        );
    end loop;

    update public.chat_threads
    set last_message_at=now()
    where id=p_thread_id;

    update public.chat_thread_participants
    set last_read_at=now()
    where thread_id=p_thread_id
      and user_id=v_me;

    return v_message_id;
end;
$function$
;

-- Security definer: True
-- Return type: bigint
-- Identity arguments: p_thread_id uuid, p_body text, p_attachments jsonb
