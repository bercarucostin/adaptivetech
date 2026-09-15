-- Repairs current assignments from the current catalog. This is intentionally
-- limited to incomplete snapshots without payments or adjustments; valid frozen
-- history is never recalculated.
CREATE OR REPLACE FUNCTION public.backfill_work_order_financial_history(p_lab uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_order public.lab_work_orders%rowtype;
    v_stage record;
    v_assignment_id uuid;
    v_before_id uuid;
    v_before_repair_audits integer;
    v_after_repair_audits integer;
    v_prices integer := 0;
    v_price_lines integer := 0;
    v_assignments integer := 0;
    v_repaired integer := 0;
    v_missing jsonb := '[]'::jsonb;
    v_unresolved jsonb := '[]'::jsonb;
BEGIN
    IF lower(coalesce(public.current_org_role(p_lab),''))<>'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;

    INSERT INTO public.lab_work_order_price_lines (
        lab_organization_id,work_order_id,work_type,billing_mode,billing_scope,
        contract,unit_price,quantity,line_total,price_source,price_fixed_at,
        price_migrated,created_by_user_id,updated_by_user_id,created_at,updated_at
    )
    SELECT i.lab_organization_id,i.work_order_id,i.work_type,'per_tooth',
           'tooth:' || i.tooth_number::text,i.contract,i.unit_price,i.quantity,
           i.line_total,coalesce(i.price_source,'migration_items'),
           coalesce(i.price_fixed_at,i.updated_at,i.created_at,now()),true,
           i.created_by_user_id,i.updated_by_user_id,i.created_at,i.updated_at
    FROM public.lab_work_order_items i
    WHERE i.lab_organization_id=p_lab
      AND (i.price_fixed_at IS NOT NULL OR i.price_source IS NOT NULL
           OR i.unit_price IS NOT NULL OR i.line_total IS NOT NULL)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_price_lines=ROW_COUNT;

    UPDATE public.lab_work_orders wo SET
        snapshot_list_price=totals.list_price,
        snapshot_final_price=round(totals.list_price*(1-wo.discount/100),2),
        price_source='migration_items',price_fixed_at=totals.fixed_at,price_migrated=true
    FROM (SELECT work_order_id,
                 CASE WHEN bool_and(line_total IS NOT NULL) THEN sum(line_total) END list_price,
                 coalesce(max(price_fixed_at),now()) fixed_at
        FROM public.lab_work_order_price_lines
        WHERE lab_organization_id=p_lab GROUP BY work_order_id) totals
    WHERE wo.lab_organization_id=p_lab AND wo.id=totals.work_order_id AND wo.price_fixed_at IS NULL
      AND wo.snapshot_list_price IS NULL AND wo.snapshot_final_price IS NULL;
    GET DIAGNOSTICS v_prices=ROW_COUNT;

    FOR v_order IN
        SELECT * FROM public.lab_work_orders
        WHERE lab_organization_id=p_lab
        ORDER BY id
    LOOP
        FOR v_stage IN SELECT * FROM (VALUES
            ('model'::text,v_order.tehnician_model),
            ('modelare'::text,v_order.tehnician1_modelare),
            ('cer_fin'::text,v_order.tehnician2_cer_fin)
        ) stages(stage_key,technician_name)
        LOOP
            IF nullif(trim(coalesce(v_stage.technician_name,'')),'') IS NULL THEN CONTINUE; END IF;

            v_before_id:=NULL;
            SELECT count(*)::integer INTO v_before_repair_audits
            FROM public.work_order_financial_audit
            WHERE lab_organization_id=p_lab AND work_order_id=v_order.id
              AND entity_type='stage_assignment'
              AND (action='repair_incomplete' OR action='repair_aggregate');
            SELECT a.id INTO v_before_id
            FROM public.lab_work_order_stage_assignments a
            WHERE a.lab_organization_id=p_lab AND a.work_order_id=v_order.id
              AND a.stage_key=v_stage.stage_key AND a.ended_at IS NULL;

            BEGIN
                v_assignment_id:=public.sync_work_order_stage_assignment(
                    p_lab,v_order.id,v_stage.stage_key,v_stage.technician_name
                );
                IF v_before_id IS NULL THEN
                    v_assignments:=v_assignments+1;
                ELSE
                    SELECT count(*)::integer INTO v_after_repair_audits
                    FROM public.work_order_financial_audit
                    WHERE lab_organization_id=p_lab AND work_order_id=v_order.id
                      AND entity_type='stage_assignment'
                      AND (action='repair_incomplete' OR action='repair_aggregate');
                    IF v_after_repair_audits>v_before_repair_audits THEN
                        v_repaired:=v_repaired+1;
                    END IF;
                END IF;
                UPDATE public.lab_work_order_stage_assignments SET migrated=true
                WHERE id=v_assignment_id AND (
                    v_before_id IS NULL OR v_after_repair_audits>v_before_repair_audits
                );
            EXCEPTION WHEN OTHERS THEN
                IF SQLERRM LIKE 'Missing technician cost configuration:%' THEN
                    v_missing:=v_missing||jsonb_build_array(jsonb_build_object(
                        'work_order_id',v_order.id,'stage',v_stage.stage_key,
                        'technician',v_stage.technician_name,'error',SQLERRM
                    ));
                ELSIF SQLERRM LIKE 'Incomplete technician cost snapshot cannot be repaired%' THEN
                    v_unresolved:=v_unresolved||jsonb_build_array(jsonb_build_object(
                        'work_order_id',v_order.id,'stage',v_stage.stage_key,
                        'technician',v_stage.technician_name,'error',SQLERRM
                    ));
                ELSE
                    RAISE;
                END IF;
            END;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'prices',v_prices,'price_lines',v_price_lines,'assignments',v_assignments,
        'repaired_assignments',v_repaired,'missing_costs',v_missing,
        'unresolved_assignments',v_unresolved,
        'migration_balances',0
    );
END; $$;
REVOKE ALL ON FUNCTION public.backfill_work_order_financial_history(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.backfill_work_order_financial_history(uuid) TO authenticated;
