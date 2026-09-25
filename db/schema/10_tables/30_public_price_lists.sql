-- public_price_lists — table, constraints and indexes
-- The versioned price list published on the public landing page. One row per
-- published version; rows are never updated except to move is_current, and never
-- deleted, so the table is its own audit trail.
-- Every statement is idempotent, so the file is safe to re-run.

CREATE TABLE IF NOT EXISTS "public"."public_price_lists" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "lab_organization_id" uuid NOT NULL,
    "document" jsonb NOT NULL,
    "is_current" boolean NOT NULL DEFAULT false,
    "note" text,
    "created_by" uuid,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."public_price_lists" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_pkey' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_lab_organization_id_fkey' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- SET NULL rather than CASCADE: a departed employee's profile must never take
-- published price history with it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_created_by_fkey' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS public_price_lists_pkey ON public.public_price_lists USING btree (id);

-- One current list per lab, enforced rather than trusted to the RPC.
CREATE UNIQUE INDEX IF NOT EXISTS public_price_lists_one_current ON public.public_price_lists USING btree (lab_organization_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS public_price_lists_history ON public.public_price_lists USING btree (lab_organization_id, created_at DESC);
