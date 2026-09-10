DROP POLICY IF EXISTS "ai_requests_own_read" ON public.ai_operation_requests;
CREATE POLICY "ai_requests_own_read" ON public.ai_operation_requests
FOR SELECT TO authenticated
USING (requested_by_user_id=auth.uid() AND public.effective_lab_role(lab_organization_id) IN ('admin','manager','technician'));
