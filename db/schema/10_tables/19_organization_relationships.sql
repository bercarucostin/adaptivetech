-- organization_relationships — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.organization_relationships
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."organization_relationships" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "clinic_organization_id" uuid NOT NULL,
    "lab_organization_id" uuid NOT NULL,
    "status" public."relationship_status" NOT NULL DEFAULT 'pending'::relationship_status,
    "initiated_by_organization_id" uuid,
    "requested_by_user_id" uuid,
    "accepted_by_clinic_at" timestamptz,
    "accepted_by_lab_at" timestamptz,
    "activated_at" timestamptz,
    "ended_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."organization_relationships" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_lab_must_differ' AND conrelid = 'public.organization_relationships'::regclass) THEN
        ALTER TABLE "public"."organization_relationships" ADD CONSTRAINT "clinic_lab_must_differ" CHECK (clinic_organization_id <> lab_organization_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_relationships_clinic_organization_id_fkey' AND conrelid = 'public.organization_relationships'::regclass) THEN
        ALTER TABLE "public"."organization_relationships" ADD CONSTRAINT "organization_relationships_clinic_organization_id_fkey" FOREIGN KEY (clinic_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_relationships_clinic_organization_id_lab_organ_key' AND conrelid = 'public.organization_relationships'::regclass) THEN
        ALTER TABLE "public"."organization_relationships" ADD CONSTRAINT "organization_relationships_clinic_organization_id_lab_organ_key" UNIQUE (clinic_organization_id, lab_organization_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_relationships_initiated_by_organization_id_fkey' AND conrelid = 'public.organization_relationships'::regclass) THEN
        ALTER TABLE "public"."organization_relationships" ADD CONSTRAINT "organization_relationships_initiated_by_organization_id_fkey" FOREIGN KEY (initiated_by_organization_id) REFERENCES organizations(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_relationships_lab_organization_id_fkey' AND conrelid = 'public.organization_relationships'::regclass) THEN
        ALTER TABLE "public"."organization_relationships" ADD CONSTRAINT "organization_relationships_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_relationships_pkey' AND conrelid = 'public.organization_relationships'::regclass) THEN
        ALTER TABLE "public"."organization_relationships" ADD CONSTRAINT "organization_relationships_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_relationships_requested_by_user_id_fkey' AND conrelid = 'public.organization_relationships'::regclass) THEN
        ALTER TABLE "public"."organization_relationships" ADD CONSTRAINT "organization_relationships_requested_by_user_id_fkey" FOREIGN KEY (requested_by_user_id) REFERENCES auth.users(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS org_relationships_clinic_idx ON public.organization_relationships USING btree (clinic_organization_id, status);

CREATE INDEX IF NOT EXISTS org_relationships_lab_idx ON public.organization_relationships USING btree (lab_organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS organization_relationships_clinic_organization_id_lab_organ_key ON public.organization_relationships USING btree (clinic_organization_id, lab_organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS organization_relationships_pkey ON public.organization_relationships USING btree (id);
