-- Flowrise Supabase function: public.current_partner_name()
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.current_partner_name()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select p.legacy_partner_name
    from public.profiles as p
    where p.id = auth.uid()
      and p.active = true
    limit 1;
$function$
;

-- Security definer: True
-- Return type: text
-- Identity arguments: 
