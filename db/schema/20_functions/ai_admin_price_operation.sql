CREATE OR REPLACE FUNCTION public.ai_admin_price_operation(
    p_entity text,p_operation text,p_target jsonb,p_fields jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_entity text:=lower(trim(p_entity)); v_op text:=lower(trim(p_operation));
    v_count integer:=0; v_source text; v_destination text; v_mode text; v_id text;
BEGIN
    IF lower(coalesce(public.current_org_role(v_lab),''))<>'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
    IF v_entity='work_order_price' AND v_op='set' THEN
        IF NOT (p_fields?'unit_price') OR NOT (p_fields?'discount') OR trim(coalesce(p_fields->>'reason',''))='' THEN
            RAISE EXCEPTION 'Unit price, discount and reason are required';
        END IF;
        RETURN jsonb_build_object('ok',true,'entity',v_entity,'operation',v_op,'count',1,'values',
            public.set_work_order_price_snapshot(v_lab,(p_target->>'id')::bigint,(p_fields->>'unit_price')::numeric,
                coalesce((p_fields->>'discount')::numeric,0),p_fields->>'reason'));
    END IF;
    IF v_entity<>'contract_price' THEN RAISE EXCEPTION 'Unsupported price entity'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext(v_lab::text||':contract_price'));

    IF v_op='duplicate' THEN
        v_source:=trim(coalesce(p_fields->>'source_contract',p_target->>'source_contract',''));
        v_destination:=trim(coalesce(p_fields->>'target_contract',p_target->>'target_contract',''));
        v_mode:=lower(trim(coalesce(p_fields->>'conflict_mode','')));
        IF v_source='' OR v_destination='' OR lower(v_source)=lower(v_destination) THEN RAISE EXCEPTION 'Distinct source and target contracts are required'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.lab_contract_work_prices WHERE lab_organization_id=v_lab AND lower(trim(contract))=lower(v_source)) THEN RAISE EXCEPTION 'Source contract prices not found'; END IF;
        IF EXISTS (SELECT 1 FROM public.lab_contract_work_prices WHERE lab_organization_id=v_lab AND lower(trim(contract))=lower(v_destination)) THEN
            IF v_mode NOT IN ('append','replace') THEN RAISE EXCEPTION 'Target contract already has prices; choose append or replace'; END IF;
            IF v_mode='replace' THEN DELETE FROM public.lab_contract_work_prices WHERE lab_organization_id=v_lab AND lower(trim(contract))=lower(v_destination); END IF;
        END IF;
        INSERT INTO public.lab_contract_work_prices(lab_organization_id,id,contract,tip_lucrare,pret,updated_at)
        SELECT v_lab,'price_'||gen_random_uuid()::text,v_destination,tip_lucrare,pret,now()
        FROM public.lab_contract_work_prices WHERE lab_organization_id=v_lab AND lower(trim(contract))=lower(v_source);
        GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSIF v_op='create' THEN
        IF trim(coalesce(p_fields->>'contract',''))='' OR trim(coalesce(p_fields->>'work_type',''))='' OR NOT (p_fields?'price') THEN RAISE EXCEPTION 'Contract, work type and price are required'; END IF;
        IF (p_fields->>'price')::numeric<0 THEN RAISE EXCEPTION 'Price cannot be negative'; END IF;
        v_id:=coalesce(nullif(trim(p_fields->>'id'),''),'price_'||gen_random_uuid()::text);
        INSERT INTO public.lab_contract_work_prices(lab_organization_id,id,contract,tip_lucrare,pret,updated_at)
        VALUES(v_lab,v_id,trim(p_fields->>'contract'),trim(p_fields->>'work_type'),(p_fields->>'price')::numeric,now()); v_count:=1;
    ELSIF v_op='update' THEN
        IF p_fields?'price' AND (p_fields->>'price')::numeric<0 THEN RAISE EXCEPTION 'Price cannot be negative'; END IF;
        UPDATE public.lab_contract_work_prices SET
            contract=coalesce(nullif(trim(p_fields->>'contract'),''),contract),
            tip_lucrare=coalesce(nullif(trim(p_fields->>'work_type'),''),tip_lucrare),
            pret=case when p_fields?'price' then (p_fields->>'price')::numeric else pret end,updated_at=now()
        WHERE lab_organization_id=v_lab AND id=p_target->>'id'; GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSIF v_op='delete' THEN
        DELETE FROM public.lab_contract_work_prices WHERE lab_organization_id=v_lab AND id=p_target->>'id'; GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSE RAISE EXCEPTION 'Unsupported contract price operation'; END IF;
    IF v_count=0 THEN RAISE EXCEPTION 'Contract price target not found'; END IF;
    RETURN jsonb_build_object('ok',true,'entity',v_entity,'operation',v_op,'count',v_count);
END; $$;
REVOKE ALL ON FUNCTION public.ai_admin_price_operation(text,text,jsonb,jsonb) FROM public,authenticated;
