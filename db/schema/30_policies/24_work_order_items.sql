DROP POLICY IF EXISTS "lab_work_order_items_read" ON public.lab_work_order_items;
CREATE POLICY "lab_work_order_items_read" ON public.lab_work_order_items
FOR SELECT TO authenticated
USING (public.can_access_work_order(lab_organization_id, work_order_id));

DROP POLICY IF EXISTS "lab_work_order_items_write" ON public.lab_work_order_items;
CREATE POLICY "lab_work_order_items_write" ON public.lab_work_order_items
FOR ALL TO authenticated
USING (public.is_lab_management(lab_organization_id))
WITH CHECK (public.is_lab_management(lab_organization_id));
