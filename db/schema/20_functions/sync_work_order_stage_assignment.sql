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
        RETURN v_current.id;
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

    IF v_current.id IS NOT NULL THEN
        UPDATE public.lab_work_order_stage_assignments SET ended_at = now()
        WHERE id = v_current.id;
    END IF;

    INSERT INTO public.lab_work_order_stage_assignments (
        lab_organization_id, work_order_id, stage_key, technician_user_id,
        technician_name, quantity, cost_source, created_by_user_id
    ) VALUES (
        p_lab, p_work_order_id, v_stage, v_user_id, v_name,
        (SELECT sum(quantity) FROM public.lab_work_order_items WHERE lab_organization_id=p_lab AND work_order_id=p_work_order_id), 'catalog', auth.uid()
    ) RETURNING id INTO v_assignment_id;

    INSERT INTO public.lab_work_order_assignment_cost_lines (
        assignment_id, work_type, quantity, unit_cost, amount, cost_source
    )
    WITH work_lines AS (
        SELECT i.work_type, sum(i.quantity)::numeric AS quantity
        FROM public.lab_work_order_items i
        WHERE i.lab_organization_id = p_lab AND i.work_order_id = p_work_order_id
        GROUP BY i.work_type
    )
    SELECT v_assignment_id, wl.work_type, wl.quantity, cost.cost,
           CASE WHEN cost.cost IS NULL THEN NULL ELSE round(cost.cost * wl.quantity, 2) END,
           CASE WHEN cost.cost IS NULL THEN 'missing' ELSE 'catalog' END
    FROM work_lines wl
    LEFT JOIN LATERAL (
        SELECT tc.cost
        FROM public.lab_technician_costs tc
        WHERE tc.lab_organization_id = p_lab
          AND lower(trim(tc.tehnician)) = lower(v_name)
          AND lower(trim(tc.tip_lucrare)) = lower(trim(wl.work_type))
          AND CASE v_stage
              WHEN 'model' THEN lower(trim(tc.etapa)) = 'model'
              WHEN 'modelare' THEN lower(trim(tc.etapa)) = 'modelare'
              ELSE regexp_replace(lower(coalesce(tc.etapa,'')), '[^a-z0-9]', '', 'g')
                   IN ('cerfin','ceramicafinisare','ceramicfinisare')
          END
        ORDER BY tc.source_row_no LIMIT 1
    ) cost ON true;

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
        CASE WHEN v_current.id IS NULL THEN 'assign' ELSE 'reassign' END,
        CASE WHEN v_current.id IS NULL THEN '{}'::jsonb ELSE to_jsonb(v_current) END,
        (SELECT to_jsonb(a) FROM public.lab_work_order_stage_assignments a WHERE a.id=v_assignment_id),
        auth.uid()
    );

    RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_work_order_stage_assignment(uuid,bigint,text,text) FROM public;
REVOKE ALL ON FUNCTION public.sync_work_order_stage_assignment(uuid,bigint,text,text) FROM authenticated;
