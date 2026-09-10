CREATE OR REPLACE FUNCTION public.ai_technician_receivables()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lab uuid := public.get_flowrise_lab_id();
    v_technician text := lower(trim(coalesce(public.current_technician_name(),'')));
    v_result jsonb;
BEGIN
    IF public.effective_lab_role(v_lab) <> 'technician' THEN RAISE EXCEPTION 'Technician access required'; END IF;
    IF v_technician='' THEN RAISE EXCEPTION 'Technician profile mapping is missing'; END IF;

    WITH assigned AS (
        SELECT a.id AS assignment_id,a.work_order_id,wo.nume_pacient,wo.nume_partener,
               scope.items,scope.work_types,scope.work_type_summary,scope.element_count,a.stage_key,
               CASE a.stage_key WHEN 'model' THEN 'Model' WHEN 'modelare' THEN 'Modelare' ELSE 'Cer / Fin' END AS stage_label,
               CASE a.stage_key WHEN 'model' THEN coalesce(wo.status_model,'Not Started')
                                WHEN 'modelare' THEN coalesce(wo.status_modelare,'Not Started')
                                ELSE coalesce(wo.status_cer_fin,'Not Started') END AS stage_status,
               a.unit_cost,public.assignment_agreed_amount(a.id) as agreed_amount,
               coalesce(pay.paid_amount,0)::numeric AS paid_amount,
               CASE WHEN public.assignment_agreed_amount(a.id) is null then null
                    ELSE public.assignment_agreed_amount(a.id)-coalesce(pay.paid_amount,0) END AS outstanding_amount,
               a.cost_source,a.started_at,a.ended_at,a.migrated
        FROM public.lab_work_order_stage_assignments a
        JOIN public.lab_work_orders wo
          ON wo.lab_organization_id=a.lab_organization_id AND wo.id=a.work_order_id
        CROSS JOIN LATERAL public.work_order_item_scope(wo.lab_organization_id,wo.id,false) scope
        LEFT JOIN LATERAL (
            SELECT coalesce(sum(p.amount),0)::numeric AS paid_amount
            FROM public.technician_payments p WHERE p.assignment_id=a.id
        ) pay ON true
        WHERE a.lab_organization_id=v_lab
          AND (a.technician_user_id=auth.uid() OR (
              a.technician_user_id is null AND lower(trim(a.technician_name))=v_technician
          ))
    ), totals AS (
        SELECT count(*)::bigint AS stage_count,
               count(*) FILTER (WHERE agreed_amount is null)::bigint AS missing_cost_count,
               coalesce(sum(agreed_amount),0)::numeric AS accrued,
               coalesce(sum(paid_amount),0)::numeric AS paid
        FROM assigned
    ), breakdown AS (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'Assignment_ID',assignment_id,'Work_Order_ID',work_order_id,
            'Nume_Pacient',nume_pacient,'Nume_Partener',nume_partener,
            'items',items,'work_types',work_types,'work_type_summary',work_type_summary,'element_count',element_count,'Stage',stage_key,'Stage_Label',stage_label,
            'Stage_Status',stage_status,
            'Payment_Status',case when agreed_amount is not null and paid_amount>=agreed_amount then 'Paid' else 'Not Paid' end,
            'Unit_Cost',unit_cost,'Amount',agreed_amount,'Agreed_Amount',agreed_amount,
            'Paid_Amount',paid_amount,'Outstanding_Amount',outstanding_amount,
            'Cost_Source',cost_source,'Started_At',started_at,'Ended_At',ended_at,'Migrated',migrated
        ) order by work_order_id desc,started_at desc),'[]'::jsonb) AS rows
        FROM assigned
    ), by_partner AS (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'Nume_Partener',partner_name,'Stage_Count',stage_count,
            'Missing_Cost_Count',missing_count,'Total_Accrued',accrued,
            'Total_Paid',paid,'Total_Outstanding',accrued-paid
        ) order by accrued desc,partner_name),'[]'::jsonb) AS rows
        FROM (
            SELECT coalesce(nullif(trim(nume_partener),''),'Partener nespecificat') AS partner_name,
                   count(*)::bigint AS stage_count,
                   count(*) FILTER (WHERE agreed_amount is null)::bigint AS missing_count,
                   coalesce(sum(agreed_amount),0)::numeric AS accrued,
                   coalesce(sum(paid_amount),0)::numeric AS paid
            FROM assigned GROUP BY 1
        ) grouped
    )
    SELECT jsonb_build_object(
        'Technician',public.current_technician_name(),'Currency','RON',
        'Stage_Count',t.stage_count,'Missing_Cost_Count',t.missing_cost_count,
        'Total_Accrued',t.accrued,'Total_Paid',t.paid,
        'Total_Outstanding',t.accrued-t.paid,
        'By_Partner',p.rows,'Breakdown',b.rows
    ) INTO v_result FROM totals t CROSS JOIN breakdown b CROSS JOIN by_partner p;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_technician_receivables() FROM public;
GRANT EXECUTE ON FUNCTION public.ai_technician_receivables() TO authenticated;
