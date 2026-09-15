-- Flowrise Supabase function: public.ai_read_dataset(p_dataset text, p_limit integer, p_offset integer)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.ai_read_dataset(p_dataset text, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_role text := public.effective_lab_role(public.get_flowrise_lab_id());
    v_dataset text := lower(trim(coalesce(p_dataset,'')));
    v_limit integer := greatest(1,least(coalesce(p_limit,1000),5000));
    v_offset integer := greatest(0,coalesce(p_offset,0));
    v_rows jsonb := '[]'::jsonb;
    v_total bigint := 0;
    v_today date := (current_timestamp at time zone 'Europe/Bucharest')::date;
begin
    if v_role = 'technician' then

        if v_dataset = 'my_work_orders' then
            return jsonb_build_object(
                'dataset',v_dataset,
                'total_rows',jsonb_array_length(public.ai_technician_work_orders()),
                'rows',public.ai_technician_work_orders()
            );

        elsif v_dataset = 'my_receivables' then
            return jsonb_build_object(
                'dataset',v_dataset,
                'total_rows',1,
                'rows',jsonb_build_array(public.ai_technician_receivables())
            );

        elsif v_dataset = 'work_types' then
            return jsonb_build_object(
                'dataset',v_dataset,
                'total_rows',jsonb_array_length(public.ai_technician_work_types()),
                'rows',public.ai_technician_work_types()
            );

        elsif v_dataset = 'materials_inventory' then
            return jsonb_build_object(
                'dataset',v_dataset,'total_rows',jsonb_array_length(public.ai_read_materials()),
                'rows',public.ai_read_materials()
            );

        elsif v_dataset = 'calendar_events' then
            return jsonb_build_object(
                'dataset',v_dataset,
                'total_rows',jsonb_array_length(public.ai_read_calendar(v_today-30,v_today+336)),
                'rows',public.ai_read_calendar(v_today-30,v_today+336)
            );

        else
            raise exception 'Dataset not allowed for Technician';
        end if;
    end if;

    if coalesce(v_role,'') not in ('admin','manager') then
        raise exception 'AI dataset access denied';
    end if;

    -- Management datasets remain exactly as configured in V17.3.
    if v_dataset = 'users' then
        with q as (
            select
                p.id,
                au.email,
                p.username,
                p.display_name,
                p.legacy_user_id,
                p.technician_name,
                p.legacy_partner_name,
                p.active,
                p.created_at,
                p.updated_at,
                coalesce(
                    jsonb_agg(
                        jsonb_build_object(
                            'organization_id',m.organization_id,
                            'organization',o.name,
                            'organization_type',o.organization_type,
                            'role',m.role,
                            'status',m.status
                        )
                        order by o.name
                    ) filter (where m.organization_id is not null),
                    '[]'::jsonb
                ) as memberships
            from public.profiles p
            left join auth.users au on au.id=p.id
            left join public.organization_memberships m on m.user_id=p.id
            left join public.organizations o on o.id=m.organization_id
            group by p.id,au.email
        )
        select count(*) into v_total from q;

        with q as (
            select
                p.id,
                au.email,
                p.username,
                p.display_name,
                p.legacy_user_id,
                p.technician_name,
                p.legacy_partner_name,
                p.active,
                p.created_at,
                p.updated_at,
                coalesce(
                    jsonb_agg(
                        jsonb_build_object(
                            'organization_id',m.organization_id,
                            'organization',o.name,
                            'organization_type',o.organization_type,
                            'role',m.role,
                            'status',m.status
                        )
                        order by o.name
                    ) filter (where m.organization_id is not null),
                    '[]'::jsonb
                ) as memberships
            from public.profiles p
            left join auth.users au on au.id=p.id
            left join public.organization_memberships m on m.user_id=p.id
            left join public.organizations o on o.id=m.organization_id
            group by p.id,au.email
            order by p.display_name nulls last,p.username
            limit v_limit offset v_offset
        )
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows from q;

    elsif v_dataset = 'organizations' then
        select count(*) into v_total from public.organizations;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (select * from public.organizations order by name limit v_limit offset v_offset) q;

    elsif v_dataset = 'organization_memberships' then
        select count(*) into v_total from public.organization_memberships;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select m.organization_id,o.name as organization,o.organization_type,
                   m.user_id,p.username,p.display_name,m.role,m.status,m.created_at
            from public.organization_memberships m
            join public.organizations o on o.id=m.organization_id
            left join public.profiles p on p.id=m.user_id
            order by o.name,m.role,p.display_name
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'organization_relationships' then
        select count(*) into v_total from public.organization_relationships;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select r.*,clinic.name as clinic_name,lab.name as lab_name
            from public.organization_relationships r
            join public.organizations clinic on clinic.id=r.clinic_organization_id
            join public.organizations lab on lab.id=r.lab_organization_id
            order by r.created_at desc
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'lab_profiles' then
        select count(*) into v_total from public.lab_profiles;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select lp.*,o.name as organization_name
            from public.lab_profiles lp
            join public.organizations o on o.id=lp.organization_id
            order by o.name
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'lab_public_offers' then
        select count(*) into v_total from public.lab_public_offers;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (select * from public.lab_public_offers order by created_at desc limit v_limit offset v_offset) q;

    elsif v_dataset = 'relationship_terms' then
        select count(*) into v_total from public.relationship_terms;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (select * from public.relationship_terms order by updated_at desc limit v_limit offset v_offset) q;

    elsif v_dataset = 'relationship_prices' then
        select count(*) into v_total from public.relationship_prices;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (select * from public.relationship_prices order by updated_at desc limit v_limit offset v_offset) q;

    elsif v_dataset = 'work_orders' then
        select count(*) into v_total from public.lab_work_orders where lab_organization_id=v_lab and archived_at is null;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select
                wo.*,
                wo.contract as matched_price_contract,
                scope.items,scope.work_types,scope.work_type_summary,scope.element_count,
                coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'work_type',line.work_type,'billing_mode',line.billing_mode,
                        'billing_scope',line.billing_scope,'quantity',line.quantity,
                        'contract',line.contract,'unit_price',line.unit_price,
                        'subtotal',line.line_total,'price_source',line.price_source,
                        'price_fixed_at',line.price_fixed_at,'price_migrated',line.price_migrated
                    ) order by line.work_type,line.billing_scope)
                    from public.lab_work_order_price_lines line
                    where line.lab_organization_id=wo.lab_organization_id
                      and line.work_order_id=wo.id
                ),'[]'::jsonb) as price_lines,
                wo.snapshot_list_price as list_price,
                wo.snapshot_final_price as final_price,
                (wo.snapshot_list_price is not null) as price_matched,
                wo.price_source,
                wo.price_migrated
            from public.lab_work_orders wo
            cross join lateral public.work_order_item_scope(wo.lab_organization_id,wo.id,true) scope
            where wo.lab_organization_id=v_lab
              and wo.archived_at is null
            order by wo.id desc
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'financial_history' then
        select count(*) into v_total
        from public.lab_work_order_stage_assignments a
        where a.lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select a.id as assignment_id,a.work_order_id,a.stage_key,a.technician_name,
                   a.unit_cost,a.quantity,public.assignment_agreed_amount(a.id) as agreed_amount,a.cost_source,a.fixed_at,
                   a.started_at,a.ended_at,a.migrated,
                   coalesce(pay.paid_amount,0)::numeric as paid_amount,
                   case when public.assignment_agreed_amount(a.id) is null then null
                        else public.assignment_agreed_amount(a.id)-coalesce(pay.paid_amount,0) end as outstanding_amount,
                   coalesce(pay.payments,'[]'::jsonb) as payments
            from public.lab_work_order_stage_assignments a
            left join lateral (
                select sum(p.amount)::numeric as paid_amount,
                       jsonb_agg(jsonb_build_object(
                           'id',p.id,'amount',p.amount,'paid_on',p.paid_on,
                           'recorded_at',p.recorded_at,'reversal_of',p.reversal_of,
                           'migration_balance',p.migration_balance,'note',p.note
                       ) order by p.recorded_at) as payments
                from public.technician_payments p where p.assignment_id=a.id
            ) pay on true
            where a.lab_organization_id=v_lab
            order by a.work_order_id desc,a.started_at desc
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'patient_cases' then
        select count(*) into v_total from public.lab_patient_cases where lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.lab_patient_cases
            where lab_organization_id=v_lab
            order by work_order_id desc,id desc
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'work_types' then
        select count(*) into v_total from public.lab_work_types where lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select id,tip_lucrare,active,billing_mode,created_at,updated_at
            from public.lab_work_types
            where lab_organization_id=v_lab
            order by tip_lucrare,id
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'contract_prices' then
        select count(*) into v_total from public.lab_contract_work_prices where lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.lab_contract_work_prices
            where lab_organization_id=v_lab
            order by contract,tip_lucrare,id
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'technician_costs' then
        select count(*) into v_total from public.lab_technician_costs where lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.lab_technician_costs
            where lab_organization_id=v_lab
            order by tehnician,tip_lucrare,etapa,source_row_no
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'calendar_events' then
        select count(*) into v_total from public.lab_calendar_events where lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.lab_calendar_events
            where lab_organization_id=v_lab
            order by start_date desc,start_time desc nulls last,id desc
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'materials_inventory' then
        select count(*) into v_total from public.lab_materials_inventory where lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.lab_materials_inventory
            where lab_organization_id=v_lab
            order by material,id
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'chat_history' then
        select count(*) into v_total from public.lab_chat_history where lab_organization_id=v_lab;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.lab_chat_history
            where lab_organization_id=v_lab
            order by created_at desc nulls last,id desc
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'work_order_files' then
        select count(*) into v_total
        from public.work_order_files
        where lab_organization_id=v_lab or lab_organization_id is null;

        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.work_order_files
            where lab_organization_id=v_lab or lab_organization_id is null
            order by created_at desc
            limit v_limit offset v_offset
        ) q;

    elsif v_dataset = 'role_permissions' then
        select count(*) into v_total from public.role_permissions;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (select * from public.role_permissions order by role limit v_limit offset v_offset) q;

    elsif v_dataset = 'legacy_user_directory' then
        select count(*) into v_total from public.legacy_user_directory;
        select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows
        from (
            select * from public.legacy_user_directory
            order by role,name
            limit v_limit offset v_offset
        ) q;

    else
        raise exception 'Unknown or disallowed AI dataset: %',v_dataset;
    end if;

    return jsonb_build_object(
        'dataset',v_dataset,
        'total_rows',v_total,
        'offset',v_offset,
        'returned_rows',jsonb_array_length(v_rows),
        'rows',v_rows
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_dataset text, p_limit integer, p_offset integer
