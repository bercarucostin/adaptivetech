CREATE OR REPLACE FUNCTION public.get_work_order_financial_history(
    p_lab uuid,
    p_work_order_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text := public.effective_lab_role(p_lab);
    v_result jsonb;
BEGIN
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'Financial history access denied'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.lab_work_orders wo
        WHERE wo.lab_organization_id=p_lab AND wo.id=p_work_order_id
    ) THEN RAISE EXCEPTION 'Work Order not found'; END IF;
    IF v_role='technician' AND NOT EXISTS (
        SELECT 1 FROM public.lab_work_order_stage_assignments a
        WHERE a.lab_organization_id=p_lab AND a.work_order_id=p_work_order_id
          AND (
              a.technician_user_id=auth.uid()
              OR (
                  a.technician_user_id IS NULL
                  AND lower(trim(a.technician_name))=lower(trim(coalesce(public.current_technician_name(),'')))
              )
          )
    ) THEN RAISE EXCEPTION 'Financial history access denied'; END IF;

    SELECT jsonb_build_object(
        'Work_Order_ID',wo.id,
        'Sale_Price',case when v_role in ('admin','manager') then jsonb_build_object(
            'Unit_Price',wo.snapshot_unit_price,'List_Price',wo.snapshot_list_price,
            'Final_Price',wo.snapshot_final_price,'Discount',wo.discount,
            'Source',wo.price_source,'Fixed_At',wo.price_fixed_at,'Migrated',wo.price_migrated
        ) else null end,
        'Assignments',coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'Assignment_ID',a.id,'Stage',a.stage_key,'Technician',a.technician_name,
                'Unit_Cost',a.unit_cost,'Quantity',a.quantity,'Agreed_Amount',a.agreed_amount,
                'Cost_Source',a.cost_source,'Fixed_At',a.fixed_at,'Started_At',a.started_at,
                'Ended_At',a.ended_at,'Migrated',a.migrated,
                'Cost_Lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.work_type)
                    from public.lab_work_order_assignment_cost_lines l where l.assignment_id=a.id),'[]'::jsonb),
                'Payments',coalesce((select jsonb_agg(jsonb_build_object(
                    'ID',p.id,'Amount',p.amount,'Currency',p.currency,'Paid_On',p.paid_on,
                    'Recorded_At',p.recorded_at,'Reversal_Of',p.reversal_of,
                    'Migration_Balance',p.migration_balance,'Note',p.note
                ) order by p.recorded_at) from public.technician_payments p where p.assignment_id=a.id),'[]'::jsonb)
            ) order by a.started_at
            FROM public.lab_work_order_stage_assignments a
            WHERE a.lab_organization_id=p_lab AND a.work_order_id=p_work_order_id
              AND (v_role in ('admin','manager') OR a.technician_user_id=auth.uid()
                   OR (a.technician_user_id is null AND lower(trim(a.technician_name))=lower(trim(coalesce(public.current_technician_name(),'')))))
        ),'[]'::jsonb)
    ) INTO v_result
    FROM public.lab_work_orders wo
    WHERE wo.lab_organization_id=p_lab AND wo.id=p_work_order_id;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_work_order_financial_history(uuid,bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.get_work_order_financial_history(uuid,bigint) TO authenticated;
