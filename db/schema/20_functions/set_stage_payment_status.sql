CREATE OR REPLACE FUNCTION public.set_stage_payment_status(
    p_lab_organization_id uuid,
    p_work_order_id bigint,
    p_stage text,
    p_paid_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stage text := lower(trim(coalesce(p_stage,'')));
    v_paid text := trim(coalesce(p_paid_status,''));
    v_order public.lab_work_orders%rowtype;
    v_current text;
    v_technician text;
    v_assignment public.lab_work_order_stage_assignments%rowtype;
    v_net_paid numeric;
    v_outstanding numeric;
    v_payment_id uuid;
BEGIN
    IF NOT public.is_lab_management(p_lab_organization_id) THEN
        RAISE EXCEPTION 'Management access denied';
    END IF;
    IF v_stage NOT IN ('model','modelare','cer_fin') THEN RAISE EXCEPTION 'Invalid stage'; END IF;
    IF lower(v_paid) NOT IN ('paid','not paid') THEN RAISE EXCEPTION 'Payment status must be Paid or Not Paid'; END IF;

    SELECT * INTO v_order FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;

    v_current := case v_stage when 'model' then v_order.paid_model
        when 'modelare' then v_order.paid_modelare else v_order.paid_cer_fin end;
    v_technician := case v_stage when 'model' then v_order.tehnician_model
        when 'modelare' then v_order.tehnician1_modelare else v_order.tehnician2_cer_fin end;
    IF lower(coalesce(v_current,'not paid')) = lower(v_paid) THEN RETURN true; END IF;

    SELECT * INTO v_assignment FROM public.lab_work_order_stage_assignments
    WHERE lab_organization_id=p_lab_organization_id AND work_order_id=p_work_order_id
      AND stage_key=v_stage AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,v_stage,v_technician);
        SELECT * INTO v_assignment FROM public.lab_work_order_stage_assignments
        WHERE lab_organization_id=p_lab_organization_id AND work_order_id=p_work_order_id
          AND stage_key=v_stage AND ended_at IS NULL FOR UPDATE;
    END IF;
    IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'Technician assignment is required before payment'; END IF;

    SELECT coalesce(sum(amount),0) INTO v_net_paid
    FROM public.technician_payments WHERE assignment_id=v_assignment.id;
    v_outstanding := v_assignment.agreed_amount - v_net_paid;

    IF lower(v_paid)='paid' THEN
        IF v_assignment.agreed_amount IS NULL THEN RAISE EXCEPTION 'Assignment cost is missing'; END IF;
        IF v_outstanding > 0 THEN
            PERFORM public.record_technician_payment(
                v_assignment.id,v_outstanding,current_date,
                'legacy-paid:'||v_assignment.id::text||':'||txid_current()::text
            );
        END IF;
    ELSE
        SELECT p.id INTO v_payment_id
        FROM public.technician_payments p
        WHERE p.assignment_id=v_assignment.id AND p.amount>0
          AND NOT EXISTS (SELECT 1 FROM public.technician_payments r WHERE r.reversal_of=p.id)
        ORDER BY p.recorded_at DESC LIMIT 1;
        IF v_payment_id IS NOT NULL THEN
            PERFORM public.reverse_technician_payment(
                v_payment_id,'Legacy payment status changed to Not Paid',
                'legacy-reversal:'||v_payment_id::text
            );
        END IF;
    END IF;

    IF v_stage='model' THEN
        UPDATE public.lab_work_orders SET paid_model=v_paid,updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
    ELSIF v_stage='modelare' THEN
        UPDATE public.lab_work_orders SET paid_modelare=v_paid,updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
    ELSE
        UPDATE public.lab_work_orders SET paid_cer_fin=v_paid,updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;
    END IF;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_stage_payment_status(uuid,bigint,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_stage_payment_status(uuid,bigint,text,text) TO authenticated;
