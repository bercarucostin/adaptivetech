CREATE OR REPLACE FUNCTION public.get_work_order_price_lines(p_lab uuid,p_order bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
    v_role text := public.effective_lab_role(p_lab);
    v_result jsonb;
BEGIN
    IF v_role NOT IN ('admin','manager','doctor') THEN
        RAISE EXCEPTION 'Price line access denied';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.lab_work_orders wo
        WHERE wo.lab_organization_id=p_lab AND wo.id=p_order
    ) THEN RAISE EXCEPTION 'Work Order not found'; END IF;
    IF v_role='doctor' AND NOT public.can_access_work_order(p_lab,p_order) THEN
        RAISE EXCEPTION 'Price line access denied';
    END IF;

    SELECT jsonb_build_object(
        'lines',coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'work_type',line.work_type,'billing_mode',line.billing_mode,
                'billing_scope',line.billing_scope,'quantity',line.quantity,
                'contract',line.contract,'unit_price',line.unit_price,
                'subtotal',line.line_total,'matched',line.unit_price IS NOT NULL,
                'price_source',line.price_source,'price_fixed_at',line.price_fixed_at,
                'price_migrated',line.price_migrated
            ) ORDER BY line.work_type,line.billing_scope)
            FROM public.lab_work_order_price_lines line
            WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_order
        ),'[]'::jsonb),
        'element_count',coalesce((
            SELECT count(*) FROM public.lab_work_order_items item
            WHERE item.lab_organization_id=p_lab AND item.work_order_id=p_order
        ),0),
        'billing_unit_count',coalesce((
            SELECT sum(line.quantity) FROM public.lab_work_order_price_lines line
            WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_order
        ),0),
        'list_price',wo.snapshot_list_price,'discount',wo.discount,
        'final_price',wo.snapshot_final_price,'partner_name',wo.nume_partener
    ) INTO v_result
    FROM public.lab_work_orders wo
    WHERE wo.lab_organization_id=p_lab AND wo.id=p_order;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_work_order_price_lines(uuid,bigint) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_work_order_price_lines(uuid,bigint) TO authenticated;
