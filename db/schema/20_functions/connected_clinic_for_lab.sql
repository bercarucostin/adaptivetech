-- Flowrise Supabase function: public.connected_clinic_for_lab(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.connected_clinic_for_lab(p_lab_organization_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select r.clinic_organization_id
    from public.organization_memberships m
    join public.organizations clinic
      on clinic.id = m.organization_id
     and clinic.organization_type = 'clinic'
    join public.organization_relationships r
      on r.clinic_organization_id = clinic.id
     and r.lab_organization_id = p_lab_organization_id
     and r.status = 'active'::public.relationship_status
    join public.profiles p
      on p.id = m.user_id
    where m.user_id = auth.uid()
      and m.status = 'active'::public.membership_status
      and lower(m.role) = 'doctor'
      and p.active = true
    limit 1;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: p_lab_organization_id uuid
