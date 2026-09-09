-- Flowrise Supabase function: public.effective_lab_role(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.effective_lab_role(p_lab_organization_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_role text;
begin
    select lower(m.role)
      into v_role
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_lab_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'::public.membership_status
      and p.active = true
    limit 1;

    if v_role is not null then
        return v_role;
    end if;

    if public.is_connected_doctor_for_lab(p_lab_organization_id) then
        return 'doctor';
    end if;

    return null;
end;
$function$
;

-- Security definer: True
-- Return type: text
-- Identity arguments: p_lab_organization_id uuid
