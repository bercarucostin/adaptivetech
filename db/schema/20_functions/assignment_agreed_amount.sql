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
