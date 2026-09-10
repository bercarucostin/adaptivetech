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
    "discount" numeric NOT NULL DEFAULT 0,
    "data_receptie" timestamptz,
    "locked" boolean NOT NULL DEFAULT false,
    "model_not_applicable" boolean NOT NULL DEFAULT false,
    "modelare_not_applicable" boolean NOT NULL DEFAULT false,
    "cer_fin_not_applicable" boolean NOT NULL DEFAULT false,
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


-- Financial values are fixed when the Work Order is created.  They live on
-- the order instead of being recomputed from the mutable contract catalog.
ALTER TABLE public.lab_work_orders
    ADD COLUMN IF NOT EXISTS model_not_applicable boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS modelare_not_applicable boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cer_fin_not_applicable boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS snapshot_list_price numeric(14,2),
    ADD COLUMN IF NOT EXISTS snapshot_final_price numeric(14,2),
    ADD COLUMN IF NOT EXISTS price_source text,
    ADD COLUMN IF NOT EXISTS price_fixed_at timestamptz,
    ADD COLUMN IF NOT EXISTS price_migrated boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE public.lab_work_orders
SET model_not_applicable = coalesce(model_not_applicable,false),
    modelare_not_applicable = coalesce(modelare_not_applicable,false),
    cer_fin_not_applicable = coalesce(cer_fin_not_applicable,false)
WHERE model_not_applicable IS NULL
   OR modelare_not_applicable IS NULL
   OR cer_fin_not_applicable IS NULL;

ALTER TABLE public.lab_work_orders
    ALTER COLUMN model_not_applicable SET DEFAULT false,
    ALTER COLUMN model_not_applicable SET NOT NULL,
    ALTER COLUMN modelare_not_applicable SET DEFAULT false,
    ALTER COLUMN modelare_not_applicable SET NOT NULL,
    ALTER COLUMN cer_fin_not_applicable SET DEFAULT false,
    ALTER COLUMN cer_fin_not_applicable SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lab_work_orders_snapshot_prices_nonnegative'
          AND conrelid = 'public.lab_work_orders'::regclass
    ) THEN
        ALTER TABLE public.lab_work_orders
            ADD CONSTRAINT lab_work_orders_snapshot_prices_nonnegative CHECK (
                (snapshot_list_price IS NULL OR snapshot_list_price >= 0)
                AND (snapshot_final_price IS NULL OR snapshot_final_price >= 0)
            );
    END IF;
END $$;
