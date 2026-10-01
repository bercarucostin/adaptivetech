-- Persistent partner catalog, scoped to each laboratory.
CREATE TABLE IF NOT EXISTS public.lab_partners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 180),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lab_partners_org_name_idx
    ON public.lab_partners (lab_organization_id, lower(name));
ALTER TABLE public.lab_partners ENABLE ROW LEVEL SECURITY;

-- Bootstrap the catalog without changing historical values or reactivating names.
INSERT INTO public.lab_partners (lab_organization_id, name)
SELECT DISTINCT ON (lab_organization_id, lower(name)) lab_organization_id, name
FROM (
    SELECT lab_organization_id, btrim(nume_partener) AS name FROM public.lab_work_orders
    UNION ALL
    SELECT lab_organization_id, btrim(nume_partener) AS name FROM public.lab_patient_cases
    UNION ALL
    SELECT o.id, btrim(d.partner_name)
    FROM public.legacy_user_directory d
    JOIN public.organizations o ON o.slug = 'flowrise-dental-lab' AND o.organization_type = 'lab'
) existing
WHERE lab_organization_id IS NOT NULL AND length(name) BETWEEN 1 AND 180
ORDER BY lab_organization_id, lower(name), name
ON CONFLICT DO NOTHING;
