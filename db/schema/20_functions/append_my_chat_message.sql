-- Flowrise Supabase function: public.append_my_chat_message(p_session_id text, p_role text, p_message text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.append_my_chat_message(p_session_id text, p_role text, p_message text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_id bigint;
    v_role text := lower(trim(coalesce(p_role,'')));
    v_user text := public.current_legacy_user_id();
begin
    if v_user is null or trim(v_user) = '' then
        raise exception 'Active user not found';
    end if;

    if v_role not in ('user','assistant') then
        raise exception 'Invalid chat role';
    end if;

    if trim(coalesce(p_session_id,'')) = '' then
        raise exception 'Session ID is required';
    end if;

    if trim(coalesce(p_message,'')) = '' then
        raise exception 'Message is required';
    end if;

    insert into public.lab_chat_history (
        lab_organization_id,
        user_id,
        session_id,
        role,
        message,
        created_at
    )
    values (
        public.get_flowrise_lab_id(),
        v_user,
        p_session_id,
        v_role,
        p_message,
        now()
    )
    returning id into v_id;

    return v_id;
end;
$function$
;

-- Security definer: True
-- Return type: bigint
-- Identity arguments: p_session_id text, p_role text, p_message text
