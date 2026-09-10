-- profiles — RLS policies, triggers and function-dependent constraints
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

DROP POLICY IF EXISTS "profiles self read" ON "public"."profiles";

CREATE POLICY "profiles self read" ON "public"."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id = auth.uid()));

-- Deliberately dropped and NOT recreated. See 40_grants.sql for why.
DROP POLICY IF EXISTS "profiles self update" ON "public"."profiles";

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
