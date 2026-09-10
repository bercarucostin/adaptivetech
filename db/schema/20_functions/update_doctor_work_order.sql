-- Flowrise Supabase function: public.update_doctor_work_order(p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_nume_pacient text, p_tip_lucrare text, p_nr_elemente integer)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.update_doctor_work_order(p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_nume_pacient text, p_tip_lucrare text, p_nr_elemente integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_order public.lab_work_orders%rowtype;
begin
    if not public.is_connected_doctor_for_lab(p_lab_organization_id) then
        raise exception 'Doctor access denied';
    end if;

    select *
      into v_order
    from public.lab_work_orders
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id
    for update;

    if not found or not public.doctor_matches_partner(v_order.nume_partener) then
        raise exception 'Work Order access denied';
    end if;

    if v_order.locked then
        raise exception 'Work Order is locked';
    end if;

    if lower(trim(coalesce(v_order.status,''))) <> 'not started' then
        raise exception 'Doctor can edit only Not Started Work Orders';
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

    update public.lab_work_orders
    set
        deadline = p_deadline,
        nume_pacient = trim(p_nume_pacient),
        tip_lucrare = trim(p_tip_lucrare),
        nr_elemente = p_nr_elemente,
        snapshot_list_price = case when snapshot_unit_price is null then null
            else round(snapshot_unit_price * p_nr_elemente, 2) end,
        snapshot_final_price = case when snapshot_unit_price is null then null
            else round(snapshot_unit_price * p_nr_elemente * (1 - coalesce(discount,0) / 100), 2) end,
        updated_by_user_id = public.current_legacy_user_id(),
        updated_at = now()
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id;

    if v_order.nr_elemente is distinct from p_nr_elemente then
        insert into public.work_order_financial_audit (
            lab_organization_id,work_order_id,entity_type,entity_id,action,
            before_value,after_value,changed_by_user_id
        )
        select p_lab_organization_id,p_work_order_id,'work_order_price',p_work_order_id::text,
            'quantity_change',
            jsonb_build_object(
                'quantity',v_order.nr_elemente,'unit_price',v_order.snapshot_unit_price,
                'list_price',v_order.snapshot_list_price,'final_price',v_order.snapshot_final_price
            ),
            jsonb_build_object(
                'quantity',wo.nr_elemente,'unit_price',wo.snapshot_unit_price,
                'list_price',wo.snapshot_list_price,'final_price',wo.snapshot_final_price
            ),auth.uid()
        from public.lab_work_orders wo
        where wo.lab_organization_id=p_lab_organization_id and wo.id=p_work_order_id;
    end if;

    return true;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_nume_pacient text, p_tip_lucrare text, p_nr_elemente integer
