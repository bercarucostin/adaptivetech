-- Flowrise Supabase function: public.get_my_production(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_my_production(p_lab_organization_id uuid)
 RETURNS TABLE(id bigint, deadline date, status text, nume_pacient text, nume_partener text, tip_lucrare text, nr_elemente integer, locked boolean, tehnician_model text, tehnician1_modelare text, tehnician2_cer_fin text, status_model text, status_modelare text, status_cer_fin text)
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
        wo.locked,

        wo.tehnician_model,
        wo.tehnician1_modelare,
        wo.tehnician2_cer_fin,

        wo.status_model,
        wo.status_modelare,
        wo.status_cer_fin
    from public.lab_work_orders wo
    where wo.lab_organization_id = p_lab_organization_id
      and lower(wo.status) in ('not started','started','finished','shipped')
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
    order by wo.deadline nulls last, wo.id desc;
end;
$function$
;

-- Security definer: True
-- Return type: TABLE(id bigint, deadline date, status text, nume_pacient text, nume_partener text, tip_lucrare text, nr_elemente integer, locked boolean, tehnician_model text, tehnician1_modelare text, tehnician2_cer_fin text, status_model text, status_modelare text, status_cer_fin text)
-- Identity arguments: p_lab_organization_id uuid
