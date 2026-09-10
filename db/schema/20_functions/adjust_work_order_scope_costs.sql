CREATE OR REPLACE FUNCTION public.adjust_work_order_scope_costs(p_lab uuid,p_order bigint,p_before jsonb,p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.lab_work_order_stage_assignments%rowtype; d record; v_cost numeric; v_source text; v_existing boolean;
BEGIN
    IF p_before IS NOT DISTINCT FROM p_after THEN RETURN; END IF;
    FOR a IN SELECT * FROM public.lab_work_order_stage_assignments
        WHERE lab_organization_id=p_lab AND work_order_id=p_order AND ended_at IS NULL FOR UPDATE
    LOOP
        FOR d IN
            WITH before_scope AS (SELECT x->>'work_type' work_type,(x->>'quantity')::numeric quantity FROM jsonb_array_elements(p_before) x),
            after_scope AS (SELECT x->>'work_type' work_type,(x->>'quantity')::numeric quantity FROM jsonb_array_elements(p_after) x)
            SELECT coalesce(n.work_type,o.work_type) work_type,coalesce(n.quantity,0)-coalesce(o.quantity,0) delta
            FROM before_scope o FULL JOIN after_scope n USING(work_type)
            WHERE coalesce(n.quantity,0)<>coalesce(o.quantity,0)
        LOOP
            -- Existing work types retain their original frozen cost, including missing costs.
            SELECT l.unit_cost,l.cost_source INTO v_cost,v_source FROM public.lab_work_order_assignment_cost_lines l
            WHERE l.assignment_id=a.id AND lower(trim(l.work_type))=lower(trim(d.work_type));
            v_existing:=FOUND;
            IF NOT v_existing THEN
                SELECT l.unit_cost,l.cost_source INTO v_cost,v_source FROM public.lab_work_order_assignment_adjustments l
                WHERE l.assignment_id=a.id AND lower(trim(l.work_type))=lower(trim(d.work_type)) ORDER BY l.created_at,l.id LIMIT 1;
                v_existing:=FOUND;
            END IF;
            IF NOT v_existing THEN
                v_cost:=public.resolve_technician_unit_cost(
                    p_lab,a.technician_name,d.work_type,a.stage_key
                );
                v_source:=CASE WHEN v_cost IS NULL THEN 'missing' ELSE 'catalog' END;
            END IF;
            IF v_cost IS NULL THEN
                RAISE EXCEPTION 'Missing technician cost configuration: % / % / %',
                    a.technician_name,d.work_type,a.stage_key;
            END IF;
            INSERT INTO public.lab_work_order_assignment_adjustments(assignment_id,work_type,quantity_delta,unit_cost,amount,cost_source,created_by_user_id)
            VALUES(a.id,d.work_type,d.delta,v_cost,round(v_cost*d.delta,2),coalesce(v_source,'missing'),auth.uid());
        END LOOP;
        INSERT INTO public.work_order_financial_audit(lab_organization_id,work_order_id,entity_type,entity_id,action,before_value,after_value,changed_by_user_id)
        VALUES(p_lab,p_order,'stage_assignment',a.id::text,'scope_adjustment',p_before,
            jsonb_build_object('scope',p_after,'agreed_amount',public.assignment_agreed_amount(a.id)),auth.uid());
    END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.adjust_work_order_scope_costs(uuid,bigint,jsonb,jsonb) FROM public,authenticated;
