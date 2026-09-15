CREATE OR REPLACE FUNCTION public.work_order_billing_scope(p_lab uuid,p_order bigint)
RETURNS TABLE(work_type text,billing_mode text,quantity numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public
AS $$
    SELECT min(trim(line.work_type)),line.billing_mode,sum(line.quantity)::numeric
    FROM public.lab_work_order_price_lines line
    WHERE line.lab_organization_id=p_lab AND line.work_order_id=p_order
    GROUP BY lower(trim(line.work_type)),line.billing_mode
    ORDER BY min(trim(line.work_type)),line.billing_mode
$$;

REVOKE ALL ON FUNCTION public.work_order_billing_scope(uuid,bigint) FROM public,anon,authenticated;
