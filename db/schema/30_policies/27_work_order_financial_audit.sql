DROP POLICY IF EXISTS "financial_audit_management_read" ON public.work_order_financial_audit;
CREATE POLICY "financial_audit_management_read" ON public.work_order_financial_audit
FOR SELECT TO authenticated
USING (public.is_lab_management(lab_organization_id));
