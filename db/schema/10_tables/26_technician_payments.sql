CREATE TABLE IF NOT EXISTS public.technician_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    assignment_id uuid NOT NULL REFERENCES public.lab_work_order_stage_assignments(id),
    amount numeric(14,2) NOT NULL,
    currency text NOT NULL DEFAULT 'RON',
    paid_on date,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    recorded_by_user_id uuid,
    request_key text,
    reversal_of uuid REFERENCES public.technician_payments(id),
    migration_balance boolean NOT NULL DEFAULT false,
    note text,
    CHECK (amount <> 0),
    CHECK (currency = 'RON'),
    CHECK (
        (reversal_of IS NULL AND amount > 0)
        OR (reversal_of IS NOT NULL AND amount < 0)
    ),
    CHECK (NOT migration_balance OR paid_on IS NULL)
);

ALTER TABLE public.technician_payments ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS technician_payments_request_idx
    ON public.technician_payments(lab_organization_id, request_key)
    WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS technician_payments_one_reversal_idx
    ON public.technician_payments(reversal_of)
    WHERE reversal_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS technician_payments_assignment_idx
    ON public.technician_payments(assignment_id, recorded_at);
