-- Flowrise Supabase function: public.is_lab_technician(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.is_lab_technician(p_lab_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from public.organization_memberships m
        join public.profiles p on p.id = m.user_id
        where m.organization_id = p_lab_organization_id
          and m.user_id = auth.uid()
          and m.status = 'active'::public.membership_status
          and p.active = true
          and lower(m.role) = 'technician'
    );
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid
