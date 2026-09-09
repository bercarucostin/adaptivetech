-- lab_profiles — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_profiles
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_profiles" (
    "organization_id" uuid NOT NULL,
    "visibility" public."lab_visibility" NOT NULL DEFAULT 'private'::lab_visibility,
    "public_name" text,
    "city" text,
    "description" text,
    "public_price_note" text,
    "contact_email" text,
    "contact_phone" text,
    "website" text,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_profiles" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_profiles_organization_id_fkey' AND conrelid = 'public.lab_profiles'::regclass) THEN
        ALTER TABLE "public"."lab_profiles" ADD CONSTRAINT "lab_profiles_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_profiles_pkey' AND conrelid = 'public.lab_profiles'::regclass) THEN
        ALTER TABLE "public"."lab_profiles" ADD CONSTRAINT "lab_profiles_pkey" PRIMARY KEY (organization_id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lab_profiles_pkey ON public.lab_profiles USING btree (organization_id);
