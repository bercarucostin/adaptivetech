-- Flowrise Supabase function: public.current_org_role(p_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.current_org_role(p_organization_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select m.role
    from public.organization_memberships as m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'::public.membership_status
    limit 1;
$function$
;

-- Security definer: True
-- Return type: text
-- Identity arguments: p_organization_id uuid
