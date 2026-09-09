-- work_order_files — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.work_order_files
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."work_order_files" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "legacy_work_order_id" bigint NOT NULL,
    "clinic_organization_id" uuid,
    "lab_organization_id" uuid,
    "bucket_name" text NOT NULL DEFAULT 'work-order-files'::text,
    "object_path" text NOT NULL,
    "original_file_name" text NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "mime_type" text,
    "file_extension" text,
    "file_kind" text,
    "shared_with_lab" boolean NOT NULL DEFAULT true,
    "uploaded_by_user_id" uuid,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."work_order_files" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_files_clinic_organization_id_fkey' AND conrelid = 'public.work_order_files'::regclass) THEN
        ALTER TABLE "public"."work_order_files" ADD CONSTRAINT "work_order_files_clinic_organization_id_fkey" FOREIGN KEY (clinic_organization_id) REFERENCES organizations(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_files_lab_organization_id_fkey' AND conrelid = 'public.work_order_files'::regclass) THEN
        ALTER TABLE "public"."work_order_files" ADD CONSTRAINT "work_order_files_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_files_object_path_key' AND conrelid = 'public.work_order_files'::regclass) THEN
        ALTER TABLE "public"."work_order_files" ADD CONSTRAINT "work_order_files_object_path_key" UNIQUE (object_path);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_files_pkey' AND conrelid = 'public.work_order_files'::regclass) THEN
        ALTER TABLE "public"."work_order_files" ADD CONSTRAINT "work_order_files_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_files_uploaded_by_user_id_fkey' AND conrelid = 'public.work_order_files'::regclass) THEN
        ALTER TABLE "public"."work_order_files" ADD CONSTRAINT "work_order_files_uploaded_by_user_id_fkey" FOREIGN KEY (uploaded_by_user_id) REFERENCES auth.users(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS work_order_files_legacy_work_order_idx ON public.work_order_files USING btree (legacy_work_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS work_order_files_object_path_key ON public.work_order_files USING btree (object_path);

CREATE UNIQUE INDEX IF NOT EXISTS work_order_files_pkey ON public.work_order_files USING btree (id);
