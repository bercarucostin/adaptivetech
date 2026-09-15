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
            'List_Price',wo.snapshot_list_price,
            'Final_Price',wo.snapshot_final_price,'Discount',wo.discount,
            'Source',wo.price_source,'Fixed_At',wo.price_fixed_at,'Migrated',wo.price_migrated,
            'Price_Lines',coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'Work_Type',line.work_type,'Billing_Mode',line.billing_mode,
                    'Billing_Scope',line.billing_scope,'Contract',line.contract,
                    'Unit_Price',line.unit_price,'Quantity',line.quantity,
                    'Line_Total',line.line_total,'Source',line.price_source,
                    'Fixed_At',line.price_fixed_at,'Migrated',line.price_migrated
                ) ORDER BY line.work_type,line.billing_scope)
                FROM public.lab_work_order_price_lines line
                WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_work_order_id
            ),'[]'::jsonb)
        ) else null end,
        'Assignments',coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'Assignment_ID',a.id,'Stage',a.stage_key,'Technician',a.technician_name,
                'Unit_Cost',a.unit_cost,'Quantity',a.quantity,'Agreed_Amount',public.assignment_agreed_amount(a.id),
                'Cost_Source',a.cost_source,'Fixed_At',a.fixed_at,'Started_At',a.started_at,
                'Ended_At',a.ended_at,'Migrated',a.migrated,
                'Original_Agreed_Amount',a.agreed_amount,
                'Adjustments',coalesce((select jsonb_agg(jsonb_build_object(
                    'id',d.id,'assignment_id',d.assignment_id,'work_type',d.work_type,
                    'billing_mode',d.billing_mode,'quantity_delta',d.quantity_delta,
                    'unit_cost',d.unit_cost,'amount',d.amount,'cost_source',d.cost_source,
                    'created_at',d.created_at,'created_by_user_id',d.created_by_user_id
                ) order by d.created_at,d.id) from public.lab_work_order_assignment_adjustments d where d.assignment_id=a.id),'[]'::jsonb),
                'Cost_Lines',coalesce((select jsonb_agg(jsonb_build_object(
                    'assignment_id',l.assignment_id,'work_type',l.work_type,
                    'billing_mode',l.billing_mode,'quantity',l.quantity,
                    'unit_cost',l.unit_cost,'amount',l.amount,'cost_source',l.cost_source
                ) order by l.work_type,l.billing_mode)
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
