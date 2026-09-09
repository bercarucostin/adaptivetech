-- lab_work_orders — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_work_orders
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_work_orders" (
    "lab_organization_id" uuid NOT NULL,
    "id" bigint NOT NULL,
    "deadline" date,
    "status" text NOT NULL,
    "nume_pacient" text,
    "nume_partener" text,
    "contract" text,
    "tip_lucrare" text,
    "tehnician_model" text,
    "tehnician1_modelare" text,
    "tehnician2_cer_fin" text,
    "status_model" text,
    "status_modelare" text,
    "status_cer_fin" text,
    "paid_model" text,
    "paid_modelare" text,
    "paid_cer_fin" text,
    "created_by_user_id" text,
    "created_at" timestamptz,
    "updated_by_user_id" text,
    "updated_at" timestamptz,
    "nr_elemente" integer NOT NULL DEFAULT 1,
    "discount" numeric NOT NULL DEFAULT 0,
    "data_receptie" timestamptz,
    "locked" boolean NOT NULL DEFAULT false,
    "migrated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_work_orders" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_work_orders_discount_check' AND conrelid = 'public.lab_work_orders'::regclass) THEN
        ALTER TABLE "public"."lab_work_orders" ADD CONSTRAINT "lab_work_orders_discount_check" CHECK (discount >= 0::numeric AND discount <= 100::numeric);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_work_orders_lab_organization_id_fkey' AND conrelid = 'public.lab_work_orders'::regclass) THEN
        ALTER TABLE "public"."lab_work_orders" ADD CONSTRAINT "lab_work_orders_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_work_orders_nr_elemente_check' AND conrelid = 'public.lab_work_orders'::regclass) THEN
        ALTER TABLE "public"."lab_work_orders" ADD CONSTRAINT "lab_work_orders_nr_elemente_check" CHECK (nr_elemente >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_work_orders_pkey' AND conrelid = 'public.lab_work_orders'::regclass) THEN
        ALTER TABLE "public"."lab_work_orders" ADD CONSTRAINT "lab_work_orders_pkey" PRIMARY KEY (lab_organization_id, id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lab_work_orders_deadline_idx ON public.lab_work_orders USING btree (lab_organization_id, deadline);

CREATE INDEX IF NOT EXISTS lab_work_orders_locked_status_idx ON public.lab_work_orders USING btree (lab_organization_id, locked, status);

CREATE INDEX IF NOT EXISTS lab_work_orders_partner_idx ON public.lab_work_orders USING btree (lab_organization_id, lower(nume_partener));

CREATE INDEX IF NOT EXISTS lab_work_orders_patient_idx ON public.lab_work_orders USING btree (lab_organization_id, lower(nume_pacient));

CREATE UNIQUE INDEX IF NOT EXISTS lab_work_orders_pkey ON public.lab_work_orders USING btree (lab_organization_id, id);

CREATE INDEX IF NOT EXISTS lab_work_orders_status_idx ON public.lab_work_orders USING btree (lab_organization_id, status);

CREATE INDEX IF NOT EXISTS lab_work_orders_type_idx ON public.lab_work_orders USING btree (lab_organization_id, lower(tip_lucrare));
