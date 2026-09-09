-- organization_memberships — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.organization_memberships
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."organization_memberships" (
    "organization_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "role" text NOT NULL,
    "status" public."membership_status" NOT NULL DEFAULT 'active'::membership_status,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."organization_memberships" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_memberships_organization_id_fkey' AND conrelid = 'public.organization_memberships'::regclass) THEN
        ALTER TABLE "public"."organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_memberships_pkey' AND conrelid = 'public.organization_memberships'::regclass) THEN
        ALTER TABLE "public"."organization_memberships" ADD CONSTRAINT "organization_memberships_pkey" PRIMARY KEY (organization_id, user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_memberships_user_id_fkey' AND conrelid = 'public.organization_memberships'::regclass) THEN
        ALTER TABLE "public"."organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_pkey ON public.organization_memberships USING btree (organization_id, user_id);
