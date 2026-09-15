-- Saves clinical tooth scope while retaining frozen price units for unchanged
-- work types and billing scopes.
CREATE OR REPLACE FUNCTION public.replace_work_order_items(
    p_lab_organization_id uuid,
    p_work_order_id bigint,
    p_items jsonb,
    p_requested_contract text DEFAULT 'General'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
    v_role text := public.effective_lab_role(p_lab_organization_id);
    v_order public.lab_work_orders%rowtype;
    v_canonical_items jsonb;
    v_modes jsonb;
    v_first_contract text;
    v_element_count numeric;
    v_scope_before jsonb;
    v_scope_after jsonb;
    v_list numeric;
    v_final numeric;
    v_after_price_lines jsonb;
    v_before_price_lines jsonb;
    v_matched_all boolean;
    v_order_price_source text;
    v_order_price_fixed_at timestamptz;
BEGIN
    IF v_role NOT IN ('admin','manager','doctor','technician') THEN
        RAISE EXCEPTION 'Work Order item update denied';
    END IF;
    IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'Items must be a JSON array';
    END IF;

    SELECT * INTO v_order
    FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;
    IF v_role='technician' THEN
        p_requested_contract:=coalesce(nullif(trim(v_order.contract),''),'General');
    END IF;

    IF v_role='doctor' THEN
        IF NOT public.doctor_matches_partner(v_order.nume_partener) THEN RAISE EXCEPTION 'Work Order access denied'; END IF;
        IF v_order.locked THEN RAISE EXCEPTION 'Work Order is locked'; END IF;
        IF lower(trim(coalesce(v_order.status,''))) <> 'not started' THEN
            RAISE EXCEPTION 'Doctor can edit only Not Started Work Orders';
        END IF;
    ELSIF v_role='technician' THEN
        IF NOT public.can_access_work_order(p_lab_organization_id,p_work_order_id) THEN RAISE EXCEPTION 'Work Order access denied'; END IF;
        IF v_order.locked THEN RAISE EXCEPTION 'Work Order is locked'; END IF;
    ELSIF NOT public.is_lab_management(p_lab_organization_id) THEN
        RAISE EXCEPTION 'Management access denied';
    END IF;

    v_element_count:=jsonb_array_length(coalesce(p_items,'[]'::jsonb));
    IF v_element_count=0 THEN RAISE EXCEPTION 'At least one configured tooth is required'; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) item
        WHERE trim(coalesce(item->>'work_type',''))=''
           OR coalesce((item->>'tooth_number')::integer,0)/10 NOT BETWEEN 1 AND 4
           OR coalesce((item->>'tooth_number')::integer,0)%10 NOT BETWEEN 1 AND 8
           OR NOT EXISTS (
               SELECT 1 FROM public.lab_work_types wt
               WHERE wt.lab_organization_id=p_lab_organization_id AND wt.active=true
                 AND lower(trim(wt.tip_lucrare))=lower(trim(item->>'work_type'))
           )
    ) THEN RAISE EXCEPTION 'Every tooth requires a valid active Work Type'; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) item
        GROUP BY (item->>'tooth_number')::integer HAVING count(*)>1
    ) THEN RAISE EXCEPTION 'Duplicate tooth number'; END IF;

    SELECT jsonb_agg(jsonb_build_object(
               'tooth_number',(item->>'tooth_number')::integer,
               'work_type',canonical.tip_lucrare
           ) ORDER BY (item->>'tooth_number')::integer)
    INTO v_canonical_items
    FROM jsonb_array_elements(p_items) item
    CROSS JOIN LATERAL (
        SELECT wt.tip_lucrare
        FROM public.lab_work_types wt
        WHERE wt.lab_organization_id=p_lab_organization_id AND wt.active=true
          AND lower(trim(wt.tip_lucrare))=lower(trim(item->>'work_type'))
        ORDER BY wt.id
        LIMIT 1
    ) canonical;

    -- Snapshot both saved price state and billable scope before any mutation.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'work_type',line.work_type,'billing_mode',line.billing_mode,
        'billing_scope',line.billing_scope,'quantity',line.quantity,
        'contract',line.contract,'unit_price',line.unit_price,
        'subtotal',line.line_total,'matched',line.unit_price IS NOT NULL,
        'price_source',line.price_source
    ) ORDER BY line.work_type,line.billing_scope),'[]'::jsonb)
    INTO v_before_price_lines
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab_organization_id AND line.work_order_id=p_work_order_id;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'work_type',scope.work_type,'billing_mode',scope.billing_mode,'quantity',scope.quantity
    ) ORDER BY scope.work_type,scope.billing_mode),'[]'::jsonb)
    INTO v_scope_before
    FROM public.work_order_billing_scope(p_lab_organization_id,p_work_order_id) scope;

    -- A saved type keeps its frozen spelling and mode. A type entering this
    -- Work Order for the first time takes the current catalog mode.
    WITH requested AS (
        SELECT DISTINCT item->>'work_type' AS work_type
        FROM jsonb_array_elements(v_canonical_items) item
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'work_type',coalesce(frozen.work_type,requested.work_type),
        'billing_mode',coalesce(frozen.billing_mode,current_type.billing_mode)
    ) ORDER BY requested.work_type),'[]'::jsonb)
    INTO v_modes
    FROM requested
    JOIN LATERAL (
        SELECT wt.billing_mode
        FROM public.lab_work_types wt
        WHERE wt.lab_organization_id=p_lab_organization_id AND wt.active=true
          AND lower(trim(wt.tip_lucrare))=lower(trim(requested.work_type))
        ORDER BY wt.id LIMIT 1
    ) current_type ON true
    LEFT JOIN LATERAL (
        SELECT line.work_type,line.billing_mode
        FROM public.lab_work_order_price_lines line
        WHERE line.lab_organization_id=p_lab_organization_id
          AND line.work_order_id=p_work_order_id
          AND lower(trim(line.work_type))=lower(trim(requested.work_type))
        ORDER BY line.billing_scope LIMIT 1
    ) frozen ON true;

    -- Existing unit identities remain untouched. New units of an existing
    -- type reuse a frozen tariff; only a newly introduced type reads catalog data.
    WITH desired AS (
        SELECT * FROM public.derive_billing_units(v_canonical_items,v_modes)
    )
    INSERT INTO public.lab_work_order_price_lines (
        lab_organization_id,work_order_id,work_type,billing_mode,billing_scope,
        contract,unit_price,quantity,line_total,price_source,price_fixed_at,
        price_migrated,created_by_user_id,updated_by_user_id
    )
    SELECT p_lab_organization_id,p_work_order_id,desired.work_type,
           desired.billing_mode,desired.billing_scope,
           CASE WHEN frozen.work_type IS NOT NULL THEN frozen.contract ELSE coalesce(price.contract,'General') END,
           CASE WHEN frozen.work_type IS NOT NULL THEN frozen.unit_price ELSE price.pret END,
           1,
           CASE WHEN frozen.work_type IS NOT NULL THEN round(frozen.unit_price,2) ELSE round(price.pret,2) END,
           CASE WHEN frozen.work_type IS NOT NULL THEN frozen.price_source
                WHEN price.pret IS NULL THEN 'missing' ELSE 'catalog' END,
           CASE WHEN frozen.work_type IS NOT NULL THEN frozen.price_fixed_at ELSE now() END,
           CASE WHEN frozen.work_type IS NOT NULL THEN frozen.price_migrated ELSE false END,
           public.current_legacy_user_id(),public.current_legacy_user_id()
    FROM desired
    LEFT JOIN LATERAL (
        SELECT line.* FROM public.lab_work_order_price_lines line
        WHERE line.lab_organization_id=p_lab_organization_id
          AND line.work_order_id=p_work_order_id
          AND lower(trim(line.work_type))=lower(trim(desired.work_type))
        ORDER BY line.billing_scope LIMIT 1
    ) frozen ON true
    LEFT JOIN LATERAL (
        SELECT cp.contract,cp.pret
        FROM public.lab_contract_work_prices cp
        WHERE cp.lab_organization_id=p_lab_organization_id
          AND lower(trim(cp.tip_lucrare))=lower(trim(desired.work_type))
          AND lower(trim(cp.contract)) IN (
              lower(trim(v_order.nume_partener)),
              lower(coalesce(nullif(trim(p_requested_contract),''),'General')),
              'general'
          )
        ORDER BY CASE
            WHEN lower(trim(cp.contract))=lower(trim(v_order.nume_partener)) THEN 0
            WHEN lower(trim(cp.contract))=lower(coalesce(nullif(trim(p_requested_contract),''),'General')) THEN 1
            ELSE 2
        END,cp.id LIMIT 1
    ) price ON frozen.work_type IS NULL
    ON CONFLICT (lab_organization_id,work_order_id,work_type,billing_scope) DO NOTHING;

    DELETE FROM public.lab_work_order_price_lines existing
    WHERE existing.lab_organization_id=p_lab_organization_id
      AND existing.work_order_id=p_work_order_id
      AND NOT EXISTS (
          SELECT 1 FROM public.derive_billing_units(v_canonical_items,v_modes) desired
          WHERE lower(trim(desired.work_type))=lower(trim(existing.work_type))
            AND desired.billing_scope=existing.billing_scope
      );

    INSERT INTO public.lab_work_order_items (
        lab_organization_id,work_order_id,tooth_number,work_type,contract,
        unit_price,quantity,line_total,price_source,price_fixed_at,price_migrated,
        created_by_user_id,updated_by_user_id,updated_at
    )
    SELECT p_lab_organization_id,p_work_order_id,
           (item->>'tooth_number')::integer,item->>'work_type','General',
           NULL,1,NULL,NULL,NULL,false,
           public.current_legacy_user_id(),public.current_legacy_user_id(),now()
    FROM jsonb_array_elements(v_canonical_items) item
    ON CONFLICT (lab_organization_id,work_order_id,tooth_number)
    DO UPDATE SET work_type=excluded.work_type,contract='General',unit_price=NULL,
        quantity=1,line_total=NULL,price_source=NULL,price_fixed_at=NULL,
        price_migrated=false,updated_by_user_id=excluded.updated_by_user_id,updated_at=now();

    DELETE FROM public.lab_work_order_items existing
    WHERE existing.lab_organization_id=p_lab_organization_id
      AND existing.work_order_id=p_work_order_id
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_canonical_items) item
          WHERE (item->>'tooth_number')::integer=existing.tooth_number
      );

    SELECT line.contract INTO v_first_contract
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab_organization_id AND line.work_order_id=p_work_order_id
    ORDER BY line.work_type,line.billing_scope LIMIT 1;

    SELECT CASE WHEN bool_and(line.line_total IS NOT NULL) THEN round(sum(line.line_total),2) END,
           coalesce(bool_and(line.unit_price IS NOT NULL),false),
           coalesce(jsonb_agg(jsonb_build_object(
               'work_type',line.work_type,'billing_mode',line.billing_mode,
               'billing_scope',line.billing_scope,'quantity',line.quantity,
               'contract',line.contract,'unit_price',line.unit_price,
               'subtotal',line.line_total,'matched',line.unit_price IS NOT NULL,
               'price_source',line.price_source
           ) ORDER BY line.work_type,line.billing_scope),'[]'::jsonb),
           CASE WHEN bool_and(line.price_source='admin_override') THEN 'admin_override' ELSE 'price_lines' END,
           max(line.price_fixed_at)
    INTO v_list,v_matched_all,v_after_price_lines,v_order_price_source,v_order_price_fixed_at
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab_organization_id AND line.work_order_id=p_work_order_id;

    v_final:=CASE WHEN v_list IS NULL THEN NULL
        ELSE round(v_list*(1-(CASE WHEN v_role='doctor' THEN 0 ELSE v_order.discount END)/100),2) END;

    UPDATE public.lab_work_orders
    SET contract=coalesce(v_first_contract,'General'),
        discount=CASE WHEN v_role='doctor' THEN 0 ELSE discount END,
        snapshot_list_price=v_list,snapshot_final_price=v_final,
        price_source=v_order_price_source,
        price_fixed_at=coalesce(v_order_price_fixed_at,now()),price_migrated=false,
        updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;

    IF (v_order.snapshot_list_price,v_order.snapshot_final_price,v_before_price_lines)
       IS DISTINCT FROM (v_list,v_final,v_after_price_lines) THEN
        INSERT INTO public.work_order_financial_audit (
            lab_organization_id,work_order_id,entity_type,entity_id,action,
            before_value,after_value,changed_by_user_id
        ) VALUES (
            p_lab_organization_id,p_work_order_id,'work_order_price',p_work_order_id::text,
            'item_change',
            jsonb_build_object('list_price',v_order.snapshot_list_price,
                'final_price',v_order.snapshot_final_price,'price_lines',v_before_price_lines),
            jsonb_build_object('list_price',v_list,'final_price',v_final,
                'price_lines',v_after_price_lines),auth.uid()
        );
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'work_type',scope.work_type,'billing_mode',scope.billing_mode,'quantity',scope.quantity
    ) ORDER BY scope.work_type,scope.billing_mode),'[]'::jsonb)
    INTO v_scope_after
    FROM public.work_order_billing_scope(p_lab_organization_id,p_work_order_id) scope;
    IF v_scope_before IS DISTINCT FROM v_scope_after THEN
        PERFORM public.adjust_work_order_scope_costs(
            p_lab_organization_id,p_work_order_id,v_scope_before,v_scope_after
        );
        INSERT INTO public.work_order_financial_audit(
            lab_organization_id,work_order_id,entity_type,entity_id,action,
            before_value,after_value,changed_by_user_id
        ) VALUES (
            p_lab_organization_id,p_work_order_id,'work_order_scope',p_work_order_id::text,
            'scope_change',v_scope_before,v_scope_after,auth.uid()
        );
    END IF;

    IF v_role='technician' THEN
        RETURN (SELECT to_jsonb(scope)
            FROM public.work_order_item_scope(p_lab_organization_id,p_work_order_id,false) scope);
    END IF;
    RETURN jsonb_build_object(
        'lines',v_after_price_lines,'element_count',v_element_count,
        'billing_unit_count',coalesce((SELECT sum((line->>'quantity')::numeric)
            FROM jsonb_array_elements(v_after_price_lines) line),0),
        'list_price',v_list,
        'discount',CASE WHEN v_role='doctor' THEN 0 ELSE v_order.discount END,
        'final_price',v_final,'matched_all',v_matched_all,
        'partner_name',v_order.nume_partener
    );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_work_order_items(uuid,bigint,jsonb,text) FROM public,anon,authenticated;
