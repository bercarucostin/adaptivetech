-- Apply after 20261002_lab_partner_portal.sql, inside a transaction.
ALTER TABLE public.lab_work_orders
 ADD COLUMN IF NOT EXISTS manual_supplement numeric(12,2) NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS manual_supplement_reason text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.lab_work_orders'::regclass AND conname='work_order_manual_supplement_check') THEN
  ALTER TABLE public.lab_work_orders ADD CONSTRAINT work_order_manual_supplement_check
   CHECK (manual_supplement>=0 AND manual_supplement::text NOT IN ('NaN','Infinity','-Infinity') AND
     (manual_supplement=0 OR length(btrim(coalesce(manual_supplement_reason,''))) BETWEEN 1 AND 1000));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_work_order_manual_supplement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.manual_supplement<>0) OR
    (TG_OP='UPDATE' AND (NEW.manual_supplement,NEW.manual_supplement_reason)
      IS DISTINCT FROM (OLD.manual_supplement,OLD.manual_supplement_reason)) THEN
  IF public.is_lab_management(NEW.lab_organization_id) IS NOT TRUE THEN
   RAISE EXCEPTION 'Management access required for manual supplements';
  END IF;
 END IF;
 -- The frozen list price includes urgency/processing. The supplement is outside
 -- the discount and is recalculated from the base, never added to an old total.
 NEW.snapshot_final_price:=CASE WHEN NEW.snapshot_list_price IS NULL THEN NULL
   ELSE round(NEW.snapshot_list_price*(1-coalesce(NEW.discount,0)/100),2)+NEW.manual_supplement END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_work_order_manual_supplement() FROM PUBLIC;
DROP TRIGGER IF EXISTS work_order_manual_supplement ON public.lab_work_orders;
CREATE TRIGGER work_order_manual_supplement
 BEFORE INSERT OR UPDATE OF snapshot_list_price,snapshot_final_price,discount,manual_supplement,manual_supplement_reason
 ON public.lab_work_orders FOR EACH ROW EXECUTE FUNCTION public.apply_work_order_manual_supplement();

