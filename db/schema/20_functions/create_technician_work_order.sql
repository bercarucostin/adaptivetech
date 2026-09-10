-- Flowrise Supabase function: public.create_technician_work_order(p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_nume_partener text, p_tip_lucrare text, p_nr_elemente integer, p_data_receptie timestamp with time zone, p_my_stage text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.create_technician_work_order(p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_nume_partener text, p_tip_lucrare text, p_nr_elemente integer DEFAULT 1, p_data_receptie timestamp with time zone DEFAULT NULL::timestamp with time zone, p_my_stage text DEFAULT 'Model'::text)
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
    v_price jsonb;
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

    if trim(coalesce(p_tip_lucrare,'')) = '' then
        raise exception 'Tip_Lucrare is required';
    end if;

    if coalesce(p_nr_elemente,0) <= 0 then
        raise exception 'Nr_Elemente must be > 0';
    end if;

    if not exists (
        select 1
        from public.lab_work_types wt
        where wt.lab_organization_id = p_lab_organization_id
          and wt.active = true
          and wt.tip_lucrare = trim(p_tip_lucrare)
    ) then
        raise exception 'Tip_Lucrare is not active';
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
    v_price := public.resolve_work_order_price_snapshot(
        p_lab_organization_id, trim(p_nume_partener), 'General', trim(p_tip_lucrare),
        p_nr_elemente, 0
    );

    insert into public.lab_work_orders (
        lab_organization_id,
        id,
        deadline,
        status,
        nume_pacient,
        nume_partener,
        contract,
        tip_lucrare,
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
        nr_elemente,
        discount,
        data_receptie,
        locked,
        snapshot_unit_price,
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

        trim(p_tip_lucrare),
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
        p_nr_elemente,

        -- Technician cannot set or infer client discount.
        0,

        p_data_receptie,
        false,
        (v_price->>'unit_price')::numeric,
        (v_price->>'list_price')::numeric,
        (v_price->>'final_price')::numeric,
        v_price->>'price_source',
        now(),
        false
    );

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

-- Security definer: True
-- Return type: bigint
-- Identity arguments: p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_nume_partener text, p_tip_lucrare text, p_nr_elemente integer, p_data_receptie timestamp with time zone, p_my_stage text
