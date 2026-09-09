-- Flowrise Supabase function: public.has_role_permission(p_organization_id uuid, p_permission text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.has_role_permission(p_organization_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_role text;
    v_result boolean := false;
begin
    select m.role
      into v_role
    from public.organization_memberships as m
    join public.profiles as p
      on p.id = m.user_id
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'::public.membership_status
      and p.active = true
    limit 1;

    if v_role is null then
        return false;
    end if;

    select case lower(p_permission)
        when 'can_view_work_orders' then rp.can_view_work_orders
        when 'can_view_production' then rp.can_view_production
        when 'can_view_partners' then rp.can_view_partners
        when 'can_view_technicians' then rp.can_view_technicians
        when 'can_create_work_orders' then rp.can_create_work_orders
        when 'can_edit_all_work_orders' then rp.can_edit_all_work_orders
        when 'can_edit_own_stage_status' then rp.can_edit_own_stage_status
        when 'can_assign_technicians' then rp.can_assign_technicians
        when 'can_view_client_pricing' then rp.can_view_client_pricing
        when 'can_view_other_technician_costs' then rp.can_view_other_technician_costs
        when 'can_view_own_technician_cost' then rp.can_view_own_technician_cost
        when 'can_edit_payment_status' then rp.can_edit_payment_status
        when 'can_edit_global_status' then rp.can_edit_global_status
        when 'can_access_backend' then rp.can_access_backend
        when 'can_edit_partner_work_orders' then rp.can_edit_partner_work_orders
        else false
    end
      into v_result
    from public.role_permissions as rp
    where lower(rp.role) = lower(v_role)
      and rp.active = true
    limit 1;

    return coalesce(v_result, false);
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_organization_id uuid, p_permission text
