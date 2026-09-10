-- Per-tooth sale-price snapshots. Existing installations may already have
-- this table; all additions are idempotent so the canonical schema can adopt it.
CREATE TABLE IF NOT EXISTS public.lab_work_order_items (
    lab_organization_id uuid NOT NULL,
    work_order_id bigint NOT NULL,
    tooth_number integer NOT NULL,
    work_type text NOT NULL,
    contract text NOT NULL DEFAULT 'General',
    unit_price numeric(14,2),
    quantity numeric(14,3) NOT NULL DEFAULT 1,
    line_total numeric(14,2),
    price_source text,
    price_fixed_at timestamptz,
    price_migrated boolean NOT NULL DEFAULT false,
    created_by_user_id text,
    updated_by_user_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lab_organization_id, work_order_id, tooth_number),
    FOREIGN KEY (lab_organization_id, work_order_id)
        REFERENCES public.lab_work_orders(lab_organization_id, id) ON DELETE CASCADE,
    CHECK (tooth_number / 10 BETWEEN 1 AND 4 AND tooth_number % 10 BETWEEN 1 AND 8),
    CHECK (quantity > 0),
    CHECK (unit_price IS NULL OR unit_price >= 0),
    CHECK (line_total IS NULL OR line_total >= 0)
);

ALTER TABLE public.lab_work_order_items
    ADD COLUMN IF NOT EXISTS price_source text,
    ADD COLUMN IF NOT EXISTS price_fixed_at timestamptz,
    ADD COLUMN IF NOT EXISTS price_migrated boolean NOT NULL DEFAULT false;

ALTER TABLE public.lab_work_order_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS lab_work_order_items_order_idx
    ON public.lab_work_order_items(lab_organization_id, work_order_id);
CREATE INDEX IF NOT EXISTS lab_work_order_items_type_idx
    ON public.lab_work_order_items(lab_organization_id, lower(work_type));
