-- Validate how an outstanding balance should remain on the assignment that is
-- about to be closed. Nothing is transferred to the new technician.
CREATE OR REPLACE FUNCTION public.prepare_stage_reassignment(
    p_lab uuid,
    p_work_order_id bigint,
    p_stage text,
    p_new_technician_name text,
    p_settlement text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stage text := lower(trim(coalesce(p_stage,'')));
    v_choice text := lower(trim(coalesce(p_settlement,'')));
    v_order public.lab_work_orders%rowtype;
    v_assignment public.lab_work_order_stage_assignments%rowtype;
    v_old_name text;
    v_new_name text := nullif(trim(coalesce(p_new_technician_name,'')),'');
    v_paid numeric;
    v_outstanding numeric;
BEGIN
    IF NOT public.is_lab_management(p_lab) THEN RAISE EXCEPTION 'Management access denied'; END IF;
    IF v_stage NOT IN ('model','modelare','cer_fin') THEN RAISE EXCEPTION 'Invalid stage'; END IF;

    SELECT * INTO v_order FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab AND id=p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;
    v_old_name := CASE v_stage WHEN 'model' THEN v_order.tehnician_model
        WHEN 'modelare' THEN v_order.tehnician1_modelare ELSE v_order.tehnician2_cer_fin END;
    IF lower(trim(coalesce(v_old_name,'')))=lower(trim(coalesce(v_new_name,''))) THEN RETURN true; END IF;

    SELECT * INTO v_assignment
    FROM public.lab_work_order_stage_assignments
    WHERE lab_organization_id=p_lab AND work_order_id=p_work_order_id
      AND stage_key=v_stage AND ended_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN RETURN true; END IF;

    SELECT coalesce(sum(amount),0) INTO v_paid
    FROM public.technician_payments WHERE assignment_id=v_assignment.id;
    v_outstanding := CASE WHEN v_assignment.agreed_amount IS NULL THEN 0
        ELSE greatest(v_assignment.agreed_amount-v_paid,0) END;
    IF v_outstanding<=0 THEN RETURN true; END IF;

    IF v_choice='pay_outstanding' THEN
        PERFORM public.set_stage_payment_status(p_lab,p_work_order_id,v_stage,'Paid');
    ELSIF v_choice='keep_outstanding' THEN
        NULL;
    ELSIF v_choice='' THEN
        RAISE EXCEPTION 'OUTSTANDING_ASSIGNMENT:%:%',v_stage,v_outstanding;
    ELSE
        RAISE EXCEPTION 'Settlement must be keep_outstanding or pay_outstanding';
    END IF;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_stage_reassignment(uuid,bigint,text,text,text) FROM public,authenticated;
