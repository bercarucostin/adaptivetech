CREATE OR REPLACE FUNCTION public.get_my_salary(p_lab_organization_id uuid)
RETURNS TABLE (
    work_order_id bigint,
    stage_key text,
    stage_label text,
    stage_status text,
    payment_status text,
    unit_cost numeric,
    amount numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_technician text := trim(coalesce(public.current_technician_name(),''));
BEGIN
    IF NOT public.is_lab_technician(p_lab_organization_id) THEN RAISE EXCEPTION 'Technician access denied'; END IF;
    IF v_technician='' THEN RAISE EXCEPTION 'Technician profile mapping is missing'; END IF;

    RETURN QUERY
    SELECT a.work_order_id,
           CASE a.stage_key WHEN 'model' THEN 'Model' WHEN 'modelare' THEN 'Modelare' ELSE 'Cer_Fin' END,
           CASE a.stage_key WHEN 'model' THEN 'Model' WHEN 'modelare' THEN 'Modelare' ELSE 'Cer / Fin' END,
           CASE a.stage_key WHEN 'model' THEN coalesce(wo.status_model,'Not Started')
                            WHEN 'modelare' THEN coalesce(wo.status_modelare,'Not Started')
                            ELSE coalesce(wo.status_cer_fin,'Not Started') END,
           CASE WHEN public.assignment_agreed_amount(a.id) is not null AND coalesce(pay.paid,0)>=public.assignment_agreed_amount(a.id) THEN 'Paid' ELSE 'Not Paid' END,
           a.unit_cost,
           public.assignment_agreed_amount(a.id)
    FROM public.lab_work_order_stage_assignments a
    JOIN public.lab_work_orders wo
      ON wo.lab_organization_id=a.lab_organization_id AND wo.id=a.work_order_id
    LEFT JOIN LATERAL (
        SELECT coalesce(sum(p.amount),0)::numeric AS paid
        FROM public.technician_payments p WHERE p.assignment_id=a.id
    ) pay ON true
    WHERE a.lab_organization_id=p_lab_organization_id
      AND (a.technician_user_id=auth.uid() OR (
          a.technician_user_id is null AND lower(trim(a.technician_name))=lower(v_technician)
      ))
    ORDER BY a.work_order_id DESC,a.started_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_salary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_salary(uuid) TO authenticated;
