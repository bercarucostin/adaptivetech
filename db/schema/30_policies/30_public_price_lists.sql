-- public_price_lists — RLS policies
-- Every statement is idempotent, so the file is safe to re-run.
--
-- One SELECT policy and no write policy at all. Writes arrive only through
-- publish_public_price_list and set_current_public_price_list, which are
-- SECURITY DEFINER, and 40_grants.sql revokes write privileges from both
-- browser roles as a second, independent barrier.

DROP POLICY IF EXISTS "current public price list is world readable" ON "public"."public_price_lists";

CREATE POLICY "current public price list is world readable" ON "public"."public_price_lists" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ((is_current OR public.is_lab_management(lab_organization_id)));

-- Function-dependent constraint, so it lives here rather than with the table:
-- the validator must exist before it can be referenced.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_document_valid' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_document_valid" CHECK (public.public_price_document_is_valid(document));
    END IF;
END $$;
