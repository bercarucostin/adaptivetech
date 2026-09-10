CREATE TABLE IF NOT EXISTS public.work_order_financial_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    work_order_id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    action text NOT NULL,
    before_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    after_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    changed_at timestamptz NOT NULL DEFAULT now(),
    changed_by_user_id uuid,
    FOREIGN KEY (lab_organization_id, work_order_id)
        REFERENCES public.lab_work_orders(lab_organization_id, id),
    CHECK (entity_type IN ('work_order_price', 'work_order_scope', 'stage_assignment', 'technician_payment'))
);

ALTER TABLE public.work_order_financial_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS work_order_financial_audit_order_idx
    ON public.work_order_financial_audit(lab_organization_id, work_order_id, changed_at DESC);

-- Replace the deployed check as well as the fresh-table definition.
DO $$
DECLARE c record;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid='public.work_order_financial_audit'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%entity_type%'
    LOOP EXECUTE format('ALTER TABLE public.work_order_financial_audit DROP CONSTRAINT %I',c.conname); END LOOP;
    ALTER TABLE public.work_order_financial_audit ADD CONSTRAINT work_order_financial_audit_entity_type_check
        CHECK(entity_type IN ('work_order_price','work_order_scope','stage_assignment','technician_payment'));
END $$;
