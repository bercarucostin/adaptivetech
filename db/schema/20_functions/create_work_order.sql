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
