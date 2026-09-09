-- lab_technician_costs — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_technician_costs
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_technician_costs" (
    "lab_organization_id" uuid NOT NULL,
    "source_row_no" integer NOT NULL,
    "legacy_id" text,
    "tehnician" text NOT NULL,
    "tip_lucrare" text NOT NULL,
    "etapa" text NOT NULL,
    "cost" numeric,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_technician_costs" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_technician_costs_cost_nonnegative' AND conrelid = 'public.lab_technician_costs'::regclass) THEN
        ALTER TABLE "public"."lab_technician_costs" ADD CONSTRAINT "lab_technician_costs_cost_nonnegative" CHECK (cost IS NULL OR cost >= 0::numeric);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_technician_costs_lab_organization_id_fkey' AND conrelid = 'public.lab_technician_costs'::regclass) THEN
        ALTER TABLE "public"."lab_technician_costs" ADD CONSTRAINT "lab_technician_costs_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_technician_costs_pkey' AND conrelid = 'public.lab_technician_costs'::regclass) THEN
        ALTER TABLE "public"."lab_technician_costs" ADD CONSTRAINT "lab_technician_costs_pkey" PRIMARY KEY (lab_organization_id, source_row_no);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lab_technician_costs_legacy_id_idx ON public.lab_technician_costs USING btree (lab_organization_id, legacy_id);

CREATE INDEX IF NOT EXISTS lab_technician_costs_lookup_idx ON public.lab_technician_costs USING btree (lab_organization_id, lower(tehnician), lower(tip_lucrare), lower(etapa));

CREATE UNIQUE INDEX IF NOT EXISTS lab_technician_costs_pkey ON public.lab_technician_costs USING btree (lab_organization_id, source_row_no);

CREATE INDEX IF NOT EXISTS lab_technician_costs_technician_idx ON public.lab_technician_costs USING btree (lab_organization_id, lower(tehnician));
