DROP POLICY IF EXISTS "lab_work_order_price_lines_read" ON public.lab_work_order_price_lines;
CREATE POLICY "lab_work_order_price_lines_read" ON public.lab_work_order_price_lines
FOR SELECT TO authenticated
USING (public.is_lab_management(lab_organization_id)
    OR (public.is_connected_doctor_for_lab(lab_organization_id)
        AND public.can_access_work_order(lab_organization_id,work_order_id)));

DROP POLICY IF EXISTS "lab_work_order_price_lines_commercial_read" ON public.lab_work_order_price_lines;
CREATE POLICY "lab_work_order_price_lines_commercial_read" ON public.lab_work_order_price_lines
AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.is_lab_management(lab_organization_id)
    OR (public.is_connected_doctor_for_lab(lab_organization_id)
        AND public.can_access_work_order(lab_organization_id,work_order_id)));
