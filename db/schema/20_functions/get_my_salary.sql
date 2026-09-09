-- Flowrise Supabase function: public.get_my_salary
-- Sourced from SUPABASE-V18.10-Technician-Salary.sql.
-- Includes the complete function definition and available ACL statements.

create or replace function public.get_my_salary(p_lab_organization_id uuid)
returns table (
  work_order_id bigint,
  stage_key text,
  stage_label text,
  stage_status text,
  payment_status text,
  unit_cost numeric,
  amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_technician text := trim(coalesce(public.current_technician_name(),''));
begin
  if not public.is_lab_technician(p_lab_organization_id) then
    raise exception 'Technician access denied';
  end if;

  if v_technician = '' then
    raise exception 'Technician profile mapping is missing';
  end if;

  return query
  with assigned_stages as (
    select
      wo.id,
      wo.tip_lucrare,
      wo.nr_elemente,
      stage.stage_key,
      stage.stage_label,
      stage.technician_name,
      stage.stage_status,
      stage.payment_status,
      stage.not_applicable
    from public.lab_work_orders wo
    cross join lateral (
      values
        ('Model'::text,   'Model'::text,     wo.tehnician_model,      coalesce(wo.status_model,'Not Started'),    coalesce(wo.paid_model,'Not Paid'),    coalesce(wo.model_not_applicable,false)),
        ('Modelare'::text,'Modelare'::text,  wo.tehnician1_modelare,  coalesce(wo.status_modelare,'Not Started'), coalesce(wo.paid_modelare,'Not Paid'), coalesce(wo.modelare_not_applicable,false)),
        ('Cer_Fin'::text, 'Cer / Fin'::text, wo.tehnician2_cer_fin,   coalesce(wo.status_cer_fin,'Not Started'),  coalesce(wo.paid_cer_fin,'Not Paid'),  coalesce(wo.cer_fin_not_applicable,false))
    ) as stage(stage_key,stage_label,technician_name,stage_status,payment_status,not_applicable)
    where wo.lab_organization_id = p_lab_organization_id
      and stage.not_applicable = false
      and lower(trim(coalesce(stage.technician_name,''))) = lower(v_technician)
  )
  select
    a.id,
    a.stage_key,
    a.stage_label,
    a.stage_status,
    a.payment_status,
    coalesce(cost_rule.cost,0)::numeric,
    (coalesce(cost_rule.cost,0) * coalesce(a.nr_elemente,0))::numeric
  from assigned_stages a
  left join lateral (
    select tc.cost
    from public.lab_technician_costs tc
    where tc.lab_organization_id = p_lab_organization_id
      and lower(trim(tc.tehnician)) = lower(v_technician)
      and lower(trim(tc.tip_lucrare)) = lower(trim(coalesce(a.tip_lucrare,'')))
      and (
        (a.stage_key = 'Model' and lower(trim(tc.etapa)) = 'model')
        or (a.stage_key = 'Modelare' and lower(trim(tc.etapa)) = 'modelare')
        or (
          a.stage_key = 'Cer_Fin'
          and regexp_replace(lower(coalesce(tc.etapa,'')),'[^a-z0-9]','','g')
              in ('cerfin','ceramicafinisare','ceramicfinisare')
        )
      )
    order by tc.source_row_no
    limit 1
  ) cost_rule on true
  order by a.id desc,
    case a.stage_key when 'Model' then 1 when 'Modelare' then 2 else 3 end;
end;
$$;

revoke all on function public.get_my_salary(uuid) from public;
grant execute on function public.get_my_salary(uuid) to authenticated;
