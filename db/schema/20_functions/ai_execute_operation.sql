CREATE OR REPLACE FUNCTION public.ai_execute_operation(p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_entity text; v_operation text; v_request_key text;
    v_normalized jsonb; v_hash text; v_existing public.ai_operation_requests%rowtype;
    v_preview public.ai_operation_previews%rowtype; v_requires_preview boolean; v_result jsonb;
    v_allowed text[]; v_allowed_target text[]; v_role text;
BEGIN
    v_role:=public.effective_lab_role(v_lab);
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'AI operation access denied'; END IF;
    IF jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Operation envelope must be an object'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_envelope) k WHERE k NOT IN ('entity','operation','target','fields','request_key','preview_id')) THEN RAISE EXCEPTION 'Unknown operation envelope field'; END IF;
    v_entity:=lower(trim(coalesce(p_envelope->>'entity',''))); v_operation:=lower(trim(coalesce(p_envelope->>'operation','')));
    IF (v_entity,v_operation) NOT IN (
        ('work_order','create'),('work_order','update'),('work_order','delete'),('work_order_price','set'),
        ('contract_price','create'),('contract_price','update'),('contract_price','delete'),('contract_price','duplicate'),
        ('technician_cost','create'),('technician_cost','update'),('technician_cost','delete'),('technician_cost','duplicate'),
        ('work_type','create'),('work_type','update'),('work_type','delete'),
        ('material','set'),('material','add'),('material','subtract'),
        ('calendar_event','create'),('calendar_event','update'),('calendar_event','delete')
    ) THEN RAISE EXCEPTION 'Unsupported AI entity or operation'; END IF;
    IF jsonb_typeof(coalesce(p_envelope->'target','{}'::jsonb))<>'object'
       OR jsonb_typeof(coalesce(p_envelope->'fields','{}'::jsonb))<>'object' THEN
        RAISE EXCEPTION 'Operation target and fields must be objects';
    END IF;
    v_request_key:=trim(coalesce(p_envelope->>'request_key',''));
    IF v_request_key='' THEN RAISE EXCEPTION 'Request key is required'; END IF;
    v_normalized:=(p_envelope-'preview_id'-'request_key')||jsonb_build_object('entity',v_entity,'operation',v_operation);
    v_hash:=md5(v_normalized::text);

    v_allowed:=case v_entity
      when 'work_order' then array['Deadline','Data_Receptie','Nume_Pacient','Nume_Partener','Tip_Lucrare','Nr_Elemente','Contract','Status','Discount','Tehnician_Model','Tehnician1_Modelare','Tehnician2_Cer_Fin','Status_Model','Status_Modelare','Status_Cer_Fin','Paid_Model','Paid_Modelare','Paid_Cer_Fin','Settlement_Model','Settlement_Modelare','Settlement_Cer_Fin','Locked']
      when 'work_order_price' then array['unit_price','discount','reason']
      when 'contract_price' then array['id','contract','work_type','price','source_contract','target_contract','conflict_mode']
      when 'technician_cost' then array['technician','work_type','stage','cost','source_technician','target_technician','conflict_mode']
      when 'work_type' then array['work_type','active']
      when 'material' then array['value','expected_quantity']
      when 'calendar_event' then array['title','event_type','description','status','start_date','end_date','start_time','calendar_scope'] else null end;
    IF v_allowed IS NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_envelope->'fields','{}'::jsonb)) k WHERE NOT k=ANY(v_allowed)) THEN RAISE EXCEPTION 'Unsupported field for AI entity'; END IF;
    v_allowed_target:=case v_entity
      when 'work_order' then array['id','ids']
      when 'work_order_price' then array['id']
      when 'contract_price' then array['id','source_contract','target_contract']
      when 'technician_cost' then array['source_row_no','source_technician','target_technician']
      when 'work_type' then array['id']
      when 'material' then array['id']
      when 'calendar_event' then array['id'] else array[]::text[] end;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_envelope->'target','{}'::jsonb)) k WHERE NOT k=ANY(v_allowed_target)) THEN RAISE EXCEPTION 'Unsupported target field for AI entity'; END IF;
    IF v_role='technician' AND v_entity NOT IN ('material','calendar_event') THEN RAISE EXCEPTION 'AI operation not allowed for Technician'; END IF;
    IF v_role='manager' AND v_entity NOT IN ('material','calendar_event') THEN RAISE EXCEPTION 'Admin access required for this AI operation'; END IF;

    -- A completed request is authoritative even after its destructive preview
    -- has been consumed. This makes network retries return the original result
    -- instead of failing with "preview already used".
    SELECT * INTO v_existing
    FROM public.ai_operation_requests
    WHERE lab_organization_id=v_lab AND request_key=v_request_key
    FOR UPDATE;
    IF FOUND THEN
        IF v_existing.requested_by_user_id<>auth.uid() THEN RAISE EXCEPTION 'Request key belongs to another user'; END IF;
        IF v_existing.envelope_hash<>v_hash THEN RAISE EXCEPTION 'Request key was already used for another operation'; END IF;
        IF v_existing.state='completed' THEN RETURN v_existing.result; END IF;
    END IF;

    INSERT INTO public.ai_operation_requests(lab_organization_id,request_key,requested_by_user_id,envelope_hash)
    VALUES(v_lab,v_request_key,auth.uid(),v_hash) ON CONFLICT DO NOTHING;
    SELECT * INTO v_existing
    FROM public.ai_operation_requests
    WHERE lab_organization_id=v_lab AND request_key=v_request_key
    FOR UPDATE;
    IF v_existing.requested_by_user_id<>auth.uid() THEN RAISE EXCEPTION 'Request key belongs to another user'; END IF;
    IF v_existing.envelope_hash<>v_hash THEN RAISE EXCEPTION 'Request key was already used for another operation'; END IF;
    IF v_existing.state='completed' THEN RETURN v_existing.result; END IF;

    v_requires_preview:=v_operation IN ('delete','duplicate') OR jsonb_array_length(coalesce(p_envelope#>'{target,ids}','[]'::jsonb))>1;
    IF v_requires_preview THEN
        IF nullif(p_envelope->>'preview_id','') IS NULL THEN RAISE EXCEPTION 'Confirmed preview is required'; END IF;
        SELECT * INTO v_preview FROM public.ai_operation_previews WHERE id=(p_envelope->>'preview_id')::uuid FOR UPDATE;
        IF NOT FOUND OR v_preview.lab_organization_id<>v_lab OR v_preview.requested_by_user_id<>auth.uid() OR v_preview.consumed_at IS NOT NULL OR v_preview.expires_at<=now() THEN RAISE EXCEPTION 'Preview is missing, expired or already used'; END IF;
        IF v_entity IN ('work_order','work_order_price') THEN
            PERFORM 1 FROM public.lab_work_orders wo
            WHERE wo.lab_organization_id=v_lab
              AND wo.id IN (SELECT value::bigint FROM jsonb_array_elements_text(
                  coalesce(v_normalized#>'{target,ids}',jsonb_build_array(v_normalized#>'{target,id}'))
              )) FOR UPDATE;
        ELSIF v_entity='contract_price' THEN
            PERFORM pg_advisory_xact_lock(hashtext(v_lab::text||':contract_price'));
            PERFORM 1 FROM public.lab_contract_work_prices cp
            WHERE cp.lab_organization_id=v_lab AND (
                cp.id=v_normalized#>>'{target,id}'
                OR lower(trim(cp.contract)) IN (
                    lower(trim(coalesce(v_normalized#>>'{fields,source_contract}',v_normalized#>>'{target,source_contract}',''))),
                    lower(trim(coalesce(v_normalized#>>'{fields,target_contract}',v_normalized#>>'{target,target_contract}','')))
                )
            ) FOR UPDATE;
        ELSIF v_entity='technician_cost' THEN
            PERFORM pg_advisory_xact_lock(hashtext(v_lab::text||':technician_cost'));
            PERFORM 1 FROM public.lab_technician_costs tc
            WHERE tc.lab_organization_id=v_lab AND (
                tc.source_row_no=nullif(v_normalized#>>'{target,source_row_no}','')::integer
                OR lower(trim(tc.tehnician)) IN (
                    lower(trim(coalesce(v_normalized#>>'{fields,source_technician}',v_normalized#>>'{target,source_technician}',''))),
                    lower(trim(coalesce(v_normalized#>>'{fields,target_technician}',v_normalized#>>'{target,target_technician}','')))
                )
            ) FOR UPDATE;
        ELSIF v_entity='work_type' THEN
            PERFORM 1 FROM public.lab_work_types wt WHERE wt.lab_organization_id=v_lab
              AND wt.id=nullif(v_normalized#>>'{target,id}','')::bigint FOR UPDATE;
        ELSIF v_entity='material' THEN
            PERFORM 1 FROM public.lab_materials_inventory m WHERE m.lab_organization_id=v_lab
              AND m.id=nullif(v_normalized#>>'{target,id}','')::bigint FOR UPDATE;
        ELSIF v_entity='calendar_event' THEN
            PERFORM 1 FROM public.lab_calendar_events e WHERE e.lab_organization_id=v_lab
              AND e.id=nullif(v_normalized#>>'{target,id}','')::bigint FOR UPDATE;
        END IF;
        IF v_preview.envelope<>v_normalized OR v_preview.checksum<>md5(public.ai_operation_state(v_normalized)::text) THEN RAISE EXCEPTION 'Preview is stale; review the operation again'; END IF;
    END IF;

    IF v_entity='work_order' THEN v_result:=public.ai_admin_work_order_operation(v_operation,coalesce(p_envelope->'target','{}'::jsonb),coalesce(p_envelope->'fields','{}'::jsonb));
    ELSIF v_entity IN ('contract_price','work_order_price') THEN v_result:=public.ai_admin_price_operation(v_entity,v_operation,coalesce(p_envelope->'target','{}'::jsonb),coalesce(p_envelope->'fields','{}'::jsonb));
    ELSIF v_entity='technician_cost' THEN v_result:=public.ai_admin_technician_cost_operation(v_operation,coalesce(p_envelope->'target','{}'::jsonb),coalesce(p_envelope->'fields','{}'::jsonb));
    ELSIF v_entity='work_type' THEN v_result:=public.ai_admin_config_operation(v_entity,v_operation,coalesce(p_envelope->'target','{}'::jsonb),coalesce(p_envelope->'fields','{}'::jsonb));
    ELSIF v_entity='material' THEN v_result:=public.adjust_material_quantity(
        v_lab,(p_envelope#>>'{target,id}')::bigint,v_operation,(p_envelope#>>'{fields,value}')::numeric,
        nullif(p_envelope#>>'{fields,expected_quantity}','')::numeric,v_request_key||':material');
    ELSIF v_entity='calendar_event' THEN v_result:=public.mutate_calendar_event(
        v_operation,nullif(p_envelope#>>'{target,id}','')::bigint,coalesce(p_envelope->'fields','{}'::jsonb),v_request_key||':calendar');
    ELSE RAISE EXCEPTION 'Unsupported AI entity or operation'; END IF;

    v_result:=v_result||jsonb_build_object('request_key',v_request_key);
    UPDATE public.ai_operation_requests SET state='completed',result=v_result,completed_at=now()
    WHERE lab_organization_id=v_lab AND request_key=v_request_key;
    IF v_requires_preview THEN UPDATE public.ai_operation_previews SET consumed_at=now() WHERE id=v_preview.id; END IF;
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'error',sqlerrm,'entity',v_entity,'operation',v_operation);
END; $$;
REVOKE ALL ON FUNCTION public.ai_execute_operation(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ai_execute_operation(jsonb) TO authenticated;
