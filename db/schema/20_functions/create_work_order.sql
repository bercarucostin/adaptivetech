-- Flowrise Supabase function: public.create_work_order(p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_tip_lucrare text, p_nr_elemente integer, p_nume_partener text, p_contract text, p_status text, p_discount numeric, p_data_receptie timestamp with time zone)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.create_work_order(p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_tip_lucrare text, p_nr_elemente integer DEFAULT 1, p_nume_partener text DEFAULT NULL::text, p_contract text DEFAULT 'General'::text, p_status text DEFAULT 'Not Started'::text, p_discount numeric DEFAULT 0, p_data_receptie timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
    v_price jsonb;
begin
    if v_role not in ('admin','manager','doctor') then
        raise exception 'Create Work Order denied';
    end if;

    if trim(coalesce(p_nume_pacient,'')) = '' then
        raise exception 'Nume_Pacient is required';
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
    v_price := public.resolve_work_order_price_snapshot(
        p_lab_organization_id, v_partner, v_contract, trim(p_tip_lucrare),
        p_nr_elemente, v_discount
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
        v_status,
        trim(p_nume_pacient),
        v_partner,
        v_contract,
        trim(p_tip_lucrare),
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
        v_discount,
        p_data_receptie,
        false,
        (v_price->>'unit_price')::numeric,
        (v_price->>'list_price')::numeric,
        (v_price->>'final_price')::numeric,
        v_price->>'price_source',
        now(),
        false
    );

    return v_id;
end;
$function$
;

-- Security definer: True
-- Return type: bigint
-- Identity arguments: p_lab_organization_id uuid, p_deadline date, p_nume_pacient text, p_tip_lucrare text, p_nr_elemente integer, p_nume_partener text, p_contract text, p_status text, p_discount numeric, p_data_receptie timestamp with time zone
