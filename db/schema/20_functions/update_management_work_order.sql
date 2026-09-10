-- Flowrise Supabase function: public.update_management_work_order(p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_status text, p_nume_pacient text, p_nume_partener text, p_contract text, p_tip_lucrare text, p_nr_elemente integer, p_discount numeric, p_data_receptie timestamp with time zone, p_tehnician_model text, p_tehnician1_modelare text, p_tehnician2_cer_fin text, p_status_model text, p_status_modelare text, p_status_cer_fin text, p_paid_model text, p_paid_modelare text, p_paid_cer_fin text, p_locked boolean)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.update_management_work_order(p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_status text, p_nume_pacient text, p_nume_partener text, p_contract text, p_tip_lucrare text, p_nr_elemente integer, p_discount numeric, p_data_receptie timestamp with time zone, p_tehnician_model text, p_tehnician1_modelare text, p_tehnician2_cer_fin text, p_status_model text, p_status_modelare text, p_status_cer_fin text, p_paid_model text, p_paid_modelare text, p_paid_cer_fin text, p_locked boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_before jsonb;
    v_after jsonb;
    v_old_order public.lab_work_orders%rowtype;
begin
    if not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    select * into v_old_order from public.lab_work_orders
    where lab_organization_id = p_lab_organization_id and id = p_work_order_id
    for update;
    if not found then raise exception 'Work Order not found'; end if;

    select jsonb_build_object(
        'list_price', snapshot_list_price,
        'final_price', snapshot_final_price,
        'quantity', nr_elemente,
        'discount', discount
    ) into v_before
    from public.lab_work_orders
    where lab_organization_id = p_lab_organization_id and id = p_work_order_id
    for update;

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

        locked = coalesce(p_locked,false),
        updated_by_user_id = public.current_legacy_user_id(),
        updated_at = now()
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id;

    update public.lab_work_orders wo
    set snapshot_list_price = case
            when exists (
                select 1 from public.lab_work_order_items i
                where i.lab_organization_id = p_lab_organization_id
                  and i.work_order_id = p_work_order_id
            ) then (
                select sum(i.line_total) from public.lab_work_order_items i
                where i.lab_organization_id = p_lab_organization_id
                  and i.work_order_id = p_work_order_id
            )
            when wo.snapshot_unit_price is null then null
            else round(wo.snapshot_unit_price * p_nr_elemente, 2)
        end,
        snapshot_final_price = case
            when exists (
                select 1 from public.lab_work_order_items i
                where i.lab_organization_id = p_lab_organization_id
                  and i.work_order_id = p_work_order_id
            ) then round((
                select sum(i.line_total) from public.lab_work_order_items i
                where i.lab_organization_id = p_lab_organization_id
                  and i.work_order_id = p_work_order_id
            ) * (1 - coalesce(p_discount,0) / 100), 2)
            when wo.snapshot_unit_price is null then null
            else round(wo.snapshot_unit_price * p_nr_elemente * (1 - coalesce(p_discount,0) / 100), 2)
        end
    where wo.lab_organization_id = p_lab_organization_id
      and wo.id = p_work_order_id;

    select jsonb_build_object(
        'list_price', snapshot_list_price,
        'final_price', snapshot_final_price,
        'quantity', nr_elemente,
        'discount', discount
    ) into v_after
    from public.lab_work_orders
    where lab_organization_id = p_lab_organization_id and id = p_work_order_id;

    if v_before is distinct from v_after then
        insert into public.work_order_financial_audit (
            lab_organization_id, work_order_id, entity_type, entity_id, action,
            before_value, after_value, changed_by_user_id
        ) values (
            p_lab_organization_id, p_work_order_id, 'work_order_price',
            p_work_order_id::text, 'quantity_or_discount', v_before, v_after, auth.uid()
        );
    end if;

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

    perform public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'model',p_tehnician_model);
    perform public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'modelare',p_tehnician1_modelare);
    perform public.sync_work_order_stage_assignment(p_lab_organization_id,p_work_order_id,'cer_fin',p_tehnician2_cer_fin);

    if coalesce(nullif(trim(p_paid_model),''),'Not Paid') is distinct from coalesce(v_old_order.paid_model,'Not Paid') then
        perform public.set_stage_payment_status(p_lab_organization_id,p_work_order_id,'model',p_paid_model);
    end if;
    if coalesce(nullif(trim(p_paid_modelare),''),'Not Paid') is distinct from coalesce(v_old_order.paid_modelare,'Not Paid') then
        perform public.set_stage_payment_status(p_lab_organization_id,p_work_order_id,'modelare',p_paid_modelare);
    end if;
    if coalesce(nullif(trim(p_paid_cer_fin),''),'Not Paid') is distinct from coalesce(v_old_order.paid_cer_fin,'Not Paid') then
        perform public.set_stage_payment_status(p_lab_organization_id,p_work_order_id,'cer_fin',p_paid_cer_fin);
    end if;

    return true;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_status text, p_nume_pacient text, p_nume_partener text, p_contract text, p_tip_lucrare text, p_nr_elemente integer, p_discount numeric, p_data_receptie timestamp with time zone, p_tehnician_model text, p_tehnician1_modelare text, p_tehnician2_cer_fin text, p_status_model text, p_status_modelare text, p_status_cer_fin text, p_paid_model text, p_paid_modelare text, p_paid_cer_fin text, p_locked boolean
