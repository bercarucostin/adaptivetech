-- organizations — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.organizations
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "organization_type" public."organization_type" NOT NULL,
    "name" text NOT NULL,
    "slug" text,
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_pkey' AND conrelid = 'public.organizations'::regclass) THEN
        ALTER TABLE "public"."organizations" ADD CONSTRAINT "organizations_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_slug_key' AND conrelid = 'public.organizations'::regclass) THEN
        ALTER TABLE "public"."organizations" ADD CONSTRAINT "organizations_slug_key" UNIQUE (slug);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_pkey ON public.organizations USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_key ON public.organizations USING btree (slug);
