DROP POLICY IF EXISTS "stage_assignments_management_read" ON public.lab_work_order_stage_assignments;
CREATE POLICY "stage_assignments_management_read" ON public.lab_work_order_stage_assignments
FOR SELECT TO authenticated
USING (public.is_lab_management(lab_organization_id));

DROP POLICY IF EXISTS "stage_assignments_technician_read" ON public.lab_work_order_stage_assignments;
CREATE POLICY "stage_assignments_technician_read" ON public.lab_work_order_stage_assignments
FOR SELECT TO authenticated
USING (
    public.is_lab_technician(lab_organization_id)
    AND (
        technician_user_id = auth.uid()
        OR (
            technician_user_id IS NULL
            AND lower(trim(technician_name)) = lower(trim(coalesce(public.current_technician_name(), '')))
        )
    )
);
