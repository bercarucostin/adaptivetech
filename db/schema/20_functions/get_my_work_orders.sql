-- Flowrise Supabase function: public.get_my_work_orders(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_my_work_orders(p_lab_organization_id uuid)
 RETURNS TABLE(id bigint, deadline date, status text, nume_pacient text, nume_partener text, items jsonb, work_types text[], work_type_summary text, element_count numeric, data_receptie timestamp with time zone, locked boolean, tehnician_model text, tehnician1_modelare text, tehnician2_cer_fin text, status_model text, status_modelare text, status_cer_fin text, contract text, discount numeric, paid_model text, paid_modelare text, paid_cer_fin text, created_by_user_id text, created_at timestamp with time zone, updated_by_user_id text, updated_at timestamp with time zone, list_price numeric, final_price numeric, cost_model numeric, cost_modelare numeric, cost_cer_fin numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_is_management boolean := public.is_lab_management(p_lab_organization_id);
    v_is_dashboard boolean := public.is_lab_dashboard(p_lab_organization_id);
    v_is_technician boolean := public.is_lab_technician(p_lab_organization_id);
    v_is_doctor boolean := public.is_connected_doctor_for_lab(p_lab_organization_id);
begin
    if not (v_is_management or v_is_dashboard or v_is_technician or v_is_doctor) then
        raise exception 'Access denied';
    end if;

    return query
    select
        wo.id,
        wo.deadline,
        wo.status,
        wo.nume_pacient,
        wo.nume_partener,
        scope.items,scope.work_types,scope.work_type_summary,scope.element_count,
        wo.data_receptie,
        wo.locked,

        case when v_is_management or v_is_dashboard or v_is_technician
             then wo.tehnician_model else null end,
        case when v_is_management or v_is_dashboard or v_is_technician
             then wo.tehnician1_modelare else null end,
        case when v_is_management or v_is_dashboard or v_is_technician
             then wo.tehnician2_cer_fin else null end,

        wo.status_model,
        wo.status_modelare,
        wo.status_cer_fin,

        case when v_is_management then wo.contract else null end,
        case when v_is_management then wo.discount else null end,

        case when v_is_management then public.work_order_stage_payment_status(wo.lab_organization_id,wo.id,'model') else null end,
        case when v_is_management then public.work_order_stage_payment_status(wo.lab_organization_id,wo.id,'modelare') else null end,
        case when v_is_management then public.work_order_stage_payment_status(wo.lab_organization_id,wo.id,'cer_fin') else null end,

        case when v_is_management then wo.created_by_user_id else null end,
        wo.created_at,
        case when v_is_management then wo.updated_by_user_id else null end,
        wo.updated_at,

        case when v_is_management or v_is_doctor
             then wo.snapshot_list_price
             else null end,
        case when v_is_management or v_is_doctor
             then wo.snapshot_final_price
             else null end,
        case when v_is_management then costs.cost_model else null end,
        case when v_is_management then costs.cost_modelare else null end,
        case when v_is_management then costs.cost_cer_fin else null end
    from public.lab_work_orders wo
    cross join lateral public.work_order_item_scope(wo.lab_organization_id,wo.id,v_is_management or v_is_doctor) scope
    cross join lateral (
        select
            case when bool_and(amount is not null) filter(where stage_key='model') then sum(amount) filter(where stage_key='model') end as cost_model,
            case when bool_and(amount is not null) filter(where stage_key='modelare') then sum(amount) filter(where stage_key='modelare') end as cost_modelare,
            case when bool_and(amount is not null) filter(where stage_key='cer_fin') then sum(amount) filter(where stage_key='cer_fin') end as cost_cer_fin
        from (select a.stage_key,public.assignment_agreed_amount(a.id) amount
            from public.lab_work_order_stage_assignments a
            where a.lab_organization_id=wo.lab_organization_id and a.work_order_id=wo.id) assignments
    ) costs
    where wo.lab_organization_id = p_lab_organization_id
      and wo.archived_at is null
      and (
          v_is_management
          or v_is_dashboard
          or (
              v_is_technician
              and lower(trim(coalesce(public.current_technician_name(),''))) in (
                  lower(trim(coalesce(wo.tehnician_model,''))),
                  lower(trim(coalesce(wo.tehnician1_modelare,''))),
                  lower(trim(coalesce(wo.tehnician2_cer_fin,'')))
              )
          )
          or (
              v_is_doctor
              and public.doctor_matches_partner(wo.nume_partener)
          )
      )
    order by wo.id desc;
end;
$function$
;
