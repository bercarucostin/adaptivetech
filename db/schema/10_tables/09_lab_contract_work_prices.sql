-- lab_contract_work_prices — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_contract_work_prices
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_contract_work_prices" (
    "lab_organization_id" uuid NOT NULL,
    "id" text NOT NULL,
    "contract" text NOT NULL,
    "tip_lucrare" text NOT NULL,
    "pret" numeric NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_contract_work_prices" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_contract_work_prices_lab_organization_id_fkey' AND conrelid = 'public.lab_contract_work_prices'::regclass) THEN
        ALTER TABLE "public"."lab_contract_work_prices" ADD CONSTRAINT "lab_contract_work_prices_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_contract_work_prices_pkey' AND conrelid = 'public.lab_contract_work_prices'::regclass) THEN
        ALTER TABLE "public"."lab_contract_work_prices" ADD CONSTRAINT "lab_contract_work_prices_pkey" PRIMARY KEY (lab_organization_id, id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_contract_work_prices_pret_check' AND conrelid = 'public.lab_contract_work_prices'::regclass) THEN
        ALTER TABLE "public"."lab_contract_work_prices" ADD CONSTRAINT "lab_contract_work_prices_pret_check" CHECK (pret >= 0::numeric);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lab_contract_work_prices_contract_idx ON public.lab_contract_work_prices USING btree (lab_organization_id, contract);

CREATE INDEX IF NOT EXISTS lab_contract_work_prices_lookup_idx ON public.lab_contract_work_prices USING btree (lab_organization_id, lower(contract), lower(tip_lucrare));

CREATE UNIQUE INDEX IF NOT EXISTS lab_contract_work_prices_pkey ON public.lab_contract_work_prices USING btree (lab_organization_id, id);
