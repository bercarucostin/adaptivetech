-- lab_work_types — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_work_types
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_work_types" (
    "lab_organization_id" uuid NOT NULL,
    "id" bigint NOT NULL,
    "tip_lucrare" text NOT NULL,
    "active" boolean NOT NULL DEFAULT true,
    "billing_mode" text NOT NULL DEFAULT 'per_tooth',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_work_types"
    ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'per_tooth';

ALTER TABLE "public"."lab_work_types" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_work_types_lab_organization_id_fkey' AND conrelid = 'public.lab_work_types'::regclass) THEN
        ALTER TABLE "public"."lab_work_types" ADD CONSTRAINT "lab_work_types_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lab_work_types_billing_mode_check'
          AND conrelid = 'public.lab_work_types'::regclass
    ) THEN
        ALTER TABLE public.lab_work_types
            ADD CONSTRAINT lab_work_types_billing_mode_check
            CHECK (billing_mode IN ('per_tooth','per_arch','per_piece'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_work_types_pkey' AND conrelid = 'public.lab_work_types'::regclass) THEN
        ALTER TABLE "public"."lab_work_types" ADD CONSTRAINT "lab_work_types_pkey" PRIMARY KEY (lab_organization_id, id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lab_work_types_name_idx ON public.lab_work_types USING btree (lab_organization_id, lower(tip_lucrare));

CREATE INDEX IF NOT EXISTS lab_work_types_org_active_idx ON public.lab_work_types USING btree (lab_organization_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS lab_work_types_pkey ON public.lab_work_types USING btree (lab_organization_id, id);
