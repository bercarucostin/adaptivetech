CREATE OR REPLACE FUNCTION public.update_doctor_work_order(p_lab_organization_id uuid, p_work_order_id bigint, p_deadline date, p_nume_pacient text, p_items jsonb, p_case jsonb DEFAULT '{}'::jsonb)
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

    update public.lab_work_orders
    set
        deadline = p_deadline,
        nume_pacient = trim(p_nume_pacient),
        updated_by_user_id = public.current_legacy_user_id(),
        updated_at = now()
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id;

    perform public.replace_work_order_items(p_lab_organization_id,p_work_order_id,p_items,'General');
    perform public.save_work_order_clinical_case(p_lab_organization_id,p_work_order_id,p_case);
    return true;
end;
$function$
;
