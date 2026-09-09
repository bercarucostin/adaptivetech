-- Flowrise Supabase function: public.chat_is_thread_participant(p_thread_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_is_thread_participant(p_thread_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from public.chat_thread_participants p
        where p.thread_id = p_thread_id
          and p.user_id = auth.uid()
    );
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_thread_id uuid
