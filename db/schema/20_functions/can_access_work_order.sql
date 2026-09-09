-- Flowrise Supabase function: public.can_access_work_order(p_lab_organization_id uuid, p_work_order_id bigint)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.can_access_work_order(p_lab_organization_id uuid, p_work_order_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_order public.lab_work_orders%rowtype;
    v_technician text;
begin
    select *
      into v_order
    from public.lab_work_orders
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id
    limit 1;

    if not found then
        return false;
    end if;

    if public.is_lab_management(p_lab_organization_id)
       or public.is_lab_dashboard(p_lab_organization_id) then
        return true;
    end if;

    if public.is_lab_technician(p_lab_organization_id) then
        v_technician := lower(trim(coalesce(public.current_technician_name(),'')));

        return v_technician <> ''
           and v_technician in (
               lower(trim(coalesce(v_order.tehnician_model,''))),
               lower(trim(coalesce(v_order.tehnician1_modelare,''))),
               lower(trim(coalesce(v_order.tehnician2_cer_fin,'')))
           );
    end if;

    if public.is_connected_doctor_for_lab(p_lab_organization_id) then
        return public.doctor_matches_partner(v_order.nume_partener);
    end if;

    return false;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint
