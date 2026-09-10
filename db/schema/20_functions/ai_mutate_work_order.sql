-- Flowrise Supabase function: public.ai_mutate_work_order(p_action text, p_payload jsonb)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.ai_mutate_work_order(p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_role text := public.effective_lab_role(public.get_flowrise_lab_id());
    v_action text := lower(trim(coalesce(p_action,'')));
    v_fields jsonb := coalesce(p_payload->'fields', p_payload, '{}'::jsonb);
    v_ids jsonb := '[]'::jsonb;
    v_id_text text;
    v_id bigint;
    v_count integer := 0;
    v_bulk boolean := coalesce((p_payload->>'bulk_explicit')::boolean,false);
    v_created bigint;
    v_order public.lab_work_orders%rowtype;
    v_tech text := lower(trim(coalesce(public.current_technician_name(),'')));
    v_stage_updated boolean;
begin
    if v_role not in ('admin','manager','technician') then
        return jsonb_build_object('ok',false,'error','AI mutations are not enabled for this role');
    end if;

    if v_action = 'create' then
        if v_role in ('admin','manager') then
            v_created := public.create_work_order(
                v_lab,
                nullif(v_fields->>'Deadline','')::date,
                coalesce(v_fields->>'Nume_Pacient',''),
                coalesce(v_fields->>'Tip_Lucrare',''),
                coalesce(nullif(v_fields->>'Nr_Elemente','')::integer,1),
                nullif(v_fields->>'Nume_Partener',''),
                coalesce(nullif(v_fields->>'Contract',''),'General'),
                coalesce(nullif(v_fields->>'Status',''),'Not Started'),
                coalesce(nullif(v_fields->>'Discount','')::numeric,0),
                nullif(v_fields->>'Data_Receptie','')::timestamptz
            );

            -- Apply optional management fields after create.
            select * into v_order
            from public.lab_work_orders
            where lab_organization_id = v_lab and id = v_created;

            update public.lab_work_orders
            set
                tehnician_model = case when v_fields ? 'Tehnician_Model'
                    then nullif(v_fields->>'Tehnician_Model','') else tehnician_model end,
                tehnician1_modelare = case when v_fields ? 'Tehnician1_Modelare'
                    then nullif(v_fields->>'Tehnician1_Modelare','') else tehnician1_modelare end,
                tehnician2_cer_fin = case when v_fields ? 'Tehnician2_Cer_Fin'
                    then nullif(v_fields->>'Tehnician2_Cer_Fin','') else tehnician2_cer_fin end,
                status_model = case when v_fields ? 'Status_Model'
                    then coalesce(nullif(v_fields->>'Status_Model',''),'Not Started') else status_model end,
                status_modelare = case when v_fields ? 'Status_Modelare'
                    then coalesce(nullif(v_fields->>'Status_Modelare',''),'Not Started') else status_modelare end,
                status_cer_fin = case when v_fields ? 'Status_Cer_Fin'
                    then coalesce(nullif(v_fields->>'Status_Cer_Fin',''),'Not Started') else status_cer_fin end,
                updated_by_user_id = public.current_legacy_user_id(),
                updated_at = now()
            where lab_organization_id = v_lab and id = v_created;

            if v_fields ? 'Tehnician_Model' then
                perform public.sync_work_order_stage_assignment(v_lab,v_created,'model',v_fields->>'Tehnician_Model');
            end if;
            if v_fields ? 'Tehnician1_Modelare' then
                perform public.sync_work_order_stage_assignment(v_lab,v_created,'modelare',v_fields->>'Tehnician1_Modelare');
            end if;
            if v_fields ? 'Tehnician2_Cer_Fin' then
                perform public.sync_work_order_stage_assignment(v_lab,v_created,'cer_fin',v_fields->>'Tehnician2_Cer_Fin');
            end if;
            if v_fields ? 'Paid_Model' then
                perform public.set_stage_payment_status(v_lab,v_created,'model',v_fields->>'Paid_Model');
            end if;
            if v_fields ? 'Paid_Modelare' then
                perform public.set_stage_payment_status(v_lab,v_created,'modelare',v_fields->>'Paid_Modelare');
            end if;
            if v_fields ? 'Paid_Cer_Fin' then
                perform public.set_stage_payment_status(v_lab,v_created,'cer_fin',v_fields->>'Paid_Cer_Fin');
            end if;

        else
            v_created := public.create_technician_work_order(
                v_lab,
                nullif(v_fields->>'Deadline','')::date,
                coalesce(v_fields->>'Nume_Pacient',''),
                coalesce(v_fields->>'Nume_Partener',''),
                coalesce(v_fields->>'Tip_Lucrare',''),
                coalesce(nullif(v_fields->>'Nr_Elemente','')::integer,1),
                nullif(v_fields->>'Data_Receptie','')::timestamptz,
                coalesce(
                    nullif(v_fields->>'My_Stage',''),
                    nullif(p_payload->>'my_stage',''),
                    'Model'
                )
            );
        end if;

        return jsonb_build_object(
            'ok',true,
            'type','create_work_order',
            'ids',jsonb_build_array(v_created)
        );
    end if;

    if p_payload ? 'ids' then
        v_ids := p_payload->'ids';
    elsif p_payload ? 'id' then
        v_ids := jsonb_build_array(p_payload->'id');
    elsif p_payload ? 'target_id' then
        v_ids := jsonb_build_array(p_payload->'target_id');
    elsif v_fields ? 'ID' then
        v_ids := jsonb_build_array(v_fields->'ID');
    end if;

    if jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) = 0 then
        return jsonb_build_object('ok',false,'error','No target Work Order ID supplied');
    end if;

    if jsonb_array_length(v_ids) > 1 and not v_bulk then
        return jsonb_build_object(
            'ok',false,
            'error','Multiple Work Orders require bulk_explicit=true'
        );
    end if;

    if jsonb_array_length(v_ids) > 100 then
        return jsonb_build_object('ok',false,'error','Maximum 100 Work Orders per AI mutation');
    end if;

    if v_action = 'delete' then
        if v_role not in ('admin','manager') then
            return jsonb_build_object('ok',false,'error','Only Admin/Manager can delete Work Orders');
        end if;

        for v_id_text in select jsonb_array_elements_text(v_ids)
        loop
            v_id := v_id_text::bigint;
            perform public.delete_management_work_order(v_lab,v_id);
            v_count := v_count + 1;
        end loop;

        return jsonb_build_object(
            'ok',true,
            'type','delete_work_order',
            'count',v_count,
            'ids',v_ids
        );
    end if;

    if v_action = 'update' then
        for v_id_text in select jsonb_array_elements_text(v_ids)
        loop
            v_id := v_id_text::bigint;

            select *
              into v_order
            from public.lab_work_orders
            where lab_organization_id = v_lab
              and id = v_id
            limit 1;

            if not found then
                return jsonb_build_object('ok',false,'error',format('Work Order #%s not found',v_id));
            end if;

            if v_role in ('admin','manager') then

                if v_fields ? 'Nr_Elemente'
                   and coalesce(nullif(v_fields->>'Nr_Elemente','')::integer,0) <= 0 then
                    return jsonb_build_object('ok',false,'error','Nr_Elemente must be > 0');
                end if;

                if v_fields ? 'Discount'
                   and (
                       coalesce(nullif(v_fields->>'Discount','')::numeric,0) < 0
                       or coalesce(nullif(v_fields->>'Discount','')::numeric,0) > 100
                   ) then
                    return jsonb_build_object('ok',false,'error','Discount must be between 0 and 100');
                end if;

                if v_fields ? 'Tip_Lucrare'
                   and not exists (
                       select 1
                       from public.lab_work_types wt
                       where wt.lab_organization_id = v_lab
                         and wt.active = true
                         and wt.tip_lucrare = v_fields->>'Tip_Lucrare'
                   ) then
                    return jsonb_build_object('ok',false,'error','Tip_Lucrare is not active');
                end if;

                update public.lab_work_orders
                set
                    deadline = case when v_fields ? 'Deadline'
                        then nullif(v_fields->>'Deadline','')::date else deadline end,
                    data_receptie = case when v_fields ? 'Data_Receptie'
                        then nullif(v_fields->>'Data_Receptie','')::timestamptz else data_receptie end,
                    status = case when v_fields ? 'Status'
                        then coalesce(nullif(v_fields->>'Status',''),status) else status end,
                    nume_pacient = case when v_fields ? 'Nume_Pacient'
                        then coalesce(nullif(trim(v_fields->>'Nume_Pacient'),''),nume_pacient) else nume_pacient end,
                    nume_partener = case when v_fields ? 'Nume_Partener'
                        then coalesce(nullif(trim(v_fields->>'Nume_Partener'),''),nume_partener) else nume_partener end,
                    contract = case when v_fields ? 'Contract'
                        then coalesce(nullif(trim(v_fields->>'Contract'),''),contract) else contract end,
                    tip_lucrare = case when v_fields ? 'Tip_Lucrare'
                        then coalesce(nullif(trim(v_fields->>'Tip_Lucrare'),''),tip_lucrare) else tip_lucrare end,
                    nr_elemente = case when v_fields ? 'Nr_Elemente'
                        then (v_fields->>'Nr_Elemente')::integer else nr_elemente end,
                    tehnician_model = case when v_fields ? 'Tehnician_Model'
                        then nullif(v_fields->>'Tehnician_Model','') else tehnician_model end,
                    tehnician1_modelare = case when v_fields ? 'Tehnician1_Modelare'
                        then nullif(v_fields->>'Tehnician1_Modelare','') else tehnician1_modelare end,
                    tehnician2_cer_fin = case when v_fields ? 'Tehnician2_Cer_Fin'
                        then nullif(v_fields->>'Tehnician2_Cer_Fin','') else tehnician2_cer_fin end,
                    status_model = case when v_fields ? 'Status_Model'
                        then coalesce(nullif(v_fields->>'Status_Model',''),status_model) else status_model end,
                    status_modelare = case when v_fields ? 'Status_Modelare'
                        then coalesce(nullif(v_fields->>'Status_Modelare',''),status_modelare) else status_modelare end,
                    status_cer_fin = case when v_fields ? 'Status_Cer_Fin'
                        then coalesce(nullif(v_fields->>'Status_Cer_Fin',''),status_cer_fin) else status_cer_fin end,
                    discount = case when v_fields ? 'Discount'
                        then (v_fields->>'Discount')::numeric else discount end,
                    locked = case when v_fields ? 'Locked'
                        then lower(coalesce(v_fields->>'Locked','false')) in ('true','1','yes','y')
                        else locked end,
                    updated_by_user_id = public.current_legacy_user_id(),
                    updated_at = now()
                where lab_organization_id = v_lab
                  and id = v_id;

                update public.lab_patient_cases pc
                set
                    nume_pacient = wo.nume_pacient,
                    nume_partener = wo.nume_partener,
                    tip_lucrare = wo.tip_lucrare,
                    deadline = wo.deadline,
                    updated_by_user_id = public.current_legacy_user_id(),
                    updated_at = now()
                from public.lab_work_orders wo
                where pc.lab_organization_id = v_lab
                  and pc.work_order_id = v_id
                  and wo.lab_organization_id = v_lab
                  and wo.id = v_id;

                if v_fields ? 'Tehnician_Model' then
                    perform public.sync_work_order_stage_assignment(v_lab,v_id,'model',v_fields->>'Tehnician_Model');
                end if;
                if v_fields ? 'Tehnician1_Modelare' then
                    perform public.sync_work_order_stage_assignment(v_lab,v_id,'modelare',v_fields->>'Tehnician1_Modelare');
                end if;
                if v_fields ? 'Tehnician2_Cer_Fin' then
                    perform public.sync_work_order_stage_assignment(v_lab,v_id,'cer_fin',v_fields->>'Tehnician2_Cer_Fin');
                end if;
                if v_fields ? 'Paid_Model' then
                    perform public.set_stage_payment_status(v_lab,v_id,'model',v_fields->>'Paid_Model');
                end if;
                if v_fields ? 'Paid_Modelare' then
                    perform public.set_stage_payment_status(v_lab,v_id,'modelare',v_fields->>'Paid_Modelare');
                end if;
                if v_fields ? 'Paid_Cer_Fin' then
                    perform public.set_stage_payment_status(v_lab,v_id,'cer_fin',v_fields->>'Paid_Cer_Fin');
                end if;

                if v_fields ? 'Nr_Elemente' or v_fields ? 'Discount' then
                    update public.lab_work_orders wo
                    set snapshot_list_price = case when wo.snapshot_unit_price is null then null
                            else round(wo.snapshot_unit_price * wo.nr_elemente,2) end,
                        snapshot_final_price = case when wo.snapshot_unit_price is null then null
                            else round(wo.snapshot_unit_price * wo.nr_elemente * (1-wo.discount/100),2) end
                    where wo.lab_organization_id=v_lab and wo.id=v_id;
                end if;

            else
                v_stage_updated := false;

                if v_fields ? 'Status_Model'
                   and lower(trim(coalesce(v_order.tehnician_model,''))) = v_tech then
                    perform public.update_my_stage_status(
                        v_lab,v_id,'model',v_fields->>'Status_Model'
                    );
                    v_stage_updated := true;
                end if;

                if v_fields ? 'Status_Modelare'
                   and lower(trim(coalesce(v_order.tehnician1_modelare,''))) = v_tech then
                    perform public.update_my_stage_status(
                        v_lab,v_id,'modelare',v_fields->>'Status_Modelare'
                    );
                    v_stage_updated := true;
                end if;

                if v_fields ? 'Status_Cer_Fin'
                   and lower(trim(coalesce(v_order.tehnician2_cer_fin,''))) = v_tech then
                    perform public.update_my_stage_status(
                        v_lab,v_id,'cer_fin',v_fields->>'Status_Cer_Fin'
                    );
                    v_stage_updated := true;
                end if;

                if not v_stage_updated then
                    return jsonb_build_object(
                        'ok',false,
                        'error','Technician can update only their assigned stage status'
                    );
                end if;
            end if;

            v_count := v_count + 1;
        end loop;

        return jsonb_build_object(
            'ok',true,
            'type','update_work_order',
            'count',v_count,
            'ids',v_ids
        );
    end if;

    return jsonb_build_object('ok',false,'error','Unsupported AI mutation action');

exception
    when others then
        return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_action text, p_payload jsonb
