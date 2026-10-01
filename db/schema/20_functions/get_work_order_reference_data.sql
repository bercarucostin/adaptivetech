-- Flowrise Supabase function: public.get_work_order_reference_data(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_work_order_reference_data(p_lab_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_role text := public.effective_lab_role(p_lab_organization_id);
    v_work_types jsonb;
    v_technicians jsonb := '[]'::jsonb;
    v_prices jsonb := '[]'::jsonb;
    v_partners jsonb := '[]'::jsonb;
begin
    if v_role is null then
        raise exception 'Access denied';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', wt.id,
                'tip_lucrare', wt.tip_lucrare,
                'active', wt.active,
                'billing_mode', wt.billing_mode,
                'processing_enabled', wt.processing_enabled
            )
            order by wt.tip_lucrare, wt.id
        ),
        '[]'::jsonb
    )
    into v_work_types
    from public.lab_work_types wt
    where wt.lab_organization_id = p_lab_organization_id
      and wt.active = true;

    if v_role in ('admin','manager','dashboard') then
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'username', p.username,
                    'display_name', p.display_name,
                    'technician_name', p.technician_name
                )
                order by coalesce(p.technician_name,p.display_name,p.username)
            ),
            '[]'::jsonb
        )
        into v_technicians
        from public.organization_memberships m
        join public.profiles p
          on p.id = m.user_id
        where m.organization_id = p_lab_organization_id
          and m.status = 'active'::public.membership_status
          and lower(m.role) = 'technician'
          and p.active = true;
    end if;

    if v_role in ('admin','manager') then
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', cp.id,
                    'contract', cp.contract,
                    'tip_lucrare', cp.tip_lucrare,
                    'pret', cp.pret
                )
                order by cp.contract, cp.tip_lucrare, cp.id
            ),
            '[]'::jsonb
        )
        into v_prices
        from public.lab_contract_work_prices cp
        where cp.lab_organization_id = p_lab_organization_id;
    end if;

    -- Doctors keep their account partner; do not disclose other clinic names.
    if v_role in ('admin','manager','technician','dashboard') then
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'active', p.active
        ) order by p.name), '[]'::jsonb)
        into v_partners
        from public.lab_partners p
        where p.lab_organization_id = p_lab_organization_id
          and (p.active or v_role = 'admin');
    end if;

    return jsonb_build_object(
        'role', v_role,
        'work_types', v_work_types,
        'technicians', v_technicians,
        'contract_prices', v_prices,
        'partners', v_partners
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_lab_organization_id uuid
