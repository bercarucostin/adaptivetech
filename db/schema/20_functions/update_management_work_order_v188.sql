CREATE OR REPLACE FUNCTION public.update_management_work_order_v188(
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
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old public.lab_work_orders%rowtype;
    v_saved public.lab_work_orders%rowtype;
    v_before jsonb;
    v_after jsonb;
    v_model text;
    v_modelare text;
    v_cer_fin text;
    v_status_model text;
    v_status_modelare text;
    v_status_cer_fin text;
    v_paid_model text;
    v_paid_modelare text;
    v_paid_cer_fin text;
    v_model_changed boolean;
    v_modelare_changed boolean;
    v_cer_fin_changed boolean;
    v_work_status text;
BEGIN
    IF NOT public.is_lab_management(p_lab_organization_id) THEN
        RAISE EXCEPTION 'Management access denied';
    END IF;

    SELECT * INTO v_old
    FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found'; END IF;

    IF trim(coalesce(p_nume_pacient,''))='' THEN RAISE EXCEPTION 'Nume_Pacient is required'; END IF;
    IF trim(coalesce(p_nume_partener,''))='' THEN RAISE EXCEPTION 'Nume_Partener is required'; END IF;
    IF coalesce(p_discount,0)<0 OR coalesce(p_discount,0)>100 THEN
        RAISE EXCEPTION 'Discount must be between 0 and 100';
    END IF;

    v_model := CASE WHEN coalesce(p_model_not_applicable,false) THEN NULL
        ELSE nullif(trim(coalesce(p_tehnician_model,'')),'') END;
    v_modelare := CASE WHEN coalesce(p_modelare_not_applicable,false) THEN NULL
        ELSE nullif(trim(coalesce(p_tehnician1_modelare,'')),'') END;
    v_cer_fin := CASE WHEN coalesce(p_cer_fin_not_applicable,false) THEN NULL
        ELSE nullif(trim(coalesce(p_tehnician2_cer_fin,'')),'') END;
    v_status_model := CASE WHEN coalesce(p_model_not_applicable,false) THEN 'Not Started'
        ELSE coalesce(nullif(trim(p_status_model),''),'Not Started') END;
    v_status_modelare := CASE WHEN coalesce(p_modelare_not_applicable,false) THEN 'Not Started'
        ELSE coalesce(nullif(trim(p_status_modelare),''),'Not Started') END;
    v_status_cer_fin := CASE WHEN coalesce(p_cer_fin_not_applicable,false) THEN 'Not Started'
        ELSE coalesce(nullif(trim(p_status_cer_fin),''),'Not Started') END;
    v_paid_model := CASE WHEN v_model IS NULL THEN 'Not Paid'
        ELSE coalesce(nullif(trim(p_paid_model),''),'Not Paid') END;
    v_paid_modelare := CASE WHEN v_modelare IS NULL THEN 'Not Paid'
        ELSE coalesce(nullif(trim(p_paid_modelare),''),'Not Paid') END;
    v_paid_cer_fin := CASE WHEN v_cer_fin IS NULL THEN 'Not Paid'
        ELSE coalesce(nullif(trim(p_paid_cer_fin),''),'Not Paid') END;

    v_model_changed := lower(trim(coalesce(v_old.tehnician_model,'')))
        IS DISTINCT FROM lower(trim(coalesce(v_model,'')));
    v_modelare_changed := lower(trim(coalesce(v_old.tehnician1_modelare,'')))
        IS DISTINCT FROM lower(trim(coalesce(v_modelare,'')));
    v_cer_fin_changed := lower(trim(coalesce(v_old.tehnician2_cer_fin,'')))
        IS DISTINCT FROM lower(trim(coalesce(v_cer_fin,'')));
    -- Reassignment closes the former assignment without undoing its payment.
    -- The new assignment always starts unpaid, even if the form carried the
    -- previous assignment's stale Paid value.
    IF v_model_changed THEN v_paid_model:='Not Paid'; END IF;
    IF v_modelare_changed THEN v_paid_modelare:='Not Paid'; END IF;
    IF v_cer_fin_changed THEN v_paid_cer_fin:='Not Paid'; END IF;
    IF v_model_changed THEN v_status_model:='Not Started'; END IF;
    IF v_modelare_changed THEN v_status_modelare:='Not Started'; END IF;
    IF v_cer_fin_changed THEN v_status_cer_fin:='Not Started'; END IF;
    v_work_status:=coalesce(nullif(trim(p_status),''),'Not Started');
    IF (v_model_changed OR v_modelare_changed OR v_cer_fin_changed)
       AND v_work_status NOT IN ('Not Started','Started') THEN
        v_work_status:='Started';
    END IF;

    IF v_model_changed THEN
        PERFORM public.prepare_stage_reassignment(
            p_lab_organization_id,p_work_order_id,'model',v_model,p_model_settlement);
    END IF;
    IF v_modelare_changed THEN
        PERFORM public.prepare_stage_reassignment(
            p_lab_organization_id,p_work_order_id,'modelare',v_modelare,p_modelare_settlement);
    END IF;
    IF v_cer_fin_changed THEN
        PERFORM public.prepare_stage_reassignment(
            p_lab_organization_id,p_work_order_id,'cer_fin',v_cer_fin,p_cer_fin_settlement);
    END IF;

    -- Close changed technicians before the scope replacement; their frozen balance belongs
    -- to the prior scope, and the new assignment is priced only after new items exist.
    WITH closed AS (
        UPDATE public.lab_work_order_stage_assignments SET ended_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND work_order_id=p_work_order_id AND ended_at IS NULL
          AND ((stage_key='model' AND v_model_changed) OR (stage_key='modelare' AND v_modelare_changed)
               OR (stage_key='cer_fin' AND v_cer_fin_changed)) RETURNING *
    ) INSERT INTO public.work_order_financial_audit(lab_organization_id,work_order_id,entity_type,entity_id,action,before_value,after_value,changed_by_user_id)
      SELECT p_lab_organization_id,p_work_order_id,'stage_assignment',id::text,'close_for_reassignment',
          to_jsonb(closed)||jsonb_build_object('ended_at',null),to_jsonb(closed),auth.uid() FROM closed;

    v_before := jsonb_build_object(
        'list_price',v_old.snapshot_list_price,'final_price',v_old.snapshot_final_price,
        'discount',v_old.discount
    );

    UPDATE public.lab_work_orders wo
    SET deadline=p_deadline,
        status=v_work_status,
        nume_pacient=trim(p_nume_pacient),
        nume_partener=trim(p_nume_partener),
        contract=coalesce(nullif(trim(p_contract),''),'General'),
        discount=coalesce(p_discount,0),
        data_receptie=p_data_receptie,
        tehnician_model=v_model,
        tehnician1_modelare=v_modelare,
        tehnician2_cer_fin=v_cer_fin,
        status_model=v_status_model,
        status_modelare=v_status_modelare,
        status_cer_fin=v_status_cer_fin,
        paid_model=CASE WHEN v_model_changed THEN 'Not Paid' ELSE paid_model END,
        paid_modelare=CASE WHEN v_modelare_changed THEN 'Not Paid' ELSE paid_modelare END,
        paid_cer_fin=CASE WHEN v_cer_fin_changed THEN 'Not Paid' ELSE paid_cer_fin END,
        model_not_applicable=coalesce(p_model_not_applicable,false),
        modelare_not_applicable=coalesce(p_modelare_not_applicable,false),
        cer_fin_not_applicable=coalesce(p_cer_fin_not_applicable,false),
        locked=coalesce(p_locked,false),
        updated_by_user_id=public.current_legacy_user_id(),
        updated_at=now()
    WHERE wo.lab_organization_id=p_lab_organization_id AND wo.id=p_work_order_id
    RETURNING wo.* INTO v_saved;

    -- Price lines must be fixed before technician costs. This prevents a
    -- multi-type case from assigning every tooth the primary work-type cost.
    IF p_items IS NULL THEN RAISE EXCEPTION 'At least one configured tooth is required'; END IF;
    PERFORM public.replace_work_order_items(
        p_lab_organization_id,p_work_order_id,p_items,p_requested_contract);
    SELECT * INTO v_saved FROM public.lab_work_orders
    WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id;

    v_after := jsonb_build_object(
        'list_price',v_saved.snapshot_list_price,'final_price',v_saved.snapshot_final_price,
        'discount',v_saved.discount
    );
    IF v_before IS DISTINCT FROM v_after THEN
        INSERT INTO public.work_order_financial_audit(
            lab_organization_id,work_order_id,entity_type,entity_id,action,
            before_value,after_value,changed_by_user_id
        ) VALUES (
            p_lab_organization_id,p_work_order_id,'work_order_price',p_work_order_id::text,
            'quantity_or_discount',v_before,v_after,auth.uid()
        );
    END IF;

    UPDATE public.lab_patient_cases
    SET nume_pacient=trim(p_nume_pacient),nume_partener=trim(p_nume_partener),
        deadline=p_deadline,
        updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    WHERE lab_organization_id=p_lab_organization_id AND work_order_id=p_work_order_id;

    PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'model',v_saved.tehnician_model);
    PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'modelare',v_saved.tehnician1_modelare);
    PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'cer_fin',v_saved.tehnician2_cer_fin);

    IF v_saved.tehnician_model IS NOT NULL
       AND v_paid_model IS DISTINCT FROM coalesce(v_saved.paid_model,'Not Paid') THEN
        PERFORM public.set_stage_payment_status(p_lab_organization_id,p_work_order_id,'model',v_paid_model);
    END IF;
    IF v_saved.tehnician1_modelare IS NOT NULL
       AND v_paid_modelare IS DISTINCT FROM coalesce(v_saved.paid_modelare,'Not Paid') THEN
        PERFORM public.set_stage_payment_status(p_lab_organization_id,p_work_order_id,'modelare',v_paid_modelare);
    END IF;
    IF v_saved.tehnician2_cer_fin IS NOT NULL
       AND v_paid_cer_fin IS DISTINCT FROM coalesce(v_saved.paid_cer_fin,'Not Paid') THEN
        PERFORM public.set_stage_payment_status(p_lab_organization_id,p_work_order_id,'cer_fin',v_paid_cer_fin);
    END IF;

    PERFORM public.save_work_order_clinical_case(p_lab_organization_id,p_work_order_id,p_case);
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_management_work_order_v188(
    uuid,bigint,date,text,text,text,text,numeric,timestamptz,
    text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,
    text,text,text,jsonb,text,jsonb
) FROM public;
GRANT EXECUTE ON FUNCTION public.update_management_work_order_v188(
    uuid,bigint,date,text,text,text,text,numeric,timestamptz,
    text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,
    text,text,text,jsonb,text,jsonb
) TO authenticated;
