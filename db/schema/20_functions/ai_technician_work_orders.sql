-- Flowrise Supabase function: public.ai_technician_work_orders()
-- Added by the Technician AI RPC repair migration.
-- The function is technician-only and returns only row-scoped data.

create or replace function public.ai_technician_work_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_technician text := lower(trim(coalesce(public.current_technician_name(),'')));
    v_rows jsonb := '[]'::jsonb;
begin
    if public.effective_lab_role(v_lab) <> 'technician' then
        raise exception 'Technician access required';
    end if;

    if v_technician = '' then
        raise exception 'Technician profile mapping is missing';
    end if;

    with assigned as (
        select
            wo.id,
            wo.deadline,
            wo.data_receptie,
            wo.nume_pacient,
            wo.nume_partener,
            scope.items,scope.work_types,scope.work_type_summary,scope.element_count,
            wo.status,
            coalesce(wo.locked,false) as locked,
            s.stage_key,
            s.stage_label,
            s.stage_order,
            s.stage_status,
            s.payment_status,
            s.not_applicable,
            cost_rule.unit_cost,
            cost_rule.agreed_amount,
            coalesce(case_row.case_data,'{}'::jsonb) as case_data
        from public.lab_work_orders wo
        cross join lateral public.work_order_item_scope(wo.lab_organization_id,wo.id,false) scope
        cross join lateral (
            values
                (
                    'Model'::text,
                    'Model'::text,
                    1,
                    wo.tehnician_model,
                    coalesce(wo.status_model,'Not Started'),
                    coalesce(wo.paid_model,'Not Paid'),
                    coalesce((to_jsonb(wo)->>'model_not_applicable')::boolean,false)
                ),
                (
                    'Modelare'::text,
                    'Modelare'::text,
                    2,
                    wo.tehnician1_modelare,
                    coalesce(wo.status_modelare,'Not Started'),
                    coalesce(wo.paid_modelare,'Not Paid'),
                    coalesce((to_jsonb(wo)->>'modelare_not_applicable')::boolean,false)
                ),
                (
                    'Cer_Fin'::text,
                    'Cer / Fin'::text,
                    3,
                    wo.tehnician2_cer_fin,
                    coalesce(wo.status_cer_fin,'Not Started'),
                    coalesce(wo.paid_cer_fin,'Not Paid'),
                    coalesce((to_jsonb(wo)->>'cer_fin_not_applicable')::boolean,false)
                )
        ) as s(stage_key,stage_label,stage_order,technician_name,stage_status,payment_status,not_applicable)
        left join lateral (
            select a.unit_cost,public.assignment_agreed_amount(a.id) as agreed_amount
            from public.lab_work_order_stage_assignments a
            where a.lab_organization_id=wo.lab_organization_id
              and a.work_order_id=wo.id
              and a.stage_key=lower(s.stage_key)
              and a.ended_at is null
              and (a.technician_user_id=auth.uid() or (
                  a.technician_user_id is null and lower(trim(a.technician_name))=v_technician
              ))
            order by a.started_at desc
            limit 1
        ) cost_rule on true
        left join lateral (
            select jsonb_build_object(
                'Selected_Teeth', pc.selected_teeth,
                'Tooth_Details', pc.tooth_details_json,
                'Shade', pc.shade,
                'Method', pc.method,
                'Clinic_Note', pc.clinic_note
            ) as case_data
            from public.lab_patient_cases pc
            where pc.lab_organization_id = wo.lab_organization_id
              and pc.work_order_id = wo.id
            order by pc.id desc
            limit 1
        ) case_row on true
        where wo.lab_organization_id = v_lab
          and wo.archived_at is null
          and s.not_applicable = false
          and lower(trim(coalesce(s.technician_name,''))) = v_technician
    ), order_rows as (
        select
            a.id,
            a.deadline,
            a.data_receptie,
            a.nume_pacient,
            a.nume_partener,
            a.items,a.work_types,a.work_type_summary,a.element_count,
            a.status,
            a.locked,
            a.case_data,
            jsonb_agg(
                jsonb_build_object(
                    'Stage', a.stage_key,
                    'Stage_Label', a.stage_label,
                    'Status', a.stage_status,
                    'Payment_Status', a.payment_status,
                    'Unit_Cost', a.unit_cost,
                    'Amount', a.agreed_amount
                )
                order by a.stage_order
            ) as my_stages,
            coalesce(sum(a.agreed_amount),0)::numeric as own_technician_cost
        from assigned a
        group by a.id,a.deadline,a.data_receptie,a.nume_pacient,a.nume_partener,
                 a.items,a.work_types,a.work_type_summary,a.element_count,a.status,a.locked,a.case_data
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'ID', o.id,
                'Deadline', o.deadline,
                'Data_Receptie', o.data_receptie,
                'Status', o.status,
                'Nume_Pacient', o.nume_pacient,
                'Nume_Partener', o.nume_partener,
                'items',o.items,'work_types',o.work_types,'work_type_summary',o.work_type_summary,'element_count',o.element_count,
                'Locked', o.locked,
                'Dental_Case', o.case_data,
                'My_Stages', o.my_stages,
                'Own_Technician_Cost', o.own_technician_cost
            )
            order by o.deadline nulls last,o.id desc
        ),
        '[]'::jsonb
    )
    into v_rows
    from order_rows o;

    return v_rows;
end;
$$;

revoke all on function public.ai_technician_work_orders() from public;
grant execute on function public.ai_technician_work_orders() to authenticated;
