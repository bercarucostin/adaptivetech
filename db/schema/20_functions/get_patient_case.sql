-- Flowrise Supabase function: public.get_patient_case(p_lab_organization_id uuid, p_work_order_id bigint)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_patient_case(p_lab_organization_id uuid, p_work_order_id bigint)
 RETURNS TABLE(id bigint, work_order_id bigint, nume_pacient text, nume_partener text, tip_lucrare text, deadline date, selected_teeth text, tooth_details_json text, material text, shade text, method text, clinic_note text, production_notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_is_management boolean := public.is_lab_management(p_lab_organization_id);
    v_is_doctor boolean := public.is_connected_doctor_for_lab(p_lab_organization_id);
    v_is_technician boolean := public.is_lab_technician(p_lab_organization_id);
begin
    if not public.can_access_work_order(p_lab_organization_id,p_work_order_id) then
        raise exception 'Access denied';
    end if;

    if not (v_is_management or v_is_doctor or v_is_technician) then
        raise exception 'Patient case access denied for this role';
    end if;

    return query
    select
        pc.id,
        pc.work_order_id,
        pc.nume_pacient,
        pc.nume_partener,
        pc.tip_lucrare,
        pc.deadline,
        pc.selected_teeth,
        pc.tooth_details_json,
        pc.material,
        pc.shade,
        pc.method,
        pc.clinic_note,
        case when v_is_management then pc.production_notes else null end,
        pc.created_at,
        pc.updated_at
    from public.lab_patient_cases pc
    where pc.lab_organization_id = p_lab_organization_id
      and pc.work_order_id = p_work_order_id
    order by pc.id
    limit 1;
end;
$function$
;

-- Security definer: True
-- Return type: TABLE(id bigint, work_order_id bigint, nume_pacient text, nume_partener text, tip_lucrare text, deadline date, selected_teeth text, tooth_details_json text, material text, shade text, method text, clinic_note text, production_notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint
