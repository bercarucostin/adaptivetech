CREATE OR REPLACE FUNCTION public.reverse_technician_payment(
    p_payment_id uuid,
    p_reason text,
    p_request_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment public.technician_payments%rowtype;
    v_assignment public.lab_work_order_stage_assignments%rowtype;
    v_existing public.technician_payments%rowtype;
    v_id uuid;
BEGIN
    SELECT * INTO v_payment FROM public.technician_payments WHERE id=p_payment_id FOR UPDATE;
    IF NOT FOUND OR v_payment.amount <= 0 THEN RAISE EXCEPTION 'Reversible payment not found'; END IF;
    SELECT * INTO v_assignment FROM public.lab_work_order_stage_assignments WHERE id=v_payment.assignment_id;
    IF NOT public.is_lab_management(v_payment.lab_organization_id) THEN RAISE EXCEPTION 'Management access denied'; END IF;
    IF trim(coalesce(p_reason,'')) = '' THEN RAISE EXCEPTION 'Reversal reason is required'; END IF;
    IF trim(coalesce(p_request_key,'')) = '' THEN RAISE EXCEPTION 'Reversal request key is required'; END IF;

    SELECT * INTO v_existing FROM public.technician_payments
    WHERE lab_organization_id=v_payment.lab_organization_id AND request_key=p_request_key;
    IF FOUND THEN
        IF v_existing.recorded_by_user_id IS DISTINCT FROM auth.uid()
           OR v_existing.reversal_of IS DISTINCT FROM p_payment_id THEN
            RAISE EXCEPTION 'Reversal request key was already used for another payment';
        END IF;
        RETURN v_existing.id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.technician_payments WHERE reversal_of=p_payment_id) THEN
        RAISE EXCEPTION 'Payment is already reversed';
    END IF;

    INSERT INTO public.technician_payments (
        lab_organization_id,assignment_id,amount,paid_on,recorded_by_user_id,
        request_key,reversal_of,note
    ) VALUES (
        v_payment.lab_organization_id,v_payment.assignment_id,-v_payment.amount,
        (current_timestamp at time zone 'Europe/Bucharest')::date,auth.uid(),p_request_key,p_payment_id,trim(p_reason)
    ) RETURNING id INTO v_id;

    INSERT INTO public.work_order_financial_audit (
        lab_organization_id,work_order_id,entity_type,entity_id,action,before_value,after_value,changed_by_user_id
    ) VALUES (
        v_payment.lab_organization_id,v_assignment.work_order_id,'technician_payment',v_id::text,
        'reversal',to_jsonb(v_payment),jsonb_build_object('reason',trim(p_reason),'amount',-v_payment.amount),auth.uid()
    );
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_technician_payment(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.reverse_technician_payment(uuid,text,text) TO authenticated;
