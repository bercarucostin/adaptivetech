-- Flowrise Supabase function: public.update_my_stage_status(p_lab_organization_id uuid, p_work_order_id bigint, p_stage text, p_status text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.update_my_stage_status(p_lab_organization_id uuid, p_work_order_id bigint, p_stage text, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_tech text;
    v_stage text := lower(trim(coalesce(p_stage,'')));
    v_status text := trim(coalesce(p_status,''));
    v_order public.lab_work_orders%rowtype;
begin
    if not public.is_lab_technician(p_lab_organization_id) then
        raise exception 'Technician access denied';
    end if;

    if v_stage not in ('model','modelare','cer_fin') then
        raise exception 'Invalid stage';
    end if;

    if lower(v_status) not in ('not started','started','finished') then
        raise exception 'Invalid stage status';
    end if;

    v_tech := lower(trim(coalesce(public.current_technician_name(),'')));
    if v_tech = '' then
        raise exception 'Technician profile mapping is missing';
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

    if v_stage = 'model' then
        if lower(trim(coalesce(v_order.tehnician_model,''))) <> v_tech then
            raise exception 'Technician is not assigned to Model';
        end if;

        update public.lab_work_orders
        set status_model = v_status,
            updated_by_user_id = public.current_legacy_user_id(),
            updated_at = now()
        where lab_organization_id = p_lab_organization_id
          and id = p_work_order_id;

    elsif v_stage = 'modelare' then
        if lower(trim(coalesce(v_order.tehnician1_modelare,''))) <> v_tech then
            raise exception 'Technician is not assigned to Modelare';
        end if;

        update public.lab_work_orders
        set status_modelare = v_status,
            updated_by_user_id = public.current_legacy_user_id(),
            updated_at = now()
        where lab_organization_id = p_lab_organization_id
          and id = p_work_order_id;

    else
        if lower(trim(coalesce(v_order.tehnician2_cer_fin,''))) <> v_tech then
            raise exception 'Technician is not assigned to Ceramica/Finisare';
        end if;

        update public.lab_work_orders
        set status_cer_fin = v_status,
            updated_by_user_id = public.current_legacy_user_id(),
            updated_at = now()
        where lab_organization_id = p_lab_organization_id
          and id = p_work_order_id;
    end if;

    return true;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint, p_stage text, p_status text
