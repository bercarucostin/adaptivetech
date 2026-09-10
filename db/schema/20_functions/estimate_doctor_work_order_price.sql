CREATE OR REPLACE FUNCTION public.estimate_doctor_work_order_price(p_lab_organization_id uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF NOT public.is_connected_doctor_for_lab(p_lab_organization_id) THEN RAISE EXCEPTION 'Doctor price estimate access denied'; END IF;
    RETURN public.estimate_work_order_items(p_lab_organization_id,public.current_partner_name(),'General',p_items,0);
END; $$;
REVOKE ALL ON FUNCTION public.estimate_doctor_work_order_price(uuid,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.estimate_doctor_work_order_price(uuid,jsonb) TO authenticated;
