CREATE OR REPLACE FUNCTION public.record_technician_payment(
    p_assignment_id uuid,
    p_amount numeric,
    p_paid_on date,
    p_request_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_assignment public.lab_work_order_stage_assignments%rowtype;
    v_existing uuid;
    v_paid numeric;
    v_outstanding numeric;
    v_id uuid;
BEGIN
    SELECT * INTO v_assignment FROM public.lab_work_order_stage_assignments
    WHERE id = p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Technician assignment not found'; END IF;
    IF NOT public.is_lab_management(v_assignment.lab_organization_id) THEN
        RAISE EXCEPTION 'Management access denied';
    END IF;
    IF trim(coalesce(p_request_key,'')) = '' THEN RAISE EXCEPTION 'Payment request key is required'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
    IF p_paid_on IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;

    SELECT id INTO v_existing FROM public.technician_payments
    WHERE lab_organization_id=v_assignment.lab_organization_id AND request_key=p_request_key;
    IF FOUND THEN RETURN v_existing; END IF;
    IF v_assignment.agreed_amount IS NULL THEN RAISE EXCEPTION 'Assignment cost is missing'; END IF;

    SELECT coalesce(sum(amount),0) INTO v_paid
    FROM public.technician_payments WHERE assignment_id=p_assignment_id;
    v_outstanding := v_assignment.agreed_amount - v_paid;
    IF p_amount > v_outstanding THEN RAISE EXCEPTION 'Payment exceeds outstanding amount'; END IF;

    INSERT INTO public.technician_payments (
        lab_organization_id,assignment_id,amount,paid_on,recorded_by_user_id,request_key
    ) VALUES (
        v_assignment.lab_organization_id,p_assignment_id,round(p_amount,2),p_paid_on,auth.uid(),p_request_key
    ) RETURNING id INTO v_id;

    INSERT INTO public.work_order_financial_audit (
        lab_organization_id,work_order_id,entity_type,entity_id,action,before_value,after_value,changed_by_user_id
    ) VALUES (
        v_assignment.lab_organization_id,v_assignment.work_order_id,'technician_payment',v_id::text,
        'payment',jsonb_build_object('outstanding',v_outstanding),
        jsonb_build_object('amount',round(p_amount,2),'paid_on',p_paid_on),auth.uid()
    );
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_technician_payment(uuid,numeric,date,text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_technician_payment(uuid,numeric,date,text) TO authenticated;
