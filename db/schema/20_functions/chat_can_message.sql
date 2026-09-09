-- Flowrise Supabase function: public.chat_can_message(p_other_user uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_can_message(p_other_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select public.chat_users_can_share_thread(auth.uid(),p_other_user);
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_other_user uuid
