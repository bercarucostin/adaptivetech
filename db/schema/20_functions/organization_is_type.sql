-- Flowrise Supabase function: public.organization_is_type(p_org uuid, p_type text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.organization_is_type(p_org uuid, p_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.organizations o
    where o.id=p_org
      and o.organization_type::text=p_type
  );
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_org uuid, p_type text
