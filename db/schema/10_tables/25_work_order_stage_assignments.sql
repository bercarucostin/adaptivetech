CREATE TABLE IF NOT EXISTS public.lab_work_order_stage_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    work_order_id bigint NOT NULL,
    stage_key text NOT NULL,
    technician_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    technician_name text NOT NULL,
    unit_cost numeric(14,2),
    quantity numeric(14,3) NOT NULL DEFAULT 1,
    agreed_amount numeric(14,2),
    cost_source text,
    fixed_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    migrated boolean NOT NULL DEFAULT false,
    created_by_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (lab_organization_id, work_order_id)
        REFERENCES public.lab_work_orders(lab_organization_id, id),
    CHECK (stage_key IN ('model', 'modelare', 'cer_fin')),
    CHECK (unit_cost IS NULL OR unit_cost >= 0),
    CHECK (quantity > 0),
    CHECK (agreed_amount IS NULL OR agreed_amount >= 0),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

ALTER TABLE public.lab_work_order_stage_assignments ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS lab_work_order_stage_assignments_one_active_idx
    ON public.lab_work_order_stage_assignments(lab_organization_id, work_order_id, stage_key)
    WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS lab_work_order_stage_assignments_technician_idx
    ON public.lab_work_order_stage_assignments(lab_organization_id, technician_user_id, started_at);
CREATE INDEX IF NOT EXISTS lab_work_order_stage_assignments_name_idx
    ON public.lab_work_order_stage_assignments(lab_organization_id, lower(technician_name), started_at);

CREATE TABLE IF NOT EXISTS public.lab_work_order_assignment_cost_lines (
    assignment_id uuid NOT NULL REFERENCES public.lab_work_order_stage_assignments(id),
    work_type text NOT NULL,
    billing_mode text NOT NULL DEFAULT 'per_tooth',
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,2),
    amount numeric(14,2),
    cost_source text NOT NULL,
    PRIMARY KEY (assignment_id, work_type),
    CONSTRAINT lab_work_order_assignment_cost_lines_billing_mode_check
        CHECK (billing_mode IN ('per_tooth','per_arch','per_piece')),
    CHECK (quantity > 0),
    CHECK (unit_cost IS NULL OR unit_cost >= 0),
    CHECK (amount IS NULL OR amount >= 0)
);

-- Historical cost lines already contain frozen per-tooth amounts. Adding the
-- default labels them without consulting current work-type or cost catalogs.
ALTER TABLE public.lab_work_order_assignment_cost_lines
    ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'per_tooth';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='lab_work_order_assignment_cost_lines_billing_mode_check'
          AND conrelid='public.lab_work_order_assignment_cost_lines'::regclass
    ) THEN
        ALTER TABLE public.lab_work_order_assignment_cost_lines
            ADD CONSTRAINT lab_work_order_assignment_cost_lines_billing_mode_check
            CHECK (billing_mode IN ('per_tooth','per_arch','per_piece'));
    END IF;
END $$;

ALTER TABLE public.lab_work_order_assignment_cost_lines ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS assignment_cost_lines_assignment_idx
    ON public.lab_work_order_assignment_cost_lines(assignment_id);

-- Signed, frozen scope deltas preserve original assignment lines and payments.
CREATE TABLE IF NOT EXISTS public.lab_work_order_assignment_adjustments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id uuid NOT NULL REFERENCES public.lab_work_order_stage_assignments(id),
    work_type text NOT NULL,
    billing_mode text NOT NULL DEFAULT 'per_tooth',
    quantity_delta numeric(14,3) NOT NULL CHECK(quantity_delta <> 0),
    unit_cost numeric(14,2) CHECK(unit_cost IS NULL OR unit_cost >= 0),
    amount numeric(14,2),
    cost_source text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_user_id uuid,
    CONSTRAINT lab_work_order_assignment_adjustments_billing_mode_check
        CHECK (billing_mode IN ('per_tooth','per_arch','per_piece'))
);

-- The same additive upgrade preserves signed historical amounts verbatim.
ALTER TABLE public.lab_work_order_assignment_adjustments
    ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'per_tooth';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='lab_work_order_assignment_adjustments_billing_mode_check'
          AND conrelid='public.lab_work_order_assignment_adjustments'::regclass
    ) THEN
        ALTER TABLE public.lab_work_order_assignment_adjustments
            ADD CONSTRAINT lab_work_order_assignment_adjustments_billing_mode_check
            CHECK (billing_mode IN ('per_tooth','per_arch','per_piece'));
    END IF;
END $$;
ALTER TABLE public.lab_work_order_assignment_adjustments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS assignment_adjustments_assignment_idx ON public.lab_work_order_assignment_adjustments(assignment_id);
REVOKE ALL ON public.lab_work_order_assignment_adjustments FROM public,authenticated;
