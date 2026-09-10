CREATE OR REPLACE FUNCTION public.create_work_order(p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_items jsonb, p_nume_partener text DEFAULT NULL::text, p_contract text DEFAULT 'General'::text, p_status text DEFAULT 'Not Started'::text, p_discount numeric DEFAULT 0, p_data_receptie timestamp with time zone DEFAULT NULL::timestamp with time zone, p_case jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_role text := public.effective_lab_role(p_lab_organization_id);
    v_partner text;
    v_status text;
    v_contract text;
    v_discount numeric;
    v_id bigint;
begin
    if v_role is null or v_role not in ('admin','manager','doctor') then
        raise exception 'Create Work Order denied';
    end if;

    if trim(coalesce(p_nume_pacient,'')) = '' then
        raise exception 'Nume_Pacient is required';
    end if;

    if v_role = 'doctor' then
        select p.legacy_partner_name
          into v_partner
        from public.profiles p
        where p.id = auth.uid()
          and p.active = true;

        if trim(coalesce(v_partner,'')) = '' then
            raise exception 'Doctor partner mapping is missing';
        end if;

        v_status := 'Not Started';
        v_contract := 'General';
        v_discount := 0;
    else
        v_partner := nullif(trim(coalesce(p_nume_partener,'')),'');
        if v_partner is null then
            raise exception 'Nume_Partener is required for management-created Work Orders';
        end if;

        v_status := coalesce(nullif(trim(p_status),''),'Not Started');
        v_contract := coalesce(nullif(trim(p_contract),''),'General');
        v_discount := coalesce(p_discount,0);

        if v_discount < 0 or v_discount > 100 then
            raise exception 'Discount must be between 0 and 100';
        end if;
    end if;

    v_id := public.next_lab_work_order_id(p_lab_organization_id);

    insert into public.lab_work_orders (
        lab_organization_id,
        id,
        deadline,
        status,
        nume_pacient,
        nume_partener,
        contract,
        status_model,
        status_modelare,
        status_cer_fin,
        paid_model,
        paid_modelare,
        paid_cer_fin,
        created_by_user_id,
        created_at,
        updated_by_user_id,
        updated_at,
        discount,
        data_receptie,
        locked,
        snapshot_list_price,
        snapshot_final_price,
        price_source,
        price_fixed_at,
        price_migrated
    )
    values (
        p_lab_organization_id,
        v_id,
        p_deadline,
        v_status,
        trim(p_nume_pacient),
        v_partner,
        v_contract,
        'Not Started',
        'Not Started',
        'Not Started',
        'Not Paid',
        'Not Paid',
        'Not Paid',
        public.current_legacy_user_id(),
        now(),
        public.current_legacy_user_id(),
        now(),
        v_discount,
        p_data_receptie,
        false,
        null,
        null,
        'pending_items',
        now(),
        false
    );

    perform public.replace_work_order_items(p_lab_organization_id,v_id,p_items,v_contract);
    perform public.save_work_order_clinical_case(p_lab_organization_id,v_id,p_case);
    return v_id;
end;
$function$
;

-- Management creation is one transaction, including initial stage state and payments.
-- The base writer saves validated items, frozen prices and the case before any costs.
CREATE OR REPLACE FUNCTION public.create_management_work_order(
    p_lab_organization_id uuid,p_deadline date,p_nume_pacient text,p_nume_partener text,p_items jsonb,
    p_contract text DEFAULT 'General',p_status text DEFAULT 'Not Started',p_discount numeric DEFAULT 0,
    p_data_receptie timestamptz DEFAULT NULL,p_tehnician_model text DEFAULT NULL,
    p_tehnician1_modelare text DEFAULT NULL,p_tehnician2_cer_fin text DEFAULT NULL,
    p_status_model text DEFAULT 'Not Started',p_status_modelare text DEFAULT 'Not Started',
    p_status_cer_fin text DEFAULT 'Not Started',p_paid_model text DEFAULT 'Not Paid',
    p_paid_modelare text DEFAULT 'Not Paid',p_paid_cer_fin text DEFAULT 'Not Paid',
    p_model_not_applicable boolean DEFAULT false,p_modelare_not_applicable boolean DEFAULT false,
    p_cer_fin_not_applicable boolean DEFAULT false,p_locked boolean DEFAULT false,p_case jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id bigint; v_order public.lab_work_orders%rowtype;
BEGIN
    IF NOT public.is_lab_management(p_lab_organization_id) THEN RAISE EXCEPTION 'Management access denied'; END IF;
    v_id:=public.create_work_order(p_lab_organization_id,p_deadline,p_nume_pacient,p_items,p_nume_partener,
        p_contract,'Not Started',p_discount,p_data_receptie,p_case);
    UPDATE public.lab_work_orders SET
        tehnician_model=nullif(trim(p_tehnician_model),''),
        tehnician1_modelare=nullif(trim(p_tehnician1_modelare),''),
        tehnician2_cer_fin=nullif(trim(p_tehnician2_cer_fin),''),
        status_model=coalesce(nullif(trim(p_status_model),''),'Not Started'),
        status_modelare=coalesce(nullif(trim(p_status_modelare),''),'Not Started'),
        status_cer_fin=coalesce(nullif(trim(p_status_cer_fin),''),'Not Started'),
        model_not_applicable=coalesce(p_model_not_applicable,false),
        modelare_not_applicable=coalesce(p_modelare_not_applicable,false),
        cer_fin_not_applicable=coalesce(p_cer_fin_not_applicable,false),
        status=coalesce(nullif(trim(p_status),''),'Not Started'),locked=coalesce(p_locked,false)
    WHERE lab_organization_id=p_lab_organization_id AND id=v_id RETURNING * INTO v_order;
    PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,v_id,'model',v_order.tehnician_model);
    PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,v_id,'modelare',v_order.tehnician1_modelare);
    PERFORM public.sync_work_order_stage_assignment(p_lab_organization_id,v_id,'cer_fin',v_order.tehnician2_cer_fin);
    IF v_order.tehnician_model IS NOT NULL THEN
        PERFORM public.set_stage_payment_status(p_lab_organization_id,v_id,'model',coalesce(p_paid_model,'Not Paid'));
    END IF;
    IF v_order.tehnician1_modelare IS NOT NULL THEN
        PERFORM public.set_stage_payment_status(p_lab_organization_id,v_id,'modelare',coalesce(p_paid_modelare,'Not Paid'));
    END IF;
    IF v_order.tehnician2_cer_fin IS NOT NULL THEN
        PERFORM public.set_stage_payment_status(p_lab_organization_id,v_id,'cer_fin',coalesce(p_paid_cer_fin,'Not Paid'));
    END IF;
    RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_management_work_order(uuid,date,text,text,jsonb,text,text,numeric,timestamptz,
    text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_management_work_order(uuid,date,text,text,jsonb,text,text,numeric,timestamptz,
    text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,jsonb) TO authenticated;
