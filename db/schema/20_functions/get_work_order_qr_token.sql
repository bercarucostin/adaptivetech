-- QR identifiers are permanent references, not bearer access credentials.
CREATE OR REPLACE FUNCTION public.get_work_order_qr_token(p_lab_organization_id uuid,p_work_order_id bigint)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE token uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.can_access_work_order(p_lab_organization_id,p_work_order_id),false) THEN
  RAISE EXCEPTION 'Lucrarea nu este disponibilă sau nu ai acces.';
 END IF;
 SELECT qr_token INTO token FROM public.lab_work_orders
 WHERE lab_organization_id=p_lab_organization_id AND id=p_work_order_id AND archived_at IS NULL;
 IF token IS NULL THEN RAISE EXCEPTION 'Lucrarea nu este disponibilă sau nu ai acces.'; END IF;
 RETURN token;
END;
$$;
REVOKE ALL ON FUNCTION public.get_work_order_qr_token(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_work_order_qr_token(uuid,bigint) TO authenticated;
