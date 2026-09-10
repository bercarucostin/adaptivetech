CREATE OR REPLACE FUNCTION public.save_my_work_order_case(
    p_lab_organization_id uuid,p_work_order_id bigint,
    p_status_model text,p_status_modelare text,p_status_cer_fin text,
    p_items jsonb,p_case jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.lab_work_orders%rowtype;
BEGIN
    IF NOT public.is_lab_technician(p_lab_organization_id) THEN RAISE EXCEPTION 'Technician access denied'; END IF;
    IF NOT public.can_access_work_order(p_lab_organization_id,p_work_order_id) THEN RAISE EXCEPTION 'Work Order access denied'; END IF;
    SELECT * INTO v_order FROM public.lab_work_orders WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;
    IF v_order.locked THEN RAISE EXCEPTION 'Work Order is locked'; END IF;
    PERFORM public.replace_work_order_items(p_lab_organization_id,p_work_order_id,p_items,v_order.contract);
    IF p_status_model IS NOT NULL THEN PERFORM public.update_my_stage_status(p_lab_organization_id,p_work_order_id,'model',p_status_model); END IF;
    IF p_status_modelare IS NOT NULL THEN PERFORM public.update_my_stage_status(p_lab_organization_id,p_work_order_id,'modelare',p_status_modelare); END IF;
    IF p_status_cer_fin IS NOT NULL THEN PERFORM public.update_my_stage_status(p_lab_organization_id,p_work_order_id,'cer_fin',p_status_cer_fin); END IF;
    RETURN public.save_work_order_clinical_case(p_lab_organization_id,p_work_order_id,p_case);
END; $$;
REVOKE ALL ON FUNCTION public.save_my_work_order_case(uuid,bigint,text,text,text,jsonb,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.save_my_work_order_case(uuid,bigint,text,text,text,jsonb,jsonb) TO authenticated;
