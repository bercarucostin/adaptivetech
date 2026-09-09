-- Flowrise Supabase function: public.current_legacy_user_id()
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.current_legacy_user_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select p.legacy_user_id
    from public.profiles as p
    where p.id = auth.uid()
      and p.active = true
    limit 1;
$function$
;

-- Security definer: True
-- Return type: text
-- Identity arguments: 
