CREATE OR REPLACE FUNCTION public.backfill_work_order_financial_history(p_lab uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.lab_work_orders%rowtype;
    v_price jsonb;
    v_assignment_id uuid;
    v_prices integer := 0;
    v_assignments integer := 0;
    v_balances integer := 0;
    v_missing integer := 0;
    v_list numeric;
    v_count integer;
    v_all_priced boolean;
    v_stage record;
BEGIN
    IF lower(coalesce(public.current_org_role(p_lab),'')) <> 'admin' THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    FOR v_order IN
        SELECT * FROM public.lab_work_orders
        WHERE lab_organization_id=p_lab
        ORDER BY id FOR UPDATE
    LOOP
        IF v_order.snapshot_unit_price IS NULL AND v_order.price_fixed_at IS NULL THEN
            SELECT count(*)::integer,
                   coalesce(bool_and(unit_price is not null),false),
                   case when bool_and(line_total is not null) then sum(line_total) else null end
              INTO v_count,v_all_priced,v_list
            FROM public.lab_work_order_items
            WHERE lab_organization_id=p_lab AND work_order_id=v_order.id;

            IF v_count > 0 THEN
                UPDATE public.lab_work_order_items
                SET price_source=coalesce(price_source,'migration_saved_item'),
                    price_fixed_at=coalesce(price_fixed_at,now()),price_migrated=true
                WHERE lab_organization_id=p_lab AND work_order_id=v_order.id;
                UPDATE public.lab_work_orders
                SET snapshot_unit_price=case when v_all_priced then round(v_list/v_count,2) else null end,
                    snapshot_list_price=case when v_all_priced then round(v_list,2) else null end,
                    snapshot_final_price=case when v_all_priced then round(v_list*(1-discount/100),2) else null end,
                    price_source=case when v_all_priced then 'migration_items' else 'migration_missing' end,
                    price_fixed_at=now(),price_migrated=true
                WHERE lab_organization_id=p_lab AND id=v_order.id;
                IF NOT v_all_priced THEN v_missing := v_missing + 1; END IF;
            ELSE
                v_price := public.resolve_work_order_price_snapshot(
                    p_lab,v_order.nume_partener,v_order.contract,v_order.tip_lucrare,
                    v_order.nr_elemente,v_order.discount
                );
                UPDATE public.lab_work_orders
                SET snapshot_unit_price=(v_price->>'unit_price')::numeric,
                    snapshot_list_price=(v_price->>'list_price')::numeric,
                    snapshot_final_price=(v_price->>'final_price')::numeric,
                    price_source=case when v_price->>'unit_price' is null then 'migration_missing' else 'migration_catalog' end,
                    price_fixed_at=now(),price_migrated=true
                WHERE lab_organization_id=p_lab AND id=v_order.id;
                IF v_price->>'unit_price' IS NULL THEN v_missing := v_missing + 1; END IF;
            END IF;
            v_prices := v_prices + 1;
        END IF;

        FOR v_stage IN SELECT * FROM (VALUES
            ('model'::text,v_order.tehnician_model,v_order.paid_model),
            ('modelare'::text,v_order.tehnician1_modelare,v_order.paid_modelare),
            ('cer_fin'::text,v_order.tehnician2_cer_fin,v_order.paid_cer_fin)
        ) x(stage_key,technician_name,paid_status)
        LOOP
            IF nullif(trim(coalesce(v_stage.technician_name,'')),'') IS NOT NULL THEN
                SELECT id INTO v_assignment_id
                FROM public.lab_work_order_stage_assignments
                WHERE lab_organization_id=p_lab AND work_order_id=v_order.id
                  AND stage_key=v_stage.stage_key AND ended_at IS NULL;
                IF v_assignment_id IS NULL THEN
                    v_assignment_id := public.sync_work_order_stage_assignment(
                        p_lab,v_order.id,v_stage.stage_key,v_stage.technician_name
                    );
                    UPDATE public.lab_work_order_stage_assignments
                    SET migrated=true,cost_source=case when agreed_amount is null then 'migration_missing' else 'migration_catalog' end
                    WHERE id=v_assignment_id;
                    UPDATE public.lab_work_order_assignment_cost_lines
                    SET cost_source=case when amount is null then 'migration_missing' else 'migration_catalog' end
                    WHERE assignment_id=v_assignment_id;
                    v_assignments := v_assignments + 1;
                END IF;

                IF lower(trim(coalesce(v_stage.paid_status,'')))='paid' THEN
                    INSERT INTO public.technician_payments (
                        lab_organization_id,assignment_id,amount,paid_on,recorded_by_user_id,
                        request_key,migration_balance,note
                    )
                    SELECT p_lab,v_assignment_id,a.agreed_amount,null,auth.uid(),
                           'migration-paid:'||v_assignment_id::text,true,
                           'Imported from legacy Paid flag; payment date is unknown'
                    FROM public.lab_work_order_stage_assignments a
                    WHERE a.id=v_assignment_id AND a.agreed_amount is not null
                    ON CONFLICT (lab_organization_id,request_key) WHERE request_key IS NOT NULL DO NOTHING;
                    IF FOUND THEN v_balances := v_balances + 1; END IF;
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'prices',v_prices,'assignments',v_assignments,
        'migration_balances',v_balances,'missing_prices',v_missing
    );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_work_order_financial_history(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.backfill_work_order_financial_history(uuid) TO authenticated;
