DROP POLICY IF EXISTS "lab_work_order_items_read" ON public.lab_work_order_items;
CREATE POLICY "lab_work_order_items_read" ON public.lab_work_order_items
FOR SELECT TO authenticated
USING (public.is_lab_management(lab_organization_id)
    OR (public.is_connected_doctor_for_lab(lab_organization_id)
        AND public.can_access_work_order(lab_organization_id,work_order_id)));

DROP POLICY IF EXISTS "lab_work_order_items_write" ON public.lab_work_order_items;
-- All item writes flow through replace_work_order_items(), which resolves and
-- freezes prices and records the corresponding financial audit entry.

-- Restrictive policy also blocks commercial reads if a deployed permissive policy
-- still exists. Technicians and dashboards use the scrubbed SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "lab_work_order_items_commercial_read" ON public.lab_work_order_items;
CREATE POLICY "lab_work_order_items_commercial_read" ON public.lab_work_order_items
AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.is_lab_management(lab_organization_id)
    OR (public.is_connected_doctor_for_lab(lab_organization_id)
        AND public.can_access_work_order(lab_organization_id,work_order_id)));
