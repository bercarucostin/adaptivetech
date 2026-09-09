-- Flowrise Supabase function: public.get_my_work_orders(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_my_work_orders(p_lab_organization_id uuid)
 RETURNS TABLE(id bigint, deadline date, status text, nume_pacient text, nume_partener text, tip_lucrare text, nr_elemente integer, data_receptie timestamp with time zone, locked boolean, tehnician_model text, tehnician1_modelare text, tehnician2_cer_fin text, status_model text, status_modelare text, status_cer_fin text, contract text, discount numeric, paid_model text, paid_modelare text, paid_cer_fin text, created_by_user_id text, created_at timestamp with time zone, updated_by_user_id text, updated_at timestamp with time zone, unit_price numeric, list_price numeric, final_price numeric)
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
        wo.tip_lucrare,
        wo.nr_elemente,
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

        case when v_is_management then wo.paid_model else null end,
        case when v_is_management then wo.paid_modelare else null end,
        case when v_is_management then wo.paid_cer_fin else null end,

        case when v_is_management then wo.created_by_user_id else null end,
        wo.created_at,
        case when v_is_management then wo.updated_by_user_id else null end,
        wo.updated_at,

        case when v_is_management or v_is_doctor then pr.pret else null end,
        case when v_is_management or v_is_doctor
             then coalesce(pr.pret,0) * coalesce(wo.nr_elemente,0)
             else null end,
        case when v_is_management or v_is_doctor
             then coalesce(pr.pret,0) * coalesce(wo.nr_elemente,0)
                  * (1 - coalesce(wo.discount,0) / 100.0)
             else null end
    from public.lab_work_orders wo
    left join lateral (
        select cp.pret
        from public.lab_contract_work_prices cp
        where cp.lab_organization_id = wo.lab_organization_id
          and cp.contract = wo.contract
          and cp.tip_lucrare = wo.tip_lucrare
        order by cp.id
        limit 1
    ) pr on true
    where wo.lab_organization_id = p_lab_organization_id
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

-- Security definer: True
-- Return type: TABLE(id bigint, deadline date, status text, nume_pacient text, nume_partener text, tip_lucrare text, nr_elemente integer, data_receptie timestamp with time zone, locked boolean, tehnician_model text, tehnician1_modelare text, tehnician2_cer_fin text, status_model text, status_modelare text, status_cer_fin text, contract text, discount numeric, paid_model text, paid_modelare text, paid_cer_fin text, created_by_user_id text, created_at timestamp with time zone, updated_by_user_id text, updated_at timestamp with time zone, unit_price numeric, list_price numeric, final_price numeric)
-- Identity arguments: p_lab_organization_id uuid
