DROP POLICY IF EXISTS lab_partners_read ON public.lab_partners;
CREATE POLICY lab_partners_read ON public.lab_partners FOR SELECT TO authenticated
    USING (public.has_org_role(lab_organization_id, ARRAY['Admin','Manager','Technician','Dashboard']));

DROP POLICY IF EXISTS lab_partners_admin_insert ON public.lab_partners;
CREATE POLICY lab_partners_admin_insert ON public.lab_partners FOR INSERT TO authenticated
    WITH CHECK (public.has_org_role(lab_organization_id, ARRAY['Admin']));

DROP POLICY IF EXISTS lab_partners_admin_update ON public.lab_partners;
CREATE POLICY lab_partners_admin_update ON public.lab_partners FOR UPDATE TO authenticated
    USING (public.has_org_role(lab_organization_id, ARRAY['Admin']))
    WITH CHECK (public.has_org_role(lab_organization_id, ARRAY['Admin']));
