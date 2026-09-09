-- lab_materials_inventory — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_materials_inventory
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_materials_inventory" (
    "lab_organization_id" uuid NOT NULL,
    "id" bigint NOT NULL DEFAULT nextval('lab_materials_inventory_id_seq'::regclass),
    "furnizor" text,
    "material" text NOT NULL,
    "um" text,
    "cantitate" numeric NOT NULL DEFAULT 0,
    "prag_minim" numeric NOT NULL DEFAULT 0,
    "observatii" text,
    "ultima_actualizare" timestamptz,
    "created_by_user_id" text,
    "updated_by_user_id" text,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    "migrated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."lab_materials_inventory" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_materials_inventory_cantitate_check' AND conrelid = 'public.lab_materials_inventory'::regclass) THEN
        ALTER TABLE "public"."lab_materials_inventory" ADD CONSTRAINT "lab_materials_inventory_cantitate_check" CHECK (cantitate >= 0::numeric);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_materials_inventory_lab_organization_id_fkey' AND conrelid = 'public.lab_materials_inventory'::regclass) THEN
        ALTER TABLE "public"."lab_materials_inventory" ADD CONSTRAINT "lab_materials_inventory_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_materials_inventory_pkey' AND conrelid = 'public.lab_materials_inventory'::regclass) THEN
        ALTER TABLE "public"."lab_materials_inventory" ADD CONSTRAINT "lab_materials_inventory_pkey" PRIMARY KEY (lab_organization_id, id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_materials_inventory_prag_minim_check' AND conrelid = 'public.lab_materials_inventory'::regclass) THEN
        ALTER TABLE "public"."lab_materials_inventory" ADD CONSTRAINT "lab_materials_inventory_prag_minim_check" CHECK (prag_minim >= 0::numeric);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lab_materials_inventory_material_idx ON public.lab_materials_inventory USING btree (lab_organization_id, lower(material));

CREATE UNIQUE INDEX IF NOT EXISTS lab_materials_inventory_pkey ON public.lab_materials_inventory USING btree (lab_organization_id, id);

CREATE INDEX IF NOT EXISTS lab_materials_inventory_stock_idx ON public.lab_materials_inventory USING btree (lab_organization_id, cantitate, prag_minim);

CREATE INDEX IF NOT EXISTS lab_materials_inventory_supplier_idx ON public.lab_materials_inventory USING btree (lab_organization_id, lower(furnizor));
