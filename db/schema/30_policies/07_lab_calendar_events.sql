-- lab_calendar_events — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_calendar_lab_delete" ON "public"."lab_calendar_events";

CREATE POLICY "lab_calendar_lab_delete" ON "public"."lab_calendar_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text, 'Technician'::text]) AND ((owner_user_id = auth.uid()) OR ((calendar_scope = 'shared'::text) AND has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text])))));

DROP POLICY IF EXISTS "lab_calendar_lab_insert" ON "public"."lab_calendar_events";

CREATE POLICY "lab_calendar_lab_insert" ON "public"."lab_calendar_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text, 'Technician'::text]) AND (owner_user_id = auth.uid()) AND (calendar_scope = ANY (ARRAY['shared'::text, 'personal'::text]))));

DROP POLICY IF EXISTS "lab_calendar_lab_read" ON "public"."lab_calendar_events";

CREATE POLICY "lab_calendar_lab_read" ON "public"."lab_calendar_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text, 'Technician'::text]) AND ((calendar_scope = 'shared'::text) OR ((calendar_scope = 'personal'::text) AND (owner_user_id = auth.uid())))));

DROP POLICY IF EXISTS "lab_calendar_lab_update" ON "public"."lab_calendar_events";

CREATE POLICY "lab_calendar_lab_update" ON "public"."lab_calendar_events" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING (
    has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text, 'Technician'::text])
    AND (owner_user_id=auth.uid() OR calendar_scope='shared')
)
WITH CHECK (
    has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text, 'Technician'::text])
    AND calendar_scope=ANY(ARRAY['shared'::text,'personal'::text])
    AND (owner_user_id=auth.uid() OR calendar_scope='shared')
);

DROP TRIGGER IF EXISTS lab_calendar_event_edit_guard ON public.lab_calendar_events;
CREATE TRIGGER lab_calendar_event_edit_guard
BEFORE UPDATE ON public.lab_calendar_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_calendar_event_edit_rules();
