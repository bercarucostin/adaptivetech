-- Flowrise Supabase function: public.get_ai_context(p_session_id text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_ai_context(p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_role text := public.effective_lab_role(public.get_flowrise_lab_id());
    v_identity jsonb;
    v_history jsonb := '[]'::jsonb;
    v_orders jsonb := '[]'::jsonb;
    v_prices jsonb := '[]'::jsonb;
    v_costs jsonb := '[]'::jsonb;
    v_types jsonb := '[]'::jsonb;
    v_materials jsonb := '[]'::jsonb;
    v_tech text := lower(trim(coalesce(public.current_technician_name(),'')));
begin
    v_identity := public.get_app_identity();

    if coalesce((v_identity->>'ok')::boolean,false) = false then
        return jsonb_build_object('allowed',false,'identity',v_identity);
    end if;

    if v_role not in ('admin','manager','technician') then
        return jsonb_build_object(
            'allowed', false,
            'identity', v_identity,
            'message', 'AI is not enabled for this role'
        );
    end if;

    select coalesce(jsonb_agg(x.obj order by x.created_at),'[]'::jsonb)
      into v_history
    from (
        select
            ch.created_at,
            jsonb_build_object(
                'Role', ch.role,
                'Message', ch.message,
                'Created_At', ch.created_at
            ) as obj
        from public.lab_chat_history ch
        where ch.lab_organization_id = v_lab
          and lower(coalesce(ch.user_id,'')) =
              lower(coalesce(public.current_legacy_user_id(),''))
          and ch.session_id = p_session_id
          and ch.message is not null
          and ch.role in ('user','assistant')
        order by ch.created_at desc nulls last, ch.id desc
        limit 14
    ) x;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'ID', wt.id,
            'Tip_Lucrare', wt.tip_lucrare,
            'Active', wt.active
        )
        order by wt.tip_lucrare, wt.id
    ),'[]'::jsonb)
    into v_types
    from public.lab_work_types wt
    where wt.lab_organization_id = v_lab
      and wt.active = true;

    if v_role in ('admin','manager') then

        select coalesce(jsonb_agg(x.obj order by x.id desc),'[]'::jsonb)
          into v_orders
        from (
            select
                wo.id,
                jsonb_build_object(
                    'ID', wo.id,
                    'Deadline', wo.deadline,
                    'Data_Receptie', wo.data_receptie,
                    'Status', wo.status,
                    'Nume_Pacient', wo.nume_pacient,
                    'Nume_Partener', wo.nume_partener,
                    'Contract', wo.contract,
                    'items', scope.items,'work_types',scope.work_types,
                    'work_type_summary',scope.work_type_summary,'element_count',scope.element_count,
                    'Tehnician_Model', wo.tehnician_model,
                    'Tehnician1_Modelare', wo.tehnician1_modelare,
                    'Tehnician2_Cer_Fin', wo.tehnician2_cer_fin,
                    'Status_Model', wo.status_model,
                    'Status_Modelare', wo.status_modelare,
                    'Status_Cer_Fin', wo.status_cer_fin,
                    'Paid_Model', wo.paid_model,
                    'Paid_Modelare', wo.paid_modelare,
                    'Paid_Cer_Fin', wo.paid_cer_fin,
                    'Discount', wo.discount,
                    'Locked', wo.locked,
                    'Total_Pret_Lista', wo.snapshot_list_price,
                    'Total_dupa_Discount', wo.snapshot_final_price,
                    'Price_Source', wo.price_source,
                    'Price_Migrated', wo.price_migrated
                ) as obj
            from public.lab_work_orders wo
        cross join lateral public.work_order_item_scope(wo.lab_organization_id,wo.id,false) scope
            where wo.lab_organization_id = v_lab
              and wo.archived_at is null
            order by wo.id desc
            limit 500
        ) x;

        select coalesce(jsonb_agg(
            jsonb_build_object(
                'ID', cp.id,
                'Contract', cp.contract,
                'Tip_Lucrare', cp.tip_lucrare,
                'Pret', cp.pret
            )
            order by cp.contract, cp.tip_lucrare, cp.id
        ),'[]'::jsonb)
        into v_prices
        from public.lab_contract_work_prices cp
        where cp.lab_organization_id = v_lab;

        select coalesce(jsonb_agg(
            jsonb_build_object(
                'ID', tc.legacy_id,
                'Source_Row_No', tc.source_row_no,
                'Tehnician', tc.tehnician,
                'Tip_Lucrare', tc.tip_lucrare,
                'Etapa', tc.etapa,
                'Cost', tc.cost
            )
            order by tc.tehnician, tc.tip_lucrare, tc.etapa, tc.source_row_no
        ),'[]'::jsonb)
        into v_costs
        from public.lab_technician_costs tc
        where tc.lab_organization_id = v_lab;

        select coalesce(jsonb_agg(
            jsonb_build_object(
                'ID', mi.id,
                'Furnizor', mi.furnizor,
                'Material', mi.material,
                'UM', mi.um,
                'Cantitate', mi.cantitate,
                'Prag_Minim', mi.prag_minim,
                'Ultima_Actualizare', mi.ultima_actualizare,
                'Observatii', mi.observatii
            )
            order by mi.material, mi.id
        ),'[]'::jsonb)
        into v_materials
        from public.lab_materials_inventory mi
        where mi.lab_organization_id = v_lab;

    elsif v_role = 'technician' then

        select coalesce(jsonb_agg(x.obj order by x.id desc),'[]'::jsonb)
          into v_orders
        from (
            select
                wo.id,
                jsonb_build_object(
                    'ID', wo.id,
                    'Deadline', wo.deadline,
                    'Data_Receptie', wo.data_receptie,
                    'Status', wo.status,
                    'Nume_Pacient', wo.nume_pacient,
                    'Nume_Partener', wo.nume_partener,
                    'items', scope.items,'work_types',scope.work_types,
                    'work_type_summary',scope.work_type_summary,'element_count',scope.element_count,
                    'Tehnician_Model', wo.tehnician_model,
                    'Tehnician1_Modelare', wo.tehnician1_modelare,
                    'Tehnician2_Cer_Fin', wo.tehnician2_cer_fin,
                    'Status_Model', wo.status_model,
                    'Status_Modelare', wo.status_modelare,
                    'Status_Cer_Fin', wo.status_cer_fin,
                    'Paid_Model',
                        case when lower(trim(coalesce(wo.tehnician_model,''))) = v_tech
                             then wo.paid_model else null end,
                    'Paid_Modelare',
                        case when lower(trim(coalesce(wo.tehnician1_modelare,''))) = v_tech
                             then wo.paid_modelare else null end,
                    'Paid_Cer_Fin',
                        case when lower(trim(coalesce(wo.tehnician2_cer_fin,''))) = v_tech
                             then wo.paid_cer_fin else null end
                ) as obj
            from public.lab_work_orders wo
        cross join lateral public.work_order_item_scope(wo.lab_organization_id,wo.id,false) scope
            where wo.lab_organization_id = v_lab
              and v_tech <> ''
              and v_tech in (
                  lower(trim(coalesce(wo.tehnician_model,''))),
                  lower(trim(coalesce(wo.tehnician1_modelare,''))),
                  lower(trim(coalesce(wo.tehnician2_cer_fin,'')))
              )
            order by wo.id desc
            limit 500
        ) x;

        select coalesce(jsonb_agg(
            jsonb_build_object(
                'ID', tc.legacy_id,
                'Source_Row_No', tc.source_row_no,
                'Tehnician', tc.tehnician,
                'Tip_Lucrare', tc.tip_lucrare,
                'Etapa', tc.etapa,
                'Cost', tc.cost
            )
            order by tc.tip_lucrare, tc.etapa, tc.source_row_no
        ),'[]'::jsonb)
        into v_costs
        from public.lab_technician_costs tc
        where tc.lab_organization_id = v_lab
          and lower(trim(coalesce(tc.tehnician,''))) = v_tech;
    end if;

    return jsonb_build_object(
        'allowed', true,
        'identity', v_identity,
        'role', v_role,
        'history', v_history,
        'work_orders', v_orders,
        'contract_prices', v_prices,
        'technician_costs', v_costs,
        'work_types', v_types,
        'materials', v_materials
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_session_id text
