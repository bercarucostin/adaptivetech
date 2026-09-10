DROP POLICY IF EXISTS "ai_previews_own_read" ON public.ai_operation_previews;
CREATE POLICY "ai_previews_own_read" ON public.ai_operation_previews
FOR SELECT TO authenticated
USING (requested_by_user_id=auth.uid() AND public.is_lab_management(lab_organization_id));
