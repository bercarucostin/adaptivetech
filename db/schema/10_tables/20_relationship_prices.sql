-- relationship_prices — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.relationship_prices
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."relationship_prices" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "relationship_id" uuid NOT NULL,
    "work_type" text NOT NULL,
    "price" numeric NOT NULL,
    "currency" text NOT NULL DEFAULT 'RON'::text,
    "active" boolean NOT NULL DEFAULT true,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."relationship_prices" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_prices_pkey' AND conrelid = 'public.relationship_prices'::regclass) THEN
        ALTER TABLE "public"."relationship_prices" ADD CONSTRAINT "relationship_prices_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_prices_relationship_id_fkey' AND conrelid = 'public.relationship_prices'::regclass) THEN
        ALTER TABLE "public"."relationship_prices" ADD CONSTRAINT "relationship_prices_relationship_id_fkey" FOREIGN KEY (relationship_id) REFERENCES organization_relationships(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_prices_relationship_id_work_type_key' AND conrelid = 'public.relationship_prices'::regclass) THEN
        ALTER TABLE "public"."relationship_prices" ADD CONSTRAINT "relationship_prices_relationship_id_work_type_key" UNIQUE (relationship_id, work_type);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS relationship_prices_pkey ON public.relationship_prices USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS relationship_prices_relationship_id_work_type_key ON public.relationship_prices USING btree (relationship_id, work_type);
