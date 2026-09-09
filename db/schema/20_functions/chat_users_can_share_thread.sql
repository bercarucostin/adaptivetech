-- Flowrise Supabase function: public.chat_users_can_share_thread(p_user_a uuid, p_user_b uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_users_can_share_thread(p_user_a uuid, p_user_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select public.chat_can_message_as(p_user_a,p_user_b)
       and public.chat_can_message_as(p_user_b,p_user_a);
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_user_a uuid, p_user_b uuid
