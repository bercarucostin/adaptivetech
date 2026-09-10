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

DROP POLICY IF EXISTS "assignment_cost_lines_visible_assignment" ON public.lab_work_order_assignment_cost_lines;
CREATE POLICY "assignment_cost_lines_visible_assignment" ON public.lab_work_order_assignment_cost_lines
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.lab_work_order_stage_assignments a
        WHERE a.id = assignment_id
          AND (
              public.is_lab_management(a.lab_organization_id)
              OR (
                  public.is_lab_technician(a.lab_organization_id)
                  AND (
                      a.technician_user_id = auth.uid()
                      OR (a.technician_user_id IS NULL AND lower(trim(a.technician_name)) = lower(trim(coalesce(public.current_technician_name(), ''))))
                  )
              )
          )
    )
);
