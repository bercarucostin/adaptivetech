CREATE OR REPLACE FUNCTION public.sync_work_order_stage_assignment(
    p_lab uuid,
    p_work_order_id bigint,
    p_stage text,
    p_technician_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stage text := lower(trim(coalesce(p_stage, '')));
    v_name text := nullif(trim(coalesce(p_technician_name, '')), '');
    v_order public.lab_work_orders%rowtype;
    v_current public.lab_work_order_stage_assignments%rowtype;
    v_assignment_id uuid;
    v_user_ids uuid[];
    v_user_id uuid;
    v_missing text;
    v_line_count integer;
    v_repair_incomplete boolean := false;
    v_lines_complete boolean := false;
    v_adjustments_complete boolean := true;
    v_saved_amount numeric;
    v_saved_unit_cost numeric;
    v_saved_quantity numeric;
    v_base_line_count integer := 0;
    v_has_financial_activity boolean := false;
BEGIN
    IF public.effective_lab_role(p_lab) NOT IN ('admin', 'manager', 'technician') THEN
        RAISE EXCEPTION 'Stage assignment update denied';
    END IF;
    IF v_stage NOT IN ('model', 'modelare', 'cer_fin') THEN
        RAISE EXCEPTION 'Invalid stage';
    END IF;

    SELECT * INTO v_order
    FROM public.lab_work_orders
    WHERE lab_organization_id = p_lab AND id = p_work_order_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;

    SELECT * INTO v_current
    FROM public.lab_work_order_stage_assignments
    WHERE lab_organization_id = p_lab
      AND work_order_id = p_work_order_id
      AND stage_key = v_stage
      AND ended_at IS NULL
    FOR UPDATE;

    IF FOUND AND lower(trim(v_current.technician_name)) = lower(coalesce(v_name, '')) THEN
        WITH effective_saved AS (
            SELECT min(saved_scope.work_type) AS work_type,
                   saved_scope.work_type_key,
                   saved_scope.billing_mode,
                   sum(saved_scope.quantity)::numeric AS quantity
            FROM (
                SELECT saved.work_type,
                       regexp_replace(lower(trim(saved.work_type)), '[[:space:]]+', ' ', 'g') AS work_type_key,
                       saved.billing_mode,
                       saved.quantity
                FROM public.lab_work_order_assignment_cost_lines saved
                WHERE saved.assignment_id=v_current.id
                UNION ALL
                SELECT delta.work_type,
                       regexp_replace(lower(trim(delta.work_type)), '[[:space:]]+', ' ', 'g') AS work_type_key,
                       delta.billing_mode,
                       delta.quantity_delta AS quantity
                FROM public.lab_work_order_assignment_adjustments delta
                WHERE delta.assignment_id=v_current.id
            ) saved_scope
            GROUP BY work_type_key,billing_mode
            HAVING sum(saved_scope.quantity)<>0
        )
        SELECT EXISTS (SELECT 1 FROM public.lab_work_order_assignment_cost_lines base
                       WHERE base.assignment_id=v_current.id)
               AND EXISTS (
                   SELECT 1 FROM public.resolve_work_order_technician_costs(
                       p_lab,p_work_order_id,v_stage,v_name
                   ) expected
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM public.resolve_work_order_technician_costs(
                       p_lab,p_work_order_id,v_stage,v_name
                   ) expected
                   LEFT JOIN effective_saved saved
                     ON saved.work_type_key=regexp_replace(lower(trim(expected.work_type)), '[[:space:]]+', ' ', 'g')
                    AND saved.billing_mode=expected.billing_mode
                   WHERE saved.work_type_key IS NULL
                      OR saved.quantity IS DISTINCT FROM expected.quantity
               )
               AND NOT EXISTS (
                   SELECT 1
                   FROM effective_saved saved
                   LEFT JOIN public.resolve_work_order_technician_costs(
                       p_lab,p_work_order_id,v_stage,v_name
                   ) expected
                     ON saved.work_type_key=regexp_replace(lower(trim(expected.work_type)), '[[:space:]]+', ' ', 'g')
                    AND saved.billing_mode=expected.billing_mode
                   WHERE expected.work_type IS NULL
               )
               AND NOT EXISTS (
                   SELECT 1 FROM public.lab_work_order_assignment_cost_lines saved
                   WHERE saved.assignment_id=v_current.id AND saved.amount IS NULL
               ),
               (SELECT sum(saved.amount) FROM public.lab_work_order_assignment_cost_lines saved
                WHERE saved.assignment_id=v_current.id),
               (SELECT CASE WHEN count(*)=1 THEN max(saved.unit_cost) END
                FROM public.lab_work_order_assignment_cost_lines saved
                WHERE saved.assignment_id=v_current.id),
               (SELECT sum(saved.quantity) FROM public.lab_work_order_assignment_cost_lines saved
                WHERE saved.assignment_id=v_current.id),
               NOT EXISTS (
                   SELECT 1 FROM public.lab_work_order_assignment_adjustments d
                   WHERE d.assignment_id=v_current.id AND d.amount IS NULL
               )
          INTO v_lines_complete,v_saved_amount,v_saved_unit_cost,v_saved_quantity,v_adjustments_complete;

        IF v_lines_complete AND v_current.agreed_amount IS DISTINCT FROM v_saved_amount THEN
            UPDATE public.lab_work_order_stage_assignments
            SET agreed_amount=v_saved_amount,unit_cost=v_saved_unit_cost,quantity=v_saved_quantity,
                cost_source=CASE WHEN cost_source='missing' THEN 'catalog' ELSE cost_source END
            WHERE id=v_current.id;
            INSERT INTO public.work_order_financial_audit (
                lab_organization_id,work_order_id,entity_type,entity_id,action,
                before_value,after_value,changed_by_user_id
            ) VALUES (
                p_lab,p_work_order_id,'stage_assignment',v_current.id::text,'repair_aggregate',
                to_jsonb(v_current),
                (SELECT to_jsonb(a) FROM public.lab_work_order_stage_assignments a WHERE a.id=v_current.id),
                auth.uid()
            );
            IF v_adjustments_complete THEN RETURN v_current.id; END IF;
        END IF;

        IF v_lines_complete AND v_adjustments_complete
           AND public.assignment_agreed_amount(v_current.id) IS NOT NULL THEN
            RETURN v_current.id;
        END IF;

        SELECT (SELECT count(*)::integer
                FROM public.lab_work_order_assignment_cost_lines base
                WHERE base.assignment_id=v_current.id),
               EXISTS (SELECT 1 FROM public.technician_payments p WHERE p.assignment_id=v_current.id)
               OR EXISTS (SELECT 1 FROM public.lab_work_order_assignment_adjustments d WHERE d.assignment_id=v_current.id)
          INTO v_base_line_count,v_has_financial_activity;
        IF v_base_line_count>0 OR v_has_financial_activity THEN
            RAISE EXCEPTION 'Incomplete technician cost snapshot cannot be repaired for assignment %',v_current.id;
        END IF;

        -- Only an assignment with no saved base cost can be populated from the
        -- current catalog. Any partial snapshot is frozen history and fails above.
        v_repair_incomplete := true;
        v_assignment_id := v_current.id;
    END IF;

    IF v_name IS NULL THEN
        IF v_current.id IS NOT NULL THEN
            UPDATE public.lab_work_order_stage_assignments SET ended_at = now()
            WHERE id = v_current.id;
            INSERT INTO public.work_order_financial_audit (
                lab_organization_id,work_order_id,entity_type,entity_id,action,
                before_value,after_value,changed_by_user_id
            ) VALUES (
                p_lab,p_work_order_id,'stage_assignment',v_current.id::text,'unassign',
                to_jsonb(v_current),
                (SELECT to_jsonb(a) FROM public.lab_work_order_stage_assignments a WHERE a.id=v_current.id),
                auth.uid()
            );
        END IF;
        RETURN NULL;
    END IF;

    SELECT array_agg(p.id ORDER BY p.id)
      INTO v_user_ids
    FROM public.profiles p
    JOIN public.organization_memberships m
      ON m.user_id = p.id AND m.organization_id = p_lab
    WHERE p.active = true AND m.status = 'active'
      AND lower(m.role) = 'technician'
      AND lower(trim(coalesce(p.technician_name, p.display_name, ''))) = lower(v_name);

    IF coalesce(array_length(v_user_ids, 1), 0) > 1 THEN
        RAISE EXCEPTION 'Technician name is ambiguous';
    END IF;
    v_user_id := v_user_ids[1];

    IF v_current.id IS NOT NULL AND NOT v_repair_incomplete THEN
        UPDATE public.lab_work_order_stage_assignments SET ended_at = now()
        WHERE id = v_current.id;
    END IF;

    IF v_repair_incomplete THEN
        UPDATE public.lab_work_order_stage_assignments
        SET technician_user_id=coalesce(technician_user_id,v_user_id)
        WHERE id=v_assignment_id;
    ELSE
        INSERT INTO public.lab_work_order_stage_assignments (
            lab_organization_id, work_order_id, stage_key, technician_user_id,
            technician_name, quantity, cost_source, created_by_user_id
        ) VALUES (
            p_lab, p_work_order_id, v_stage, v_user_id, v_name,
            (SELECT sum(quantity) FROM public.resolve_work_order_technician_costs(
                p_lab,p_work_order_id,v_stage,v_name
            )), 'catalog', auth.uid()
        ) RETURNING id INTO v_assignment_id;
    END IF;

    INSERT INTO public.lab_work_order_assignment_cost_lines (
        assignment_id, work_type, billing_mode, quantity, unit_cost, amount, cost_source
    )
    SELECT v_assignment_id,costs.work_type,costs.billing_mode,costs.quantity,
           costs.unit_cost,costs.amount,costs.cost_source
    FROM public.resolve_work_order_technician_costs(
        p_lab,p_work_order_id,v_stage,v_name
    ) costs;

    SELECT count(*)::integer,
           string_agg(work_type,', ' ORDER BY work_type) FILTER (WHERE amount IS NULL)
      INTO v_line_count,v_missing
    FROM public.lab_work_order_assignment_cost_lines
    WHERE assignment_id=v_assignment_id;
    IF v_line_count=0 THEN
        RAISE EXCEPTION 'Cannot calculate technician cost without configured teeth';
    END IF;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'Missing technician cost configuration: % / % / %',v_name,v_missing,v_stage;
    END IF;

    UPDATE public.lab_work_order_stage_assignments a
    SET unit_cost = totals.unit_cost,
        quantity = totals.quantity,
        agreed_amount = totals.agreed_amount,
        cost_source = CASE WHEN totals.missing_count > 0 THEN 'missing' ELSE 'catalog' END
    FROM (
        SELECT CASE WHEN count(*) = 1 THEN max(unit_cost) ELSE NULL END AS unit_cost,
               sum(quantity) AS quantity,
               CASE WHEN count(*) FILTER (WHERE amount IS NULL) > 0 THEN NULL ELSE sum(amount) END AS agreed_amount,
               count(*) FILTER (WHERE amount IS NULL) AS missing_count
        FROM public.lab_work_order_assignment_cost_lines
        WHERE assignment_id = v_assignment_id
    ) totals
    WHERE a.id = v_assignment_id;

    INSERT INTO public.work_order_financial_audit (
        lab_organization_id, work_order_id, entity_type, entity_id, action,
        before_value, after_value, changed_by_user_id
    ) VALUES (
        p_lab, p_work_order_id, 'stage_assignment', v_assignment_id::text,
        CASE WHEN v_repair_incomplete THEN 'repair_incomplete'
             WHEN v_current.id IS NULL THEN 'assign' ELSE 'reassign' END,
        CASE WHEN v_current.id IS NULL THEN '{}'::jsonb ELSE to_jsonb(v_current) END,
        (SELECT to_jsonb(a) FROM public.lab_work_order_stage_assignments a WHERE a.id=v_assignment_id),
        auth.uid()
    );

    RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_work_order_stage_assignment(uuid,bigint,text,text) FROM public;
REVOKE ALL ON FUNCTION public.sync_work_order_stage_assignment(uuid,bigint,text,text) FROM authenticated;
