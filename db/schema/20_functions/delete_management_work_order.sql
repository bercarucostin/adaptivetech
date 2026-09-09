-- Flowrise Supabase function: public.delete_management_work_order(p_lab_organization_id uuid, p_work_order_id bigint)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.delete_management_work_order(p_lab_organization_id uuid, p_work_order_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if not public.is_lab_management(p_lab_organization_id) then
        raise exception 'Management access denied';
    end if;

    if exists (
        select 1
        from public.work_order_files f
        where f.legacy_work_order_id = p_work_order_id
    ) then
        raise exception 'Delete Work Order files first';
    end if;

    delete from public.lab_patient_cases
    where lab_organization_id = p_lab_organization_id
      and work_order_id = p_work_order_id;

    delete from public.lab_work_orders
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
-- Identity arguments: p_lab_organization_id uuid, p_work_order_id bigint
