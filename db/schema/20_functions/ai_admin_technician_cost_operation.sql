CREATE OR REPLACE FUNCTION public.ai_admin_technician_cost_operation(
    p_operation text,p_target jsonb,p_fields jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_op text:=lower(trim(p_operation));
    v_source text; v_destination text; v_mode text; v_count integer:=0; v_next integer;
BEGIN
    IF lower(coalesce(public.current_org_role(v_lab),''))<>'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext(v_lab::text||':technician_cost'));
    SELECT coalesce(max(source_row_no),0)+1 INTO v_next FROM public.lab_technician_costs WHERE lab_organization_id=v_lab;

    IF v_op='duplicate' THEN
        v_source:=trim(coalesce(p_fields->>'source_technician',p_target->>'source_technician',''));
        v_destination:=trim(coalesce(p_fields->>'target_technician',p_target->>'target_technician',''));
        v_mode:=lower(trim(coalesce(p_fields->>'conflict_mode','')));
        IF v_source='' OR v_destination='' OR lower(v_source)=lower(v_destination) THEN RAISE EXCEPTION 'Distinct source and target technician names are required'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.lab_technician_costs WHERE lab_organization_id=v_lab AND lower(trim(tehnician))=lower(v_source)) THEN RAISE EXCEPTION 'Source technician costs not found'; END IF;
        IF EXISTS (SELECT 1 FROM public.lab_technician_costs WHERE lab_organization_id=v_lab AND lower(trim(tehnician))=lower(v_destination)) THEN
            IF v_mode NOT IN ('append','replace') THEN RAISE EXCEPTION 'Target technician already has costs; choose append or replace'; END IF;
            IF v_mode='replace' THEN DELETE FROM public.lab_technician_costs WHERE lab_organization_id=v_lab AND lower(trim(tehnician))=lower(v_destination); END IF;
        END IF;
        INSERT INTO public.lab_technician_costs(lab_organization_id,source_row_no,legacy_id,tehnician,tip_lucrare,etapa,cost,updated_at)
        SELECT v_lab,(v_next+row_number() over(order by source_row_no)-1)::integer,
               'cost_'||gen_random_uuid()::text,v_destination,tip_lucrare,etapa,cost,now()
        FROM public.lab_technician_costs
        WHERE lab_organization_id=v_lab AND lower(trim(tehnician))=lower(v_source)
        ORDER BY source_row_no;
        GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSIF v_op='create' THEN
        IF trim(coalesce(p_fields->>'technician',''))='' OR trim(coalesce(p_fields->>'work_type',''))='' OR trim(coalesce(p_fields->>'stage',''))='' OR NOT (p_fields?'cost') THEN RAISE EXCEPTION 'Technician, work type, stage and cost are required'; END IF;
        IF (p_fields->>'cost')::numeric<0 THEN RAISE EXCEPTION 'Cost cannot be negative'; END IF;
        INSERT INTO public.lab_technician_costs(lab_organization_id,source_row_no,legacy_id,tehnician,tip_lucrare,etapa,cost,updated_at)
        VALUES(v_lab,v_next,'cost_'||gen_random_uuid()::text,trim(p_fields->>'technician'),trim(p_fields->>'work_type'),trim(p_fields->>'stage'),(p_fields->>'cost')::numeric,now());
        v_count:=1;
    ELSIF v_op='update' THEN
        IF p_fields?'cost' AND (p_fields->>'cost')::numeric<0 THEN RAISE EXCEPTION 'Cost cannot be negative'; END IF;
        UPDATE public.lab_technician_costs SET
            tehnician=coalesce(nullif(trim(p_fields->>'technician'),''),tehnician),
            tip_lucrare=coalesce(nullif(trim(p_fields->>'work_type'),''),tip_lucrare),
            etapa=coalesce(nullif(trim(p_fields->>'stage'),''),etapa),
            cost=case when p_fields?'cost' then (p_fields->>'cost')::numeric else cost end,updated_at=now()
        WHERE lab_organization_id=v_lab AND source_row_no=(p_target->>'source_row_no')::integer;
        GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSIF v_op='delete' THEN
        DELETE FROM public.lab_technician_costs WHERE lab_organization_id=v_lab AND source_row_no=(p_target->>'source_row_no')::integer;
        GET DIAGNOSTICS v_count=ROW_COUNT;
    ELSE RAISE EXCEPTION 'Unsupported technician cost operation'; END IF;
    IF v_count=0 THEN RAISE EXCEPTION 'Technician cost target not found'; END IF;
    RETURN jsonb_build_object('ok',true,'entity','technician_cost','operation',v_op,'count',v_count,'target_technician',v_destination);
END; $$;
REVOKE ALL ON FUNCTION public.ai_admin_technician_cost_operation(text,jsonb,jsonb) FROM public,authenticated;
