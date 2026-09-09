-- Flowrise Supabase function: public.next_lab_work_order_id(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.next_lab_work_order_id(p_lab_organization_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_next bigint;
begin
    perform pg_advisory_xact_lock(hashtext('flowrise-work-order-' || p_lab_organization_id::text));

    select coalesce(max(wo.id),0) + 1
      into v_next
    from public.lab_work_orders wo
    where wo.lab_organization_id = p_lab_organization_id;

    return v_next;
end;
$function$
;

-- Security definer: True
-- Return type: bigint
-- Identity arguments: p_lab_organization_id uuid
