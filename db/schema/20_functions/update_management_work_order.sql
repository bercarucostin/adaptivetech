-- Flowrise Supabase function: public.update_management_work_order(p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_status text, p_nume_pacient text, p_nume_partener text, p_contract text, p_tip_lucrare text, p_nr_elemente integer, p_discount numeric, p_data_receptie timestamp with time zone, p_tehnician_model text, p_tehnician1_modelare text, p_tehnician2_cer_fin text, p_status_model text, p_status_modelare text, p_status_cer_fin text, p_paid_model text, p_paid_modelare text, p_paid_cer_fin text, p_locked boolean)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.update_management_work_order(p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_status text, p_nume_pacient text, p_nume_partener text, p_contract text, p_tip_lucrare text, p_nr_elemente integer, p_discount numeric, p_data_receptie timestamp with time zone, p_tehnician_model text, p_tehnician1_modelare text, p_tehnician2_cer_fin text, p_status_model text, p_status_modelare text, p_status_cer_fin text, p_paid_model text, p_paid_modelare text, p_paid_cer_fin text, p_locked boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    if not exists (
        select 1
        from public.lab_work_orders wo
        where wo.lab_organization_id = p_lab_organization_id
          and wo.id = p_work_order_id
    ) then
        raise exception 'Work Order not found';
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

    if coalesce(p_discount,0) < 0 or coalesce(p_discount,0) > 100 then
        raise exception 'Discount must be between 0 and 100';
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

    update public.lab_work_orders
    set
        deadline = p_deadline,
        status = coalesce(nullif(trim(p_status),''),'Not Started'),
        nume_pacient = trim(p_nume_pacient),
        nume_partener = trim(p_nume_partener),
        contract = coalesce(nullif(trim(p_contract),''),'General'),
        tip_lucrare = trim(p_tip_lucrare),
        nr_elemente = p_nr_elemente,
        discount = coalesce(p_discount,0),
        data_receptie = p_data_receptie,

        tehnician_model = nullif(trim(coalesce(p_tehnician_model,'')),''),
        tehnician1_modelare = nullif(trim(coalesce(p_tehnician1_modelare,'')),''),
        tehnician2_cer_fin = nullif(trim(coalesce(p_tehnician2_cer_fin,'')),''),
        status_model = coalesce(nullif(trim(p_status_model),''),'Not Started'),
        status_modelare = coalesce(nullif(trim(p_status_modelare),''),'Not Started'),
        status_cer_fin = coalesce(nullif(trim(p_status_cer_fin),''),'Not Started'),

        paid_model = coalesce(nullif(trim(p_paid_model),''),'Not Paid'),
        paid_modelare = coalesce(nullif(trim(p_paid_modelare),''),'Not Paid'),
        paid_cer_fin = coalesce(nullif(trim(p_paid_cer_fin),''),'Not Paid'),

        locked = coalesce(p_locked,false),
        updated_by_user_id = public.current_legacy_user_id(),
        updated_at = now()
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id;

    -- Keep patient-case snapshot fields aligned with current Work Order.
    update public.lab_patient_cases
    set
        nume_pacient = trim(p_nume_pacient),
        nume_partener = trim(p_nume_partener),
        tip_lucrare = trim(p_tip_lucrare),
        deadline = p_deadline,
        updated_by_user_id = public.current_legacy_user_id(),
        updated_at = now()
    where lab_organization_id = p_lab_organization_id
      and work_order_id = p_work_order_id;

    return true;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_status text, p_nume_pacient text, p_nume_partener text, p_contract text, p_tip_lucrare text, p_nr_elemente integer, p_discount numeric, p_data_receptie timestamp with time zone, p_tehnician_model text, p_tehnician1_modelare text, p_tehnician2_cer_fin text, p_status_model text, p_status_modelare text, p_status_cer_fin text, p_paid_model text, p_paid_modelare text, p_paid_cer_fin text, p_locked boolean
