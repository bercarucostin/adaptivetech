-- Flowrise Supabase function: public.get_app_identity()
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_app_identity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_role text;
    v_role_display text;
    v_profile public.profiles%rowtype;
    v_perm public.role_permissions%rowtype;
begin
    select *
      into v_profile
    from public.profiles
    where id = auth.uid()
      and active = true
    limit 1;

    if not found then
        return jsonb_build_object('ok', false, 'message', 'Active profile not found');
    end if;

    v_role := public.effective_lab_role(v_lab);

    if v_role is null then
        return jsonb_build_object('ok', false, 'message', 'No active Flowrise role');
    end if;

    select *
      into v_perm
    from public.role_permissions
    where lower(role) = lower(v_role)
      and active = true
    limit 1;

    if not found then
        return jsonb_build_object('ok', false, 'message', 'Role permissions not found');
    end if;

    v_role_display := case lower(v_role)
        when 'admin' then 'Admin'
        when 'manager' then 'Manager'
        when 'technician' then 'Technician'
        when 'doctor' then 'Doctor'
        when 'dashboard' then 'Dashboard'
        else initcap(v_role)
    end;

    return jsonb_build_object(
        'ok', true,
        'lab_organization_id', v_lab,
        'user', jsonb_build_object(
            'User_ID', coalesce(v_profile.legacy_user_id, v_profile.username),
            'Email', coalesce(auth.jwt() ->> 'email', ''),
            'Name', coalesce(v_profile.display_name, v_profile.username),
            'Role', v_role_display,
            'Technician_Name', coalesce(v_profile.technician_name, ''),
            'Partner_Name', coalesce(v_profile.legacy_partner_name, ''),
            'Active', true
        ),
        'profile', jsonb_build_object(
            'id', v_profile.id,
            'username', v_profile.username,
            'display_name', v_profile.display_name,
            'legacy_user_id', v_profile.legacy_user_id,
            'active', v_profile.active
        ),
        'permissions', jsonb_build_object(
            'Can_View_Work_Orders', v_perm.can_view_work_orders,
            'Can_View_Production', v_perm.can_view_production,
            'Can_View_Partners', v_perm.can_view_partners,
            'Can_View_Technicians', v_perm.can_view_technicians,
            'Can_Create_Work_Orders', v_perm.can_create_work_orders,
            'Can_Edit_All_Work_Orders', v_perm.can_edit_all_work_orders,
            'Can_Edit_Own_Stage_Status', v_perm.can_edit_own_stage_status,
            'Can_Assign_Technicians', v_perm.can_assign_technicians,
            'Can_View_Client_Pricing', v_perm.can_view_client_pricing,
            'Can_View_Other_Technician_Costs', v_perm.can_view_other_technician_costs,
            'Can_View_Own_Technician_Cost', v_perm.can_view_own_technician_cost,
            'Can_Edit_Payment_Status', v_perm.can_edit_payment_status,
            'Can_Edit_Global_Status', v_perm.can_edit_global_status,
            'Can_Access_Backend', v_perm.can_access_backend,
            'Can_Edit_Partner_Work_Orders', v_perm.can_edit_partner_work_orders,
            'Work_Order_Scope', v_perm.work_order_scope,
            'AI_Flow', coalesce(v_perm.ai_flow, '')
        )
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: 
