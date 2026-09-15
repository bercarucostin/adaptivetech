-- Frozen sale-price authority, one row for each canonical billing unit.
CREATE TABLE IF NOT EXISTS public.lab_work_order_price_lines (
    lab_organization_id uuid NOT NULL,
    work_order_id bigint NOT NULL,
    work_type text NOT NULL,
    billing_mode text NOT NULL DEFAULT 'per_tooth',
    billing_scope text NOT NULL,
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
    PRIMARY KEY (lab_organization_id, work_order_id, work_type, billing_scope),
    FOREIGN KEY (lab_organization_id, work_order_id)
        REFERENCES public.lab_work_orders(lab_organization_id, id) ON DELETE CASCADE,
    CONSTRAINT lab_work_order_price_lines_billing_mode_check
        CHECK (billing_mode IN ('per_tooth','per_arch','per_piece')),
    CONSTRAINT lab_work_order_price_lines_scope_check CHECK (
        (billing_mode='per_tooth' AND billing_scope ~ '^tooth:[1-4][1-8]$') OR
        (billing_mode='per_arch' AND billing_scope IN ('arch:upper','arch:lower')) OR
        (billing_mode='per_piece' AND billing_scope='piece')
    ),
    CHECK (trim(work_type) <> ''),
    CHECK (quantity > 0),
    CHECK (unit_price IS NULL OR unit_price >= 0),
    CHECK (line_total IS NULL OR line_total >= 0)
);

ALTER TABLE public.lab_work_order_price_lines ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS lab_work_order_price_lines_order_idx
    ON public.lab_work_order_price_lines(lab_organization_id,work_order_id);
CREATE INDEX IF NOT EXISTS lab_work_order_price_lines_type_idx
    ON public.lab_work_order_price_lines(lab_organization_id,lower(work_type));

-- Existing Work Orders already contain frozen per-tooth amounts. Copy those
-- saved values one-to-one; historical migration never consults a catalog.
INSERT INTO public.lab_work_order_price_lines (
    lab_organization_id,work_order_id,work_type,billing_mode,billing_scope,
    contract,unit_price,quantity,line_total,price_source,price_fixed_at,
    price_migrated,created_by_user_id,updated_by_user_id,created_at,updated_at
)
SELECT i.lab_organization_id,i.work_order_id,i.work_type,'per_tooth',
       'tooth:' || i.tooth_number::text,i.contract,i.unit_price,i.quantity,
       i.line_total,coalesce(i.price_source,'migration_items'),
       coalesce(i.price_fixed_at,i.updated_at,i.created_at,now()),true,
       i.created_by_user_id,i.updated_by_user_id,i.created_at,i.updated_at
FROM public.lab_work_order_items i
WHERE i.price_fixed_at IS NOT NULL OR i.price_source IS NOT NULL
   OR i.unit_price IS NOT NULL OR i.line_total IS NOT NULL
ON CONFLICT DO NOTHING;
