-- Flowrise Supabase function: public.is_active_org_member(p_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.is_active_org_member(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from public.organization_memberships as m
        join public.profiles as p
          on p.id = m.user_id
        where m.organization_id = p_organization_id
          and m.user_id = auth.uid()
          and m.status = 'active'::public.membership_status
          and p.active = true
    );
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_organization_id uuid
