CREATE TABLE IF NOT EXISTS public.ai_operation_requests (
    lab_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    request_key text NOT NULL,
    requested_by_user_id uuid NOT NULL,
    envelope_hash text NOT NULL,
    state text NOT NULL DEFAULT 'running',
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    PRIMARY KEY (lab_organization_id,request_key),
    CHECK (state IN ('running','completed','failed'))
);
ALTER TABLE public.ai_operation_requests ENABLE ROW LEVEL SECURITY;
