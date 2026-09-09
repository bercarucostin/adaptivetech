-- Flowrise Supabase function: public.upsert_patient_case(p_lab_organization_id uuid, p_work_order_id bigint, p_selected_teeth text, p_tooth_details_json text, p_material text, p_shade text, p_method text, p_clinic_note text, p_production_notes text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.upsert_patient_case(p_lab_organization_id uuid, p_work_order_id bigint, p_selected_teeth text, p_tooth_details_json text, p_material text, p_shade text, p_method text, p_clinic_note text, p_production_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_order public.lab_work_orders%rowtype;
    v_is_management boolean := public.is_lab_management(p_lab_organization_id);
    v_is_doctor boolean := public.is_connected_doctor_for_lab(p_lab_organization_id);
    v_case_id bigint;
begin
    if not (v_is_management or v_is_doctor) then
        raise exception 'Patient case write denied';
    end if;

    select *
      into v_order
    from public.lab_work_orders
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id
    limit 1;

    if not found then
        raise exception 'Work Order not found';
    end if;

    if v_is_doctor then
        if not public.doctor_matches_partner(v_order.nume_partener) then
            raise exception 'Work Order access denied';
        end if;

        if v_order.locked then
            raise exception 'Work Order is locked';
        end if;

        if lower(trim(coalesce(v_order.status,''))) <> 'not started' then
            raise exception 'Doctor can edit the prescription only while Status = Not Started';
        end if;
    end if;

    select pc.id
      into v_case_id
    from public.lab_patient_cases pc
    where pc.lab_organization_id = p_lab_organization_id
      and pc.work_order_id = p_work_order_id
    order by pc.id
    limit 1;

    if v_case_id is null then
        -- Preserve current convention where possible: patient case ID = Work Order ID.
        v_case_id := p_work_order_id;

        if exists (
            select 1
            from public.lab_patient_cases
            where lab_organization_id = p_lab_organization_id
              and id = v_case_id
        ) then
            select coalesce(max(id),0) + 1
              into v_case_id
            from public.lab_patient_cases
            where lab_organization_id = p_lab_organization_id;
        end if;

        insert into public.lab_patient_cases (
            lab_organization_id,
            id,
            work_order_id,
            nume_pacient,
            nume_partener,
            tip_lucrare,
            deadline,
            selected_teeth,
            tooth_details_json,
            material,
            shade,
            method,
            clinic_note,
            production_notes,
            created_by_user_id,
            created_at,
            updated_by_user_id,
            updated_at
        )
        values (
            p_lab_organization_id,
            v_case_id,
            p_work_order_id,
            v_order.nume_pacient,
            v_order.nume_partener,
            v_order.tip_lucrare,
            v_order.deadline,
            p_selected_teeth,
            p_tooth_details_json,
            p_material,
            p_shade,
            p_method,
            p_clinic_note,
            case when v_is_management then p_production_notes else null end,
            public.current_legacy_user_id(),
            now(),
            public.current_legacy_user_id(),
            now()
        );
    else
        update public.lab_patient_cases
        set
            nume_pacient = v_order.nume_pacient,
            nume_partener = v_order.nume_partener,
            tip_lucrare = v_order.tip_lucrare,
            deadline = v_order.deadline,
            selected_teeth = p_selected_teeth,
            tooth_details_json = p_tooth_details_json,
            material = p_material,
            shade = p_shade,
            method = p_method,
            clinic_note = p_clinic_note,
            production_notes = case
                when v_is_management then p_production_notes
                else production_notes
            end,
            updated_by_user_id = public.current_legacy_user_id(),
            updated_at = now()
        where lab_organization_id = p_lab_organization_id
          and id = v_case_id;
    end if;

    return v_case_id;
end;
$function$
;

-- Security definer: True
-- Return type: bigint
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint, p_selected_teeth text, p_tooth_details_json text, p_material text, p_shade text, p_method text, p_clinic_note text, p_production_notes text
