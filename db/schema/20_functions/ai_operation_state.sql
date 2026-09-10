CREATE OR REPLACE FUNCTION public.ai_operation_state(p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_entity text:=lower(trim(p_envelope->>'entity'));
    v_operation text:=lower(trim(p_envelope->>'operation')); v_target jsonb:=coalesce(p_envelope->'target','{}'::jsonb);
    v_fields jsonb:=coalesce(p_envelope->'fields','{}'::jsonb); v_state jsonb; v_role text;
BEGIN
    v_role:=public.effective_lab_role(v_lab);
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'AI operation access denied'; END IF;
    IF v_role='technician' AND v_entity NOT IN ('material','calendar_event') THEN RAISE EXCEPTION 'AI operation not allowed for Technician'; END IF;
    IF v_role='manager' AND v_entity NOT IN ('material','calendar_event') THEN RAISE EXCEPTION 'Admin access required for this AI operation'; END IF;
    IF v_entity='technician_cost' AND v_operation='duplicate' THEN
        SELECT jsonb_build_object(
            'source',coalesce(jsonb_agg(to_jsonb(x) order by x.source_row_no) filter(where x.side='source'),'[]'::jsonb),
            'target',coalesce(jsonb_agg(to_jsonb(x) order by x.source_row_no) filter(where x.side='target'),'[]'::jsonb)
        ) INTO v_state FROM (
            SELECT 'source'::text side,source_row_no,tehnician,tip_lucrare,etapa,cost,updated_at
            FROM public.lab_technician_costs WHERE lab_organization_id=v_lab
              AND lower(trim(tehnician))=lower(trim(coalesce(v_fields->>'source_technician',v_target->>'source_technician','')))
            UNION ALL
            SELECT 'target',source_row_no,tehnician,tip_lucrare,etapa,cost,updated_at
            FROM public.lab_technician_costs WHERE lab_organization_id=v_lab
              AND lower(trim(tehnician))=lower(trim(coalesce(v_fields->>'target_technician',v_target->>'target_technician','')))
        ) x;
    ELSIF v_entity='contract_price' AND v_operation='duplicate' THEN
        SELECT jsonb_build_object(
            'source',coalesce(jsonb_agg(to_jsonb(x) order by x.id) filter(where x.side='source'),'[]'::jsonb),
            'target',coalesce(jsonb_agg(to_jsonb(x) order by x.id) filter(where x.side='target'),'[]'::jsonb)
        ) INTO v_state FROM (
            SELECT 'source'::text side,id,contract,tip_lucrare,pret,updated_at
            FROM public.lab_contract_work_prices WHERE lab_organization_id=v_lab
              AND lower(trim(contract))=lower(trim(coalesce(v_fields->>'source_contract',v_target->>'source_contract','')))
            UNION ALL
            SELECT 'target',id,contract,tip_lucrare,pret,updated_at
            FROM public.lab_contract_work_prices WHERE lab_organization_id=v_lab
              AND lower(trim(contract))=lower(trim(coalesce(v_fields->>'target_contract',v_target->>'target_contract','')))
        ) x;
    ELSIF v_entity='work_order' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(wo) order by wo.id),'[]'::jsonb) INTO v_state
        FROM public.lab_work_orders wo WHERE wo.lab_organization_id=v_lab
          AND wo.id IN (SELECT value::bigint FROM jsonb_array_elements_text(coalesce(v_target->'ids',jsonb_build_array(v_target->'id'))));
    ELSIF v_entity='contract_price' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(cp) order by cp.id),'[]'::jsonb) INTO v_state
        FROM public.lab_contract_work_prices cp WHERE cp.lab_organization_id=v_lab AND cp.id=v_target->>'id';
    ELSIF v_entity='technician_cost' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(tc) order by tc.source_row_no),'[]'::jsonb) INTO v_state
        FROM public.lab_technician_costs tc WHERE tc.lab_organization_id=v_lab AND tc.source_row_no=(v_target->>'source_row_no')::integer;
    ELSIF v_entity='work_type' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(wt) order by wt.id),'[]'::jsonb) INTO v_state
        FROM public.lab_work_types wt WHERE wt.lab_organization_id=v_lab AND wt.id=(v_target->>'id')::bigint;
    ELSIF v_entity='work_order_price' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(wo) order by wo.id),'[]'::jsonb) INTO v_state
        FROM public.lab_work_orders wo WHERE wo.lab_organization_id=v_lab AND wo.id=(v_target->>'id')::bigint;
    ELSIF v_entity='material' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) INTO v_state
        FROM public.lab_materials_inventory m WHERE m.lab_organization_id=v_lab AND m.id=(v_target->>'id')::bigint;
    ELSIF v_entity='calendar_event' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) INTO v_state
        FROM public.lab_calendar_events e WHERE e.lab_organization_id=v_lab AND e.id=(v_target->>'id')::bigint
          AND (public.effective_lab_role(v_lab) IN ('admin','manager') OR e.calendar_scope='shared' OR e.owner_user_id=auth.uid());
    ELSE
        v_state:='[]'::jsonb;
    END IF;
    RETURN coalesce(v_state,'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.ai_operation_state(jsonb) FROM public,authenticated;
