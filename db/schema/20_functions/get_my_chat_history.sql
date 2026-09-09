-- Flowrise Supabase function: public.get_my_chat_history(p_session_id text, p_limit integer)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_my_chat_history(p_session_id text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id bigint, user_id text, session_id text, role text, message text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        ch.id,
        ch.user_id,
        ch.session_id,
        ch.role,
        ch.message,
        ch.created_at
    from public.lab_chat_history ch
    where ch.lab_organization_id = public.get_flowrise_lab_id()
      and lower(coalesce(ch.user_id,'')) =
          lower(coalesce(public.current_legacy_user_id(),''))
      and ch.session_id = p_session_id
    order by ch.created_at asc nulls last, ch.id asc
    limit greatest(1,least(coalesce(p_limit,100),500));
$function$
;

-- Security definer: True
-- Return type: TABLE(id bigint, user_id text, session_id text, role text, message text, created_at timestamp with time zone)
-- Identity arguments: p_session_id text, p_limit integer
