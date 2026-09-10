-- lab_work_orders — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "lab_work_orders_management_read" ON "public"."lab_work_orders";

CREATE POLICY "lab_work_orders_management_read" ON "public"."lab_work_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_org_role(lab_organization_id, ARRAY['Admin'::text, 'Manager'::text]));

DROP POLICY IF EXISTS "lab_work_orders_management_write" ON "public"."lab_work_orders";
-- Writes use role-checked SECURITY DEFINER RPCs so financial snapshots and
-- assignment history cannot be bypassed with a direct table mutation.

DROP TRIGGER IF EXISTS lab_work_orders_stage_rules ON public.lab_work_orders;
DROP TRIGGER IF EXISTS lab_work_orders_stage_rules_insert ON public.lab_work_orders;
DROP TRIGGER IF EXISTS lab_work_orders_stage_rules_update ON public.lab_work_orders;
CREATE TRIGGER lab_work_orders_stage_rules_insert
BEFORE INSERT ON public.lab_work_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_work_order_stage_rules();
CREATE TRIGGER lab_work_orders_stage_rules_update
BEFORE UPDATE OF status,
    tehnician_model,tehnician1_modelare,tehnician2_cer_fin,
    status_model,status_modelare,status_cer_fin,
    paid_model,paid_modelare,paid_cer_fin,
    model_not_applicable,modelare_not_applicable,cer_fin_not_applicable
ON public.lab_work_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_work_order_stage_rules();
