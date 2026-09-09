-- Flowrise Supabase function: public.save_my_work_order_case
-- Sourced from SUPABASE V18.12 Technician Case Editing.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.save_my_work_order_case(
    p_lab_organization_id uuid,
    p_work_order_id bigint,
    p_status_model text,
    p_status_modelare text,
    p_status_cer_fin text,
    p_selected_teeth text,
    p_tooth_details_json text,
    p_material text,
    p_shade text,
    p_method text,
    p_clinic_note text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.lab_work_orders%rowtype;
    v_case_id bigint;
begin
    if not public.is_lab_technician(p_lab_organization_id) then
        raise exception 'Technician access denied';
    end if;

    if not public.can_access_work_order(p_lab_organization_id,p_work_order_id) then
        raise exception 'Work Order access denied';
    end if;

    select * into v_order
    from public.lab_work_orders
    where lab_organization_id=p_lab_organization_id
      and id=p_work_order_id
    limit 1;

    if not found then raise exception 'Work Order not found'; end if;
    if v_order.locked then raise exception 'Work Order is locked'; end if;

    -- Each non-null value is checked again by update_my_stage_status().
    -- Any rejected stage rolls back the entire function, including case data.
    if p_status_model is not null then
        perform public.update_my_stage_status(p_lab_organization_id,p_work_order_id,'model',p_status_model);
    end if;
    if p_status_modelare is not null then
        perform public.update_my_stage_status(p_lab_organization_id,p_work_order_id,'modelare',p_status_modelare);
    end if;
    if p_status_cer_fin is not null then
        perform public.update_my_stage_status(p_lab_organization_id,p_work_order_id,'cer_fin',p_status_cer_fin);
    end if;

    select pc.id into v_case_id
    from public.lab_patient_cases pc
    where pc.lab_organization_id=p_lab_organization_id
      and pc.work_order_id=p_work_order_id
    order by pc.id
    limit 1;

    if v_case_id is null then
        v_case_id := p_work_order_id;
        if exists (select 1 from public.lab_patient_cases pc where pc.id=v_case_id) then
            select coalesce(max(pc.id),0)+1 into v_case_id
            from public.lab_patient_cases pc;
        end if;

        insert into public.lab_patient_cases (
            lab_organization_id,id,work_order_id,nume_pacient,nume_partener,
            tip_lucrare,deadline,selected_teeth,tooth_details_json,material,
            shade,method,clinic_note,production_notes,
            created_by_user_id,created_at,updated_by_user_id,updated_at
        ) values (
            p_lab_organization_id,v_case_id,p_work_order_id,v_order.nume_pacient,
            v_order.nume_partener,v_order.tip_lucrare,v_order.deadline,
            p_selected_teeth,p_tooth_details_json,p_material,p_shade,p_method,
            p_clinic_note,null,public.current_legacy_user_id(),now(),
            public.current_legacy_user_id(),now()
        );
    else
        update public.lab_patient_cases
        set nume_pacient=v_order.nume_pacient,
            nume_partener=v_order.nume_partener,
            tip_lucrare=v_order.tip_lucrare,
            deadline=v_order.deadline,
            selected_teeth=p_selected_teeth,
            tooth_details_json=p_tooth_details_json,
            material=p_material,
            shade=p_shade,
            method=p_method,
            clinic_note=p_clinic_note,
            -- Existing production_notes are deliberately preserved.
            updated_by_user_id=public.current_legacy_user_id(),
            updated_at=now()
        where lab_organization_id=p_lab_organization_id and id=v_case_id;
    end if;

    return v_case_id;
end;
$$;

revoke all on function public.save_my_work_order_case(uuid,bigint,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.save_my_work_order_case(uuid,bigint,text,text,text,text,text,text,text,text,text) to authenticated;
