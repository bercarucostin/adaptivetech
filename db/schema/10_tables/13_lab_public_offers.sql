-- lab_public_offers — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_public_offers
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_public_offers" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "lab_organization_id" uuid NOT NULL,
    "work_type" text NOT NULL,
    "public_price" numeric,
    "currency" text NOT NULL DEFAULT 'RON'::text,
    "note" text,
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_public_offers" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_public_offers_lab_organization_id_fkey' AND conrelid = 'public.lab_public_offers'::regclass) THEN
        ALTER TABLE "public"."lab_public_offers" ADD CONSTRAINT "lab_public_offers_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_public_offers_pkey' AND conrelid = 'public.lab_public_offers'::regclass) THEN
        ALTER TABLE "public"."lab_public_offers" ADD CONSTRAINT "lab_public_offers_pkey" PRIMARY KEY (id);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lab_public_offers_pkey ON public.lab_public_offers USING btree (id);
