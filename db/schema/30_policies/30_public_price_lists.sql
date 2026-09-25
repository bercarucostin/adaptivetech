-- public_price_lists — RLS policies
-- Every statement is idempotent, so the file is safe to re-run.
--
-- One SELECT policy and no write policy at all. Writes arrive only through
-- publish_public_price_list and set_current_public_price_list, which are
-- SECURITY DEFINER, and 40_grants.sql revokes write privileges from both
-- browser roles as a second, independent barrier.

DROP POLICY IF EXISTS "current public price list is world readable" ON "public"."public_price_lists";

CREATE POLICY "current public price list is world readable" ON "public"."public_price_lists" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ((is_current OR is_lab_management(lab_organization_id)));
