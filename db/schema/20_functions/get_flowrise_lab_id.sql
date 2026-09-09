-- Flowrise Supabase function: public.get_flowrise_lab_id()
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_flowrise_lab_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select o.id
    from public.organizations o
    where o.slug = 'flowrise-dental-lab'
      and o.organization_type = 'lab'
      and o.active = true
    limit 1;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: 
