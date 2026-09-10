-- Internal aggregate; original agreed amount and all deltas remain immutable.
CREATE OR REPLACE FUNCTION public.assignment_agreed_amount(p_assignment uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT CASE WHEN a.agreed_amount IS NULL OR EXISTS(
        SELECT 1 FROM public.lab_work_order_assignment_adjustments d WHERE d.assignment_id=a.id AND d.amount IS NULL
    ) THEN NULL ELSE a.agreed_amount+coalesce((
        SELECT sum(d.amount) FROM public.lab_work_order_assignment_adjustments d WHERE d.assignment_id=a.id
    ),0) END FROM public.lab_work_order_stage_assignments a WHERE a.id=p_assignment
$$;
REVOKE ALL ON FUNCTION public.assignment_agreed_amount(uuid) FROM public,authenticated;

-- Internal current-stage status: adjustments and signed payments are authoritative.
CREATE OR REPLACE FUNCTION public.work_order_stage_payment_status(p_lab uuid,p_order bigint,p_stage text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM public.lab_work_order_stage_assignments a
        WHERE a.lab_organization_id=p_lab AND a.work_order_id=p_order
          AND a.stage_key=p_stage AND a.ended_at IS NULL
          AND public.assignment_agreed_amount(a.id) IS NOT NULL
          AND coalesce((SELECT sum(p.amount) FROM public.technician_payments p WHERE p.assignment_id=a.id),0)
              >= public.assignment_agreed_amount(a.id)
    ) THEN 'Paid' ELSE 'Not Paid' END
$$;
REVOKE ALL ON FUNCTION public.work_order_stage_payment_status(uuid,bigint,text) FROM public,anon,authenticated;
