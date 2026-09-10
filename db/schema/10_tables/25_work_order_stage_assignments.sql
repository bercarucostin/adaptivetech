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
