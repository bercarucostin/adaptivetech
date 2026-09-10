-- AI uses the same atomic item-aware role writers as the browser.
CREATE OR REPLACE FUNCTION public.ai_mutate_work_order(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id();
    v_role text:=public.effective_lab_role(v_lab);
    v_action text:=lower(trim(coalesce(p_action,'')));
    v_fields jsonb:=coalesce(p_payload->'fields',p_payload,'{}'::jsonb);
    v_ids jsonb; v_id bigint; v_text text; v_created bigint; v_items jsonb;
    v_order public.lab_work_orders%rowtype;
BEGIN
    IF v_role NOT IN ('admin','manager','technician') OR v_role IS NULL THEN RAISE EXCEPTION 'AI mutations are not enabled for this role'; END IF;
    IF v_action NOT IN ('create','update','delete') THEN RAISE EXCEPTION 'Unsupported AI mutation action'; END IF;
    IF v_action='create' THEN
        IF v_role='technician' THEN
            v_created:=public.create_technician_work_order(v_lab,nullif(v_fields->>'Deadline','')::date,
                v_fields->>'Nume_Pacient',v_fields->>'Nume_Partener',v_fields->'items',
                nullif(v_fields->>'Data_Receptie','')::timestamptz,coalesce(v_fields->>'My_Stage','Model'),coalesce(v_fields->'case','{}'::jsonb));
            RETURN jsonb_build_object('ok',true,'type','create_work_order','ids',jsonb_build_array(v_created));
        END IF;
        v_created:=public.create_work_order(v_lab,nullif(v_fields->>'Deadline','')::date,v_fields->>'Nume_Pacient',
            v_fields->'items',v_fields->>'Nume_Partener',coalesce(v_fields->>'Contract','General'),
            coalesce(v_fields->>'Status','Not Started'),coalesce((v_fields->>'Discount')::numeric,0),
            nullif(v_fields->>'Data_Receptie','')::timestamptz,coalesce(v_fields->'case','{}'::jsonb));
        v_ids:=jsonb_build_array(v_created);
    ELSE
        v_ids:=coalesce(p_payload->'ids',jsonb_build_array(coalesce(p_payload->'id',p_payload->'target_id',v_fields->'ID')));
    END IF;
    IF jsonb_typeof(v_ids)<>'array' OR jsonb_array_length(v_ids)=0 OR jsonb_array_length(v_ids)>100 THEN RAISE EXCEPTION 'Supply between 1 and 100 Work Order IDs'; END IF;
    IF jsonb_array_length(v_ids)>1 AND NOT coalesce((p_payload->>'bulk_explicit')::boolean,false) THEN RAISE EXCEPTION 'Multiple Work Orders require bulk_explicit=true'; END IF;
    FOR v_text IN SELECT jsonb_array_elements_text(v_ids) LOOP
        v_id:=v_text::bigint;
        SELECT * INTO v_order FROM public.lab_work_orders WHERE lab_organization_id=v_lab AND id=v_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found: %',v_id; END IF;
        IF v_action='delete' THEN
            IF v_role NOT IN ('admin','manager') THEN RAISE EXCEPTION 'Only Admin/Manager can delete Work Orders'; END IF;
            PERFORM public.delete_management_work_order(v_lab,v_id);
        ELSE
            IF v_role NOT IN ('admin','manager') THEN RAISE EXCEPTION 'Technician AI may create Work Orders but may not update or delete them'; END IF;
            -- Absent items means a metadata-only edit; a supplied empty/null scope is rejected by the writer.
            IF v_fields ? 'items' THEN v_items:=v_fields->'items';
            ELSE SELECT items INTO v_items FROM public.work_order_item_scope(v_lab,v_id,false); END IF;
            PERFORM public.update_management_work_order_v188(
                p_lab_organization_id=>v_lab,p_work_order_id=>v_id,
                p_deadline=>CASE WHEN v_fields ? 'Deadline' THEN nullif(v_fields->>'Deadline','')::date ELSE v_order.deadline END,
                p_status=>coalesce(v_fields->>'Status',v_order.status),
                p_nume_pacient=>coalesce(v_fields->>'Nume_Pacient',v_order.nume_pacient),
                p_nume_partener=>coalesce(v_fields->>'Nume_Partener',v_order.nume_partener),
                p_contract=>coalesce(v_fields->>'Contract',v_order.contract),
                p_discount=>coalesce((v_fields->>'Discount')::numeric,v_order.discount),
                p_data_receptie=>CASE WHEN v_fields ? 'Data_Receptie' THEN nullif(v_fields->>'Data_Receptie','')::timestamptz ELSE v_order.data_receptie END,
                p_tehnician_model=>CASE WHEN v_fields ? 'Tehnician_Model' THEN v_fields->>'Tehnician_Model' ELSE v_order.tehnician_model END,
                p_tehnician1_modelare=>CASE WHEN v_fields ? 'Tehnician1_Modelare' THEN v_fields->>'Tehnician1_Modelare' ELSE v_order.tehnician1_modelare END,
                p_tehnician2_cer_fin=>CASE WHEN v_fields ? 'Tehnician2_Cer_Fin' THEN v_fields->>'Tehnician2_Cer_Fin' ELSE v_order.tehnician2_cer_fin END,
                p_status_model=>coalesce(v_fields->>'Status_Model',v_order.status_model),
                p_status_modelare=>coalesce(v_fields->>'Status_Modelare',v_order.status_modelare),
                p_status_cer_fin=>coalesce(v_fields->>'Status_Cer_Fin',v_order.status_cer_fin),
                p_paid_model=>coalesce(v_fields->>'Paid_Model',v_order.paid_model),
                p_paid_modelare=>coalesce(v_fields->>'Paid_Modelare',v_order.paid_modelare),
                p_paid_cer_fin=>coalesce(v_fields->>'Paid_Cer_Fin',v_order.paid_cer_fin),
                p_model_not_applicable=>v_order.model_not_applicable,p_modelare_not_applicable=>v_order.modelare_not_applicable,
                p_cer_fin_not_applicable=>v_order.cer_fin_not_applicable,p_locked=>coalesce((v_fields->>'Locked')::boolean,v_order.locked),
                p_model_settlement=>v_fields->>'Settlement_Model',p_modelare_settlement=>v_fields->>'Settlement_Modelare',
                p_cer_fin_settlement=>v_fields->>'Settlement_Cer_Fin',p_items=>v_items,
                p_requested_contract=>coalesce(v_fields->>'Contract',v_order.contract,'General'),p_case=>coalesce(v_fields->'case','{}'::jsonb));
        END IF;
    END LOOP;
    RETURN jsonb_build_object('ok',true,'type',v_action||'_work_order','ids',v_ids,'count',jsonb_array_length(v_ids));
EXCEPTION WHEN OTHERS THEN
    -- Exception block rolls back the entire mutation, including previous bulk rows.
    RETURN jsonb_build_object('ok',false,'error',sqlerrm);
END; $$;
REVOKE ALL ON FUNCTION public.ai_mutate_work_order(text,jsonb) FROM public,authenticated;