CREATE OR REPLACE FUNCTION public.set_work_order_manual_supplement(p_lab uuid,p_order bigint,p_amount numeric,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old public.lab_work_orders%rowtype; v_saved public.lab_work_orders%rowtype; v_amount numeric; v_reason text;
BEGIN
 IF public.is_lab_management(p_lab) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required'; END IF;
 IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<0 OR p_amount>9999999999.99 THEN
  RAISE EXCEPTION 'Suplimentul trebuie să fie o sumă validă, mai mare sau egală cu zero.';
 END IF;
 v_amount:=round(p_amount,2);v_reason:=nullif(btrim(p_reason),'');
 IF v_amount>0 AND v_reason IS NULL THEN RAISE EXCEPTION 'Justificarea suplimentului este obligatorie.'; END IF;
 IF length(v_reason)>1000 THEN RAISE EXCEPTION 'Justificarea poate avea cel mult 1000 de caractere.'; END IF;
 IF v_amount=0 THEN v_reason:=NULL; END IF;
 SELECT * INTO v_old FROM public.lab_work_orders WHERE lab_organization_id=p_lab AND id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;
 IF (v_old.manual_supplement,v_old.manual_supplement_reason) IS DISTINCT FROM (v_amount,v_reason) THEN
  UPDATE public.lab_work_orders SET manual_supplement=v_amount,manual_supplement_reason=v_reason,
    updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
   WHERE lab_organization_id=p_lab AND id=p_order RETURNING * INTO v_saved;
  INSERT INTO public.work_order_financial_audit(lab_organization_id,work_order_id,entity_type,entity_id,action,before_value,after_value,changed_by_user_id)
   VALUES(p_lab,p_order,'work_order_price',p_order::text,'manual_supplement',
    jsonb_build_object('amount',v_old.manual_supplement,'reason',v_old.manual_supplement_reason,'final_price',v_old.snapshot_final_price),
    jsonb_build_object('amount',v_amount,'reason',v_reason,'final_price',v_saved.snapshot_final_price),auth.uid());
 ELSE v_saved:=v_old;
 END IF;
 RETURN jsonb_build_object('amount',v_saved.manual_supplement,'reason',v_saved.manual_supplement_reason,'final_price',v_saved.snapshot_final_price);
END $$;
REVOKE ALL ON FUNCTION public.set_work_order_manual_supplement(uuid,bigint,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_work_order_manual_supplement(uuid,bigint,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_lab_partner(p_lab uuid,p_partner uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF coalesce(public.effective_lab_role(p_lab),'')<>'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
 PERFORM 1 FROM public.lab_partners WHERE lab_organization_id=p_lab AND id=p_partner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Partenerul nu a fost găsit.'; END IF;
 -- Keep historical names, cases, attachments and financial snapshots intact.
 UPDATE public.lab_work_orders SET partner_id=NULL WHERE lab_organization_id=p_lab AND partner_id=p_partner;
 DELETE FROM public.lab_partner_user_links WHERE lab_organization_id=p_lab AND partner_id=p_partner;
 DELETE FROM public.lab_partners WHERE lab_organization_id=p_lab AND id=p_partner;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.delete_lab_partner(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_lab_partner(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_management_work_order_with_supplement(

    p_lab_organization_id uuid,
    p_work_order_id bigint,
    p_deadline date,
    p_status text,
    p_nume_pacient text,
    p_nume_partener text,
    p_contract text,
    p_discount numeric,
    p_data_receptie timestamptz,
    p_tehnician_model text,
    p_tehnician1_modelare text,
    p_tehnician2_cer_fin text,
    p_status_model text,
    p_status_modelare text,
    p_status_cer_fin text,
    p_paid_model text,
    p_paid_modelare text,
    p_paid_cer_fin text,
    p_model_not_applicable boolean,
    p_modelare_not_applicable boolean,
    p_cer_fin_not_applicable boolean,
    p_locked boolean,
    p_model_settlement text DEFAULT NULL,
    p_modelare_settlement text DEFAULT NULL,
    p_cer_fin_settlement text DEFAULT NULL,
    p_items jsonb DEFAULT NULL,
    p_requested_contract text DEFAULT 'General',
    p_case jsonb DEFAULT '{}'::jsonb
,
    p_manual_supplement numeric DEFAULT NULL,
    p_manual_supplement_reason text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF public.is_lab_management(p_lab_organization_id) IS NOT TRUE THEN RAISE EXCEPTION 'Management access required'; END IF;
    PERFORM public.update_management_work_order_v188(
        p_lab_organization_id=>p_lab_organization_id,
        p_work_order_id=>p_work_order_id,
        p_deadline=>p_deadline,
        p_status=>p_status,
        p_nume_pacient=>p_nume_pacient,
        p_nume_partener=>p_nume_partener,
        p_contract=>p_contract,
        p_discount=>p_discount,
        p_data_receptie=>p_data_receptie,
        p_tehnician_model=>p_tehnician_model,
        p_tehnician1_modelare=>p_tehnician1_modelare,
        p_tehnician2_cer_fin=>p_tehnician2_cer_fin,
        p_status_model=>p_status_model,
        p_status_modelare=>p_status_modelare,
        p_status_cer_fin=>p_status_cer_fin,
        p_paid_model=>p_paid_model,
        p_paid_modelare=>p_paid_modelare,
        p_paid_cer_fin=>p_paid_cer_fin,
        p_model_not_applicable=>p_model_not_applicable,
        p_modelare_not_applicable=>p_modelare_not_applicable,
        p_cer_fin_not_applicable=>p_cer_fin_not_applicable,
        p_locked=>p_locked,
        p_model_settlement=>p_model_settlement,
        p_modelare_settlement=>p_modelare_settlement,
        p_cer_fin_settlement=>p_cer_fin_settlement,
        p_items=>p_items,
        p_requested_contract=>p_requested_contract,
        p_case=>p_case
    );
    IF p_manual_supplement IS NOT NULL THEN
      PERFORM public.set_work_order_manual_supplement(p_lab_organization_id,p_work_order_id,p_manual_supplement,p_manual_supplement_reason);
    END IF;
    RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.update_management_work_order_with_supplement(uuid,bigint,date,text,text,text,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text,text,jsonb,text,jsonb,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_management_work_order_with_supplement(uuid,bigint,date,text,text,text,text,numeric,timestamptz,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text,text,jsonb,text,jsonb,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_work_order_price_lines(p_lab uuid,p_order bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
    v_role text := public.effective_lab_role(p_lab);
    v_result jsonb;
BEGIN
    IF coalesce(v_role,'') NOT IN ('admin','manager','doctor') THEN
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
                'subtotal',line.line_total,'base_subtotal',line.base_line_total,
                'urgent_percent',line.urgent_percent,'urgency_surcharge',line.urgency_surcharge,
                'matched',line.unit_price IS NOT NULL,
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
        'manual_supplement',wo.manual_supplement,'manual_supplement_reason',wo.manual_supplement_reason,
        'final_price',wo.snapshot_final_price,'partner_name',wo.nume_partener,
        'deadline_at',wo.deadline_at,'approval_state',wo.approval_state,
        'approval_reason',wo.approval_reason
    ) INTO v_result
    FROM public.lab_work_orders wo
    WHERE wo.lab_organization_id=p_lab AND wo.id=p_order;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_work_order_price_lines(uuid,bigint) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_work_order_price_lines(uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_lab_partner_work_order(p_lab uuid,p_order bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
 IF public.lab_partner_can_access_order(p_lab,p_order) IS NOT TRUE AND public.is_lab_management(p_lab) IS NOT TRUE THEN
   RAISE EXCEPTION 'Order access denied';
 END IF;
 SELECT jsonb_build_object('id',o.id,'deadline_at',o.deadline_at,'status',o.status,'locked',o.locked,
  'can_edit',public.lab_partner_order_is_editable(p_lab,o.id),'submission_revision',o.submission_revision,
  'approval_state',o.approval_state,'approval_reason',o.approval_reason,
  'approval_reviewed_at',o.approval_reviewed_at,'manual_supplement',o.manual_supplement,'manual_supplement_reason',o.manual_supplement_reason,'final_price',o.snapshot_final_price,
  'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no)
      FROM public.lab_partner_work_order_items i WHERE i.lab_organization_id=p_lab AND i.work_order_id=p_order),'[]'::jsonb),
  'price_lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no)
      FROM public.lab_partner_work_order_price_lines l WHERE l.lab_organization_id=p_lab AND l.work_order_id=p_order),'[]'::jsonb))
 INTO v_result FROM public.lab_work_orders o WHERE o.lab_organization_id=p_lab AND o.id=p_order
  AND o.order_origin='lab_partner';
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_lab_partner_work_order(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lab_partner_work_order(uuid,bigint) TO authenticated;
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
    SELECT p_lab_organization_id,p_work_order_id,
           coalesce(existing_unit.work_type,desired.work_type),
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
        SELECT line.work_type,line.billing_scope
        FROM public.lab_work_order_price_lines line
        WHERE line.lab_organization_id=p_lab_organization_id
          AND line.work_order_id=p_work_order_id
          AND lower(trim(line.work_type))=lower(trim(desired.work_type))
    ) existing_unit ON existing_unit.billing_scope=desired.billing_scope
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
    WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
    RETURNING snapshot_final_price INTO v_final;

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
    v_unit_price numeric;
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
    v_unit_price:=round(p_unit_price,2);

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

    UPDATE public.lab_work_order_price_lines
    SET unit_price=v_unit_price,
        line_total=round(v_unit_price*quantity,2),
        price_source='admin_override',price_fixed_at=now(),price_migrated=false,
        updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    WHERE lab_organization_id=p_lab AND work_order_id=p_work_order_id;

    SELECT round(sum(line.line_total),2) INTO v_list
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_work_order_id;
    IF v_list IS NULL THEN RAISE EXCEPTION 'Work Order requires price lines'; END IF;
    v_final:=round(v_list*(1-p_discount/100),2);

    UPDATE public.lab_work_orders
    SET snapshot_list_price=v_list,snapshot_final_price=v_final,
        discount=p_discount,price_source='admin_override',price_fixed_at=now(),
        price_migrated=false,updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    WHERE lab_organization_id=p_lab AND id=p_work_order_id
    RETURNING snapshot_final_price INTO v_final;

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
        'unit_price',v_unit_price,'list_price',v_list,'final_price',v_final,
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
