-- lab_work_orders — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_work_orders_management_read" ON "public"."lab_work_orders";

CREATE POLICY "lab_work_orders_management_read" ON "public"."lab_work_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_work_orders_management_write" ON "public"."lab_work_orders";

CREATE POLICY "lab_work_orders_management_write" ON "public"."lab_work_orders" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text])) WITH CHECK (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));
