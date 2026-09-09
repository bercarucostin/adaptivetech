-- Flowrise Supabase function: public.set_stage_payment_status(p_lab_organization_id uuid, p_work_order_id bigint, p_stage text, p_paid_status text)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.set_stage_payment_status(p_lab_organization_id uuid, p_work_order_id bigint, p_stage text, p_paid_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_stage text := lower(trim(coalesce(p_stage,'')));
    v_paid text := trim(coalesce(p_paid_status,''));
begin
    if not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    if v_stage not in ('model','modelare','cer_fin') then
        raise exception 'Invalid stage';
    end if;

    if v_paid = '' then
        raise exception 'Payment status is required';
    end if;

    if v_stage = 'model' then
        update public.lab_work_orders
        set paid_model = v_paid,
            updated_by_user_id = public.current_legacy_user_id(),
            updated_at = now()
        where lab_organization_id = p_lab_organization_id
          and id = p_work_order_id;

    elsif v_stage = 'modelare' then
        update public.lab_work_orders
        set paid_modelare = v_paid,
            updated_by_user_id = public.current_legacy_user_id(),
            updated_at = now()
        where lab_organization_id = p_lab_organization_id
          and id = p_work_order_id;

    else
        update public.lab_work_orders
        set paid_cer_fin = v_paid,
            updated_by_user_id = public.current_legacy_user_id(),
            updated_at = now()
        where lab_organization_id = p_lab_organization_id
          and id = p_work_order_id;
    end if;

    if not found then
        raise exception 'Work Order not found';
    end if;

    return true;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint, p_stage text, p_paid_status text
