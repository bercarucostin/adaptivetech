CREATE TABLE IF NOT EXISTS public.ai_operation_previews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    requested_by_user_id uuid NOT NULL,
    envelope jsonb NOT NULL,
    targets jsonb NOT NULL DEFAULT '[]'::jsonb,
    before_value jsonb NOT NULL DEFAULT '[]'::jsonb,
    after_value jsonb NOT NULL DEFAULT '[]'::jsonb,
    checksum text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK (expires_at > created_at)
);
ALTER TABLE public.ai_operation_previews ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ai_operation_previews_owner_idx
    ON public.ai_operation_previews(lab_organization_id,requested_by_user_id,expires_at);
