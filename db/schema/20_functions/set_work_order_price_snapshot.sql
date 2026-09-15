CREATE OR REPLACE FUNCTION public.set_work_order_price_snapshot(
    p_lab uuid,
    p_work_order_id bigint,
    p_unit_price numeric,
    p_discount numeric,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
    v_order public.lab_work_orders%rowtype;
    v_before jsonb;
    v_after jsonb;
    v_before_price_lines jsonb;
    v_after_price_lines jsonb;
    v_list numeric;
    v_final numeric;
BEGIN
    IF lower(coalesce(public.current_org_role(p_lab),'')) <> 'admin' THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;
    IF p_unit_price IS NULL OR p_unit_price<0 THEN
        RAISE EXCEPTION 'Unit price must be zero or greater';
    END IF;
    IF p_discount IS NULL OR p_discount<0 OR p_discount>100 THEN
        RAISE EXCEPTION 'Discount must be between 0 and 100';
    END IF;
    IF trim(coalesce(p_reason,''))='' THEN
        RAISE EXCEPTION 'Price change reason is required';
    END IF;

    SELECT * INTO v_order FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab AND id=p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'work_type',line.work_type,'billing_mode',line.billing_mode,
        'billing_scope',line.billing_scope,'quantity',line.quantity,
        'unit_price',line.unit_price,'subtotal',line.line_total,
        'source',line.price_source
    ) ORDER BY line.work_type,line.billing_scope),'[]'::jsonb)
    INTO v_before_price_lines
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_work_order_id;

    SELECT round(p_unit_price*sum(line.quantity),2) INTO v_list
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_work_order_id;
    IF v_list IS NULL THEN RAISE EXCEPTION 'Work Order requires price lines'; END IF;
    v_final:=round(v_list*(1-p_discount/100),2);

    UPDATE public.lab_work_order_price_lines
    SET unit_price=round(p_unit_price,2),
        line_total=round(p_unit_price*quantity,2),
        price_source='admin_override',price_fixed_at=now(),price_migrated=false,
        updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    WHERE lab_organization_id=p_lab AND work_order_id=p_work_order_id;

    UPDATE public.lab_work_orders
    SET snapshot_list_price=v_list,snapshot_final_price=v_final,
        discount=p_discount,price_source='admin_override',price_fixed_at=now(),
        price_migrated=false,updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    WHERE lab_organization_id=p_lab AND id=p_work_order_id;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'work_type',line.work_type,'billing_mode',line.billing_mode,
        'billing_scope',line.billing_scope,'quantity',line.quantity,
        'unit_price',line.unit_price,'subtotal',line.line_total,
        'source',line.price_source
    ) ORDER BY line.work_type,line.billing_scope),'[]'::jsonb)
    INTO v_after_price_lines
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_work_order_id;

    v_before:=jsonb_build_object(
        'list_price',v_order.snapshot_list_price,'final_price',v_order.snapshot_final_price,
        'discount',v_order.discount,'source',v_order.price_source,
        'price_lines',v_before_price_lines
    );
    v_after:=jsonb_build_object(
        'unit_price',round(p_unit_price,2),'list_price',v_list,'final_price',v_final,
        'discount',p_discount,'source','admin_override','reason',trim(p_reason),
        'price_lines',v_after_price_lines
    );
    INSERT INTO public.work_order_financial_audit(
        lab_organization_id,work_order_id,entity_type,entity_id,action,
        before_value,after_value,changed_by_user_id
    ) VALUES (
        p_lab,p_work_order_id,'work_order_price',p_work_order_id::text,
        'override',v_before,v_after,auth.uid()
    );
    RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.set_work_order_price_snapshot(uuid,bigint,numeric,numeric,text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_work_order_price_snapshot(uuid,bigint,numeric,numeric,text) TO authenticated;
