CREATE OR REPLACE FUNCTION public.upsert_patient_case(
    p_lab_organization_id uuid,p_work_order_id bigint,p_items jsonb,p_case jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.lab_work_orders%rowtype;
BEGIN
    IF NOT (public.is_lab_management(p_lab_organization_id) OR public.is_connected_doctor_for_lab(p_lab_organization_id)) THEN
        RAISE EXCEPTION 'Patient case write denied';
    END IF;
    SELECT * INTO v_order FROM public.lab_work_orders WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;
    IF NOT public.is_lab_management(p_lab_organization_id) THEN
        IF NOT public.doctor_matches_partner(v_order.nume_partener) THEN RAISE EXCEPTION 'Work Order access denied'; END IF;
        IF v_order.locked OR lower(coalesce(v_order.status,''))<>'not started' THEN RAISE EXCEPTION 'Doctor can edit only unlocked Not Started Work Orders'; END IF;
    END IF;
    PERFORM public.replace_work_order_items(p_lab_organization_id,p_work_order_id,p_items,v_order.contract);
    RETURN public.save_work_order_clinical_case(p_lab_organization_id,p_work_order_id,p_case);
END; $$;
