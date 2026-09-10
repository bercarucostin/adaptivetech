-- Internal writer shared by all atomic role RPCs. Tooth scope always comes from items.
CREATE OR REPLACE FUNCTION public.save_work_order_clinical_case(p_lab uuid,p_order_id bigint,p_case jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_order public.lab_work_orders%rowtype;
    v_id bigint;
    v_case public.lab_patient_cases%rowtype;
    v_details jsonb;
    v_teeth text;
    v_case_metadata jsonb;
    v_key text;
BEGIN
    p_case:=coalesce(p_case,'{}'::jsonb);
    IF jsonb_typeof(p_case)<>'object' THEN RAISE EXCEPTION 'Clinical case must be an object'; END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_case) LOOP
        IF v_key NOT IN ('tooth_details','tooth_details_json','clinic_note','shade','method','production_notes') THEN
            RAISE EXCEPTION 'Unsupported clinical case field: %',v_key;
        END IF;
        IF v_key IN ('clinic_note','shade','method','production_notes') AND jsonb_typeof(p_case->v_key) NOT IN ('string','null') THEN
            RAISE EXCEPTION 'Clinical case field % must be text',v_key;
        END IF;
    END LOOP;
    IF p_case ? 'tooth_details' AND p_case ? 'tooth_details_json' THEN
        RAISE EXCEPTION 'Supply tooth_details or tooth_details_json, not both';
    END IF;
    SELECT * INTO v_order FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab AND id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;
    SELECT * INTO v_case FROM public.lab_patient_cases
    WHERE lab_organization_id=p_lab AND work_order_id=p_order_id ORDER BY id LIMIT 1;
    v_id:=v_case.id;
    IF v_id IS NULL THEN
        v_id:=p_order_id;
        IF EXISTS(SELECT 1 FROM public.lab_patient_cases WHERE lab_organization_id=p_lab AND id=v_id) THEN
            SELECT coalesce(max(id),0)+1 INTO v_id FROM public.lab_patient_cases WHERE lab_organization_id=p_lab;
        END IF;
    END IF;
    v_details:=public.sanitize_tooth_details(coalesce(
        p_case->'tooth_details',
        CASE WHEN jsonb_typeof(p_case->'tooth_details_json')='string' THEN (p_case->>'tooth_details_json')::jsonb
             ELSE p_case->'tooth_details_json' END,
        nullif(v_case.tooth_details_json,'')::jsonb,'{}'::jsonb));
    IF jsonb_typeof(v_details)<>'object' THEN RAISE EXCEPTION 'Tooth details must be an object'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(v_details) d
        WHERE (d.key<>'__case' AND d.key !~ '^[1-4][1-8]$') OR jsonb_typeof(d.value)<>'object') THEN
        RAISE EXCEPTION 'Tooth details must map FDI numbers or __case to objects';
    END IF;
    v_case_metadata:=coalesce(v_details->'__case','{}'::jsonb);
    -- Discard stale tooth entries and overwrite clinical work types with canonical scope.
    SELECT coalesce(jsonb_object_agg(i.tooth_number::text,
        coalesce(v_details->i.tooth_number::text,'{}'::jsonb)||jsonb_build_object('work_type',i.work_type,'type',i.work_type)),'{}'::jsonb),
        string_agg(i.tooth_number::text,',' ORDER BY i.tooth_number)
    INTO v_details,v_teeth FROM public.lab_work_order_items i
    WHERE i.lab_organization_id=p_lab AND i.work_order_id=p_order_id;
    IF v_case_metadata<>'{}'::jsonb THEN v_details:=v_details||jsonb_build_object('__case',v_case_metadata); END IF;
    INSERT INTO public.lab_patient_cases(lab_organization_id,id,work_order_id,nume_pacient,nume_partener,
        deadline,selected_teeth,tooth_details_json,shade,method,clinic_note,production_notes,
        created_by_user_id,created_at,updated_by_user_id,updated_at)
    VALUES(p_lab,v_id,p_order_id,v_order.nume_pacient,v_order.nume_partener,v_order.deadline,v_teeth,v_details::text,
        coalesce(p_case->>'shade',v_case.shade),coalesce(p_case->>'method',v_case.method),
        coalesce(p_case->>'clinic_note',v_case.clinic_note),
        CASE WHEN public.is_lab_management(p_lab) THEN coalesce(p_case->>'production_notes',v_case.production_notes) ELSE v_case.production_notes END,
        public.current_legacy_user_id(),now(),public.current_legacy_user_id(),now())
    ON CONFLICT(lab_organization_id,id) DO UPDATE SET
        nume_pacient=excluded.nume_pacient,nume_partener=excluded.nume_partener,deadline=excluded.deadline,
        selected_teeth=excluded.selected_teeth,tooth_details_json=excluded.tooth_details_json,
        shade=excluded.shade,method=excluded.method,clinic_note=excluded.clinic_note,production_notes=excluded.production_notes,
        updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at;
    RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_work_order_clinical_case(uuid,bigint,jsonb) FROM public,authenticated;
