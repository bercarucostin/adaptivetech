CREATE OR REPLACE FUNCTION public.resolve_work_order_qr(p_lab_organization_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE wo record; page jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT lab_organization_id,id INTO wo FROM public.lab_work_orders WHERE lab_organization_id=p_lab_organization_id AND qr_token=p_token AND archived_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT coalesce(public.can_access_work_order(wo.lab_organization_id,wo.id),false) THEN RETURN NULL; END IF;
 -- Reuse the bounded read's role-specific financial/assignment masks.
 page:=public.get_work_orders_page(wo.lab_organization_id,jsonb_build_object(
   'work_order_id',wo.id,'reception_from',NULL,'reception_to',NULL,'hide_old',false
 ),1,0);
 RETURN page->'rows'->0;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_work_order_qr(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_work_order_qr(uuid,uuid) TO authenticated;
