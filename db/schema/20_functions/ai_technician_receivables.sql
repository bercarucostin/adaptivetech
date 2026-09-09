-- Flowrise Supabase function: public.ai_technician_receivables()
-- Added by the Technician AI RPC repair migration.
-- The function is technician-only and returns only row-scoped data.

create or replace function public.ai_technician_receivables()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_technician text := lower(trim(coalesce(public.current_technician_name(),'')));
    v_result jsonb;
begin
    if public.effective_lab_role(v_lab) <> 'technician' then
        raise exception 'Technician access required';
    end if;

    if v_technician = '' then
        raise exception 'Technician profile mapping is missing';
    end if;

    with assigned as (
        select
            wo.id as work_order_id,
            wo.nume_pacient,
            wo.nume_partener,
            wo.tip_lucrare,
            s.stage_key,
            s.stage_label,
            s.stage_status,
            s.payment_status,
            coalesce(wo.nr_elemente,0) as nr_elemente,
            coalesce(cost_rule.cost,0)::numeric as unit_cost
        from public.lab_work_orders wo
        cross join lateral (
            values
                ('Model'::text,'Model'::text,wo.tehnician_model,coalesce(wo.status_model,'Not Started'),coalesce(wo.paid_model,'Not Paid'),coalesce((to_jsonb(wo)->>'model_not_applicable')::boolean,false)),
                ('Modelare'::text,'Modelare'::text,wo.tehnician1_modelare,coalesce(wo.status_modelare,'Not Started'),coalesce(wo.paid_modelare,'Not Paid'),coalesce((to_jsonb(wo)->>'modelare_not_applicable')::boolean,false)),
                ('Cer_Fin'::text,'Cer / Fin'::text,wo.tehnician2_cer_fin,coalesce(wo.status_cer_fin,'Not Started'),coalesce(wo.paid_cer_fin,'Not Paid'),coalesce((to_jsonb(wo)->>'cer_fin_not_applicable')::boolean,false))
        ) as s(stage_key,stage_label,technician_name,stage_status,payment_status,not_applicable)
        left join lateral (
            select tc.cost
            from public.lab_technician_costs tc
            where tc.lab_organization_id = wo.lab_organization_id
              and lower(trim(coalesce(tc.tehnician,''))) = v_technician
              and lower(trim(coalesce(tc.tip_lucrare,''))) = lower(trim(coalesce(wo.tip_lucrare,'')))
              and (
                    (s.stage_key = 'Model' and lower(trim(coalesce(tc.etapa,''))) = 'model')
                 or (s.stage_key = 'Modelare' and lower(trim(coalesce(tc.etapa,''))) = 'modelare')
                 or (s.stage_key = 'Cer_Fin' and regexp_replace(lower(coalesce(tc.etapa,'')),'[^a-z0-9]','','g') in ('cerfin','ceramicafinisare','ceramicfinisare'))
              )
            order by tc.source_row_no
            limit 1
        ) cost_rule on true
        where wo.lab_organization_id = v_lab
          and s.not_applicable = false
          and lower(trim(coalesce(s.technician_name,''))) = v_technician
    ), totals as (
        select
            count(*)::bigint as stage_count,
            coalesce(sum(unit_cost * nr_elemente),0)::numeric as accrued,
            coalesce(sum(case when lower(trim(payment_status)) = 'paid' then unit_cost * nr_elemente else 0 end),0)::numeric as paid
        from assigned
    ), breakdown as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'Work_Order_ID', work_order_id,
                    'Nume_Pacient', nume_pacient,
                    'Nume_Partener', nume_partener,
                    'Tip_Lucrare', tip_lucrare,
                    'Stage', stage_key,
                    'Stage_Label', stage_label,
                    'Stage_Status', stage_status,
                    'Payment_Status', payment_status,
                    'Unit_Cost', unit_cost,
                    'Amount', unit_cost * nr_elemente
                )
                order by work_order_id desc,stage_key
            ),
            '[]'::jsonb
        ) as rows
        from assigned
    ), by_partner as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'Nume_Partener', partner_name,
                    'Stage_Count', stage_count,
                    'Total_Accrued', accrued,
                    'Total_Paid', paid,
                    'Total_Outstanding', accrued - paid
                )
                order by accrued desc, partner_name
            ),
            '[]'::jsonb
        ) as rows
        from (
            select
                coalesce(nullif(trim(nume_partener),''),'Partener nespecificat') as partner_name,
                count(*)::bigint as stage_count,
                coalesce(sum(unit_cost * nr_elemente),0)::numeric as accrued,
                coalesce(sum(
                    case when lower(trim(payment_status)) = 'paid'
                         then unit_cost * nr_elemente else 0 end
                ),0)::numeric as paid
            from assigned
            group by coalesce(nullif(trim(nume_partener),''),'Partener nespecificat')
        ) partner_totals
    )
    select jsonb_build_object(
        'Technician', public.current_technician_name(),
        'Currency', 'RON',
        'Stage_Count', t.stage_count,
        'Total_Accrued', t.accrued,
        'Total_Paid', t.paid,
        'Total_Outstanding', (t.accrued - t.paid)::numeric,
        'By_Partner', p.rows,
        'Breakdown', b.rows
    )
    into v_result
    from totals t cross join breakdown b cross join by_partner p;

    return v_result;
end;
$$;

revoke all on function public.ai_technician_receivables() from public;
grant execute on function public.ai_technician_receivables() to authenticated;
