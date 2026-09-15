CREATE OR REPLACE FUNCTION public.ai_admin_config_operation(
    p_entity text,p_operation text,p_target jsonb,p_fields jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_entity text:=lower(trim(p_entity)); v_op text:=lower(trim(p_operation));
    v_count integer:=0; v_id bigint; v_billing_mode text;
BEGIN
    IF lower(coalesce(public.current_org_role(v_lab),''))<>'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
    IF v_entity<>'work_type' THEN RAISE EXCEPTION 'Unsupported configuration entity'; END IF;
    IF p_fields?'billing_mode' OR v_op='create' THEN
        v_billing_mode:=coalesce(nullif(lower(trim(p_fields->>'billing_mode')),''),'per_tooth');
        IF v_billing_mode NOT IN ('per_tooth','per_arch','per_piece') THEN
            RAISE EXCEPTION 'Unknown billing mode: %',coalesce(p_fields->>'billing_mode','');
        END IF;
    END IF;
    IF v_op='create' THEN
        IF trim(coalesce(p_fields->>'work_type',''))='' THEN RAISE EXCEPTION 'Work type is required'; END IF;
        PERFORM pg_advisory_xact_lock(hashtext(v_lab::text||':work_type'));
        SELECT coalesce(max(id),0)+1 INTO v_id FROM public.lab_work_types WHERE lab_organization_id=v_lab;
        INSERT INTO public.lab_work_types(lab_organization_id,id,tip_lucrare,active,billing_mode,updated_at)
        VALUES(v_lab,v_id,trim(p_fields->>'work_type'),coalesce((p_fields->>'active')::boolean,true),v_billing_mode,now()); v_count:=1;
    ELSIF v_op='update' THEN
        UPDATE public.lab_work_types SET
            tip_lucrare=coalesce(nullif(trim(p_fields->>'work_type'),''),tip_lucrare),
            active=case when p_fields?'active' then (p_fields->>'active')::boolean else active end,
            billing_mode=case when p_fields?'billing_mode' then v_billing_mode else billing_mode end,
            updated_at=now()
        WHERE lab_organization_id=v_lab AND id=(p_target->>'id')::bigint; GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSIF v_op='delete' THEN
        DELETE FROM public.lab_work_types WHERE lab_organization_id=v_lab AND id=(p_target->>'id')::bigint; GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSE RAISE EXCEPTION 'Unsupported work type operation'; END IF;
    IF v_count=0 THEN RAISE EXCEPTION 'Work type target not found'; END IF;
    RETURN jsonb_build_object('ok',true,'entity',v_entity,'operation',v_op,'count',v_count,'ids',case when v_id is null then jsonb_build_array(p_target->'id') else jsonb_build_array(v_id) end);
END; $$;
REVOKE ALL ON FUNCTION public.ai_admin_config_operation(text,text,jsonb,jsonb) FROM public,authenticated;
