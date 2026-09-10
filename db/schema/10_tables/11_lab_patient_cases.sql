-- lab_patient_cases — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_patient_cases
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_patient_cases" (
    "lab_organization_id" uuid NOT NULL,
    "id" bigint NOT NULL,
    "work_order_id" bigint NOT NULL,
    "nume_pacient" text,
    "nume_partener" text,
    "deadline" date,
    "selected_teeth" text,
    "tooth_details_json" text,
    "shade" text,
    "method" text,
    "clinic_note" text,
    "production_notes" text,
    "created_by_user_id" text,
    "created_at" timestamptz,
    "updated_by_user_id" text,
    "updated_at" timestamptz,
    "migrated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_patient_cases" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_patient_cases_lab_organization_id_fkey' AND conrelid = 'public.lab_patient_cases'::regclass) THEN
        ALTER TABLE "public"."lab_patient_cases" ADD CONSTRAINT "lab_patient_cases_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_patient_cases_pkey' AND conrelid = 'public.lab_patient_cases'::regclass) THEN
        ALTER TABLE "public"."lab_patient_cases" ADD CONSTRAINT "lab_patient_cases_pkey" PRIMARY KEY (lab_organization_id, id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lab_patient_cases_partner_idx ON public.lab_patient_cases USING btree (lab_organization_id, lower(nume_partener));

CREATE INDEX IF NOT EXISTS lab_patient_cases_patient_idx ON public.lab_patient_cases USING btree (lab_organization_id, lower(nume_pacient));

CREATE UNIQUE INDEX IF NOT EXISTS lab_patient_cases_pkey ON public.lab_patient_cases USING btree (lab_organization_id, id);

CREATE INDEX IF NOT EXISTS lab_patient_cases_work_order_idx ON public.lab_patient_cases USING btree (lab_organization_id, work_order_id);
