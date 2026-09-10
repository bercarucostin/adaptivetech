DROP POLICY IF EXISTS "technician_payments_management_read" ON public.technician_payments;
CREATE POLICY "technician_payments_management_read" ON public.technician_payments
FOR SELECT TO authenticated
USING (public.is_lab_management(lab_organization_id));

DROP POLICY IF EXISTS "technician_payments_own_read" ON public.technician_payments;
CREATE POLICY "technician_payments_own_read" ON public.technician_payments
FOR SELECT TO authenticated
USING (
    public.is_lab_technician(lab_organization_id)
    AND EXISTS (
        SELECT 1
        FROM public.lab_work_order_stage_assignments a
        WHERE a.id = assignment_id
          AND a.lab_organization_id = technician_payments.lab_organization_id
          AND (
              a.technician_user_id = auth.uid()
              OR (
                  a.technician_user_id IS NULL
                  AND lower(trim(a.technician_name)) = lower(trim(coalesce(public.current_technician_name(), '')))
              )
          )
    )
);
