CREATE OR REPLACE FUNCTION public.create_technician_work_order(p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_nume_partener text, p_items jsonb, p_data_receptie timestamp with time zone DEFAULT NULL::timestamp with time zone, p_my_stage text DEFAULT 'Model'::text, p_case jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_id bigint;
    v_tech text;
    v_stage text := lower(trim(coalesce(p_my_stage,'Model')));
    v_model text := null;
    v_modelare text := null;
    v_cer_fin text := null;
begin
    if not public.is_lab_technician(p_lab_organization_id) then
        raise exception 'Technician access denied';
    end if;

    v_tech := trim(coalesce(public.current_technician_name(),''));
    if v_tech = '' then
        raise exception 'Technician profile mapping is missing';
    end if;

    if trim(coalesce(p_nume_pacient,'')) = '' then
        raise exception 'Nume_Pacient is required';
    end if;

    if trim(coalesce(p_nume_partener,'')) = '' then
        raise exception 'Nume_Partener is required';
    end if;

    if v_stage = 'model' then
        v_model := v_tech;
    elsif v_stage = 'modelare' then
        v_modelare := v_tech;
    elsif v_stage in ('cer_fin','cer fin','ceramica/finisare','ceramica / finisare') then
        v_cer_fin := v_tech;
    else
        raise exception 'Invalid technician stage';
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
        tehnician_model,
        tehnician1_modelare,
        tehnician2_cer_fin,
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
        'Not Started',
        trim(p_nume_pacient),
        trim(p_nume_partener),

        -- Commercial data is deliberately forced server-side.
        'General',

        v_model,
        v_modelare,
        v_cer_fin,
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

        -- Technician cannot set or infer client discount.
        0,

        p_data_receptie,
        false,
        null,
        null,
        'pending_items',
        now(),
        false
    );

    perform public.replace_work_order_items(p_lab_organization_id,v_id,p_items,'General');
    perform public.save_work_order_clinical_case(p_lab_organization_id,v_id,p_case);

    perform public.sync_work_order_stage_assignment(
        p_lab_organization_id, v_id,
        case when v_model is not null then 'model'
             when v_modelare is not null then 'modelare' else 'cer_fin' end,
        v_tech
    );

    return v_id;
end;
$function$
;
