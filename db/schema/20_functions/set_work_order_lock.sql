-- Flowrise Supabase function: public.set_work_order_lock(p_lab_organization_id uuid, p_work_order_id bigint, p_locked boolean)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.set_work_order_lock(p_lab_organization_id uuid, p_work_order_id bigint, p_locked boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    update public.lab_work_orders
    set locked = coalesce(p_locked,false),
        updated_by_user_id = public.current_legacy_user_id(),
        updated_at = now()
    where lab_organization_id = p_lab_organization_id
      and id = p_work_order_id;

    if not found then
        raise exception 'Work Order not found';
    end if;

    return true;
end;
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint, p_locked boolean
