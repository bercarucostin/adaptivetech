-- relationship_terms — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.relationship_terms
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."relationship_terms" (
    "relationship_id" uuid NOT NULL,
    "payment_terms_days" integer,
    "notes" text,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."relationship_terms" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_terms_pkey' AND conrelid = 'public.relationship_terms'::regclass) THEN
        ALTER TABLE "public"."relationship_terms" ADD CONSTRAINT "relationship_terms_pkey" PRIMARY KEY (relationship_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_terms_relationship_id_fkey' AND conrelid = 'public.relationship_terms'::regclass) THEN
        ALTER TABLE "public"."relationship_terms" ADD CONSTRAINT "relationship_terms_relationship_id_fkey" FOREIGN KEY (relationship_id) REFERENCES organization_relationships(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS relationship_terms_pkey ON public.relationship_terms USING btree (relationship_id);
