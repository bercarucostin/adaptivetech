-- Flowrise Supabase function: public.chat_can_message_as(p_from_user uuid, p_other_user uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.chat_can_message_as(p_from_user uuid, p_other_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if p_from_user is null
       or p_other_user is null
       or p_from_user = p_other_user then
        return false;
    end if;

    if not exists (
        select 1 from public.profiles p
        where p.id=p_from_user and p.active=true
    ) or not exists (
        select 1 from public.profiles p
        where p.id=p_other_user and p.active=true
    ) then
        return false;
    end if;

    -- Admin / Manager can initiate broadly. Pairwise compatibility below still
    -- protects the stricter rules of the recipient.
    if exists (
        select 1
        from public.organization_memberships m
        where m.user_id=p_from_user
          and m.status='active'
          and lower(m.role) in ('admin','manager')
    ) then
        return exists (
            select 1
            from public.organization_memberships m
            where m.user_id=p_other_user
              and m.status='active'
              and lower(m.role) in ('admin','manager','technician','doctor')
        );
    end if;

    -- Technician: same laboratory only, and only lab staff.
    if exists (
        select 1
        from public.organization_memberships m
        join public.organizations o on o.id=m.organization_id
        where m.user_id=p_from_user
          and m.status='active'
          and lower(m.role)='technician'
          and o.organization_type='lab'
    ) then
        return exists (
            select 1
            from public.organization_memberships me
            join public.organizations lab on lab.id=me.organization_id
            join public.organization_memberships other_m
              on other_m.organization_id=me.organization_id
            where me.user_id=p_from_user
              and me.status='active'
              and lower(me.role)='technician'
              and lab.organization_type='lab'
              and other_m.user_id=p_other_user
              and other_m.status='active'
              and lower(other_m.role) in ('admin','manager','technician')
        );
    end if;

    -- Doctor: only Admin / Manager of an actively connected laboratory.
    if exists (
        select 1
        from public.organization_memberships m
        where m.user_id=p_from_user
          and m.status='active'
          and lower(m.role)='doctor'
    ) then
        return exists (
            select 1
            from public.organization_memberships doctor_m
            join public.organizations clinic
              on clinic.id=doctor_m.organization_id
             and clinic.organization_type='clinic'
            join public.organization_relationships r
              on r.clinic_organization_id=clinic.id
             and lower(r.status::text)='active'
            join public.organization_memberships lab_m
              on lab_m.organization_id=r.lab_organization_id
             and lab_m.user_id=p_other_user
             and lab_m.status='active'
             and lower(lab_m.role) in ('admin','manager')
            where doctor_m.user_id=p_from_user
              and doctor_m.status='active'
              and lower(doctor_m.role)='doctor'
        );
    end if;

    return false;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_from_user uuid, p_other_user uuid
