CREATE OR REPLACE FUNCTION public.ai_preview_operation(p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_normalized jsonb; v_state jsonb; v_checksum text;
    v_id uuid; v_entity text; v_operation text; v_role text; v_expires timestamptz:=now()+interval '5 minutes';
    v_allowed text[]; v_allowed_target text[];
BEGIN
    v_role:=public.effective_lab_role(v_lab);
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'AI operation access denied'; END IF;
    IF jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Operation envelope must be an object'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_envelope) k WHERE k NOT IN ('entity','operation','target','fields','request_key','preview_id')) THEN RAISE EXCEPTION 'Unknown operation envelope field'; END IF;
    IF jsonb_typeof(coalesce(p_envelope->'target','{}'::jsonb))<>'object'
       OR jsonb_typeof(coalesce(p_envelope->'fields','{}'::jsonb))<>'object' THEN
        RAISE EXCEPTION 'Operation target and fields must be objects';
    END IF;
    v_entity:=lower(trim(coalesce(p_envelope->>'entity',''))); v_operation:=lower(trim(coalesce(p_envelope->>'operation','')));
    IF trim(coalesce(p_envelope->>'request_key',''))='' THEN RAISE EXCEPTION 'Request key is required'; END IF;
    IF (v_entity,v_operation) NOT IN (
        ('work_order','create'),('work_order','update'),('work_order','delete'),('work_order_price','set'),
        ('contract_price','create'),('contract_price','update'),('contract_price','delete'),('contract_price','duplicate'),
        ('technician_cost','create'),('technician_cost','update'),('technician_cost','delete'),('technician_cost','duplicate'),
        ('work_type','create'),('work_type','update'),('work_type','delete'),
        ('material','set'),('material','add'),('material','subtract'),
        ('calendar_event','create'),('calendar_event','update'),('calendar_event','delete')
    ) THEN RAISE EXCEPTION 'Unsupported AI entity or operation'; END IF;
    v_allowed:=case v_entity
      when 'work_order' then array['Deadline','Data_Receptie','Nume_Pacient','Nume_Partener','items','case','Contract','Status','Discount','Tehnician_Model','Tehnician1_Modelare','Tehnician2_Cer_Fin','Status_Model','Status_Modelare','Status_Cer_Fin','Paid_Model','Paid_Modelare','Paid_Cer_Fin','Model_Not_Applicable','Modelare_Not_Applicable','Cer_Fin_Not_Applicable','Locked']
      when 'work_order_price' then array['unit_price','discount','reason']
      when 'contract_price' then array['id','contract','work_type','price','source_contract','target_contract','conflict_mode']
      when 'technician_cost' then array['technician','work_type','stage','cost','source_technician','target_technician','conflict_mode']
      when 'work_type' then array['work_type','active']
      when 'material' then array['value','expected_quantity']
      when 'calendar_event' then array['title','event_type','description','status','start_date','end_date','start_time','calendar_scope'] else null end;
    IF v_allowed IS NULL OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(coalesce(p_envelope->'fields','{}'::jsonb)) k WHERE NOT k=ANY(v_allowed)
    ) THEN RAISE EXCEPTION 'Unsupported field for AI entity'; END IF;
    v_allowed_target:=case v_entity
      when 'work_order' then array['id','ids']
      when 'work_order_price' then array['id']
      when 'contract_price' then array['id','source_contract','target_contract']
      when 'technician_cost' then array['source_row_no','source_technician','target_technician']
      when 'work_type' then array['id']
      when 'material' then array['id']
      when 'calendar_event' then array['id'] else array[]::text[] end;
    IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(coalesce(p_envelope->'target','{}'::jsonb)) k WHERE NOT k=ANY(v_allowed_target)
    ) THEN RAISE EXCEPTION 'Unsupported target field for AI entity'; END IF;
    IF v_role='technician' AND v_entity NOT IN ('material','calendar_event') THEN RAISE EXCEPTION 'AI operation not allowed for Technician'; END IF;
    IF v_role='manager' AND v_entity NOT IN ('material','calendar_event') THEN RAISE EXCEPTION 'Admin access required for this AI operation'; END IF;
    v_normalized:=(p_envelope-'preview_id'-'request_key')||jsonb_build_object('entity',v_entity,'operation',v_operation);
    v_state:=public.ai_operation_state(v_normalized); v_checksum:=md5(v_state::text);
    INSERT INTO public.ai_operation_previews(
        lab_organization_id,requested_by_user_id,envelope,targets,before_value,after_value,checksum,expires_at
    ) VALUES(
        v_lab,auth.uid(),v_normalized,coalesce(v_normalized->'target','{}'::jsonb),v_state,
        coalesce(v_normalized->'fields','{}'::jsonb),v_checksum,v_expires
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'preview_id',v_id,'expires_at',v_expires,
        'entity',v_entity,'operation',v_operation,'targets',coalesce(v_normalized->'target','{}'::jsonb),
        'before',v_state,'after',coalesce(v_normalized->'fields','{}'::jsonb),'checksum',v_checksum);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'error',sqlerrm);
END; $$;
REVOKE ALL ON FUNCTION public.ai_preview_operation(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.ai_preview_operation(jsonb) TO authenticated;
