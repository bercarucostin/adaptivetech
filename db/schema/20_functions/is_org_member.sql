-- Flowrise Supabase function: public.is_org_member(p_org uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.is_org_member(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id=p_org
      and m.user_id=auth.uid()
      and m.status='active'
  );
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_org uuid
