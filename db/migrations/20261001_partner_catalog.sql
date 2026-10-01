-- Partner catalog and restricted work-order selection.
-- Run in Supabase SQL Editor before deploying the updated frontend.
BEGIN;

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


-- Reject new arbitrary partner names from management/technician work-order RPCs.
CREATE OR REPLACE FUNCTION public.enforce_work_order_partner_catalog()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_name text;
    v_role text;
BEGIN
    -- Existing names, including inactive/historical partners, remain editable.
    IF TG_OP = 'UPDATE' AND NEW.lab_organization_id = OLD.lab_organization_id
       AND btrim(NEW.nume_partener) IS NOT DISTINCT FROM btrim(OLD.nume_partener) THEN
        -- The existing management RPCs trim submitted form values.
        NEW.nume_partener := OLD.nume_partener;
        RETURN NEW;
    END IF;
    v_role := public.effective_lab_role(NEW.lab_organization_id);
    -- Doctors' own partner is derived by the existing Doctor RPCs.
    -- Trusted service/import operations without an end-user session are preserved.
    IF auth.uid() IS NULL OR v_role = 'doctor' THEN RETURN NEW; END IF;
    SELECT p.name INTO v_name FROM public.lab_partners p
    WHERE p.lab_organization_id = NEW.lab_organization_id AND p.active
      AND lower(p.name) = lower(btrim(NEW.nume_partener));
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Selectează un partener activ din lista configurată de Admin.';
    END IF;
    NEW.nume_partener := v_name;
    RETURN NEW;
END;
$$;


DROP POLICY IF EXISTS lab_partners_read ON public.lab_partners;
CREATE POLICY lab_partners_read ON public.lab_partners FOR SELECT TO authenticated
    USING (public.has_org_role(lab_organization_id, ARRAY['Admin','Manager','Technician','Dashboard']));

DROP POLICY IF EXISTS lab_partners_admin_insert ON public.lab_partners;
CREATE POLICY lab_partners_admin_insert ON public.lab_partners FOR INSERT TO authenticated
    WITH CHECK (public.has_org_role(lab_organization_id, ARRAY['Admin']));

DROP POLICY IF EXISTS lab_partners_admin_update ON public.lab_partners;
CREATE POLICY lab_partners_admin_update ON public.lab_partners FOR UPDATE TO authenticated
    USING (public.has_org_role(lab_organization_id, ARRAY['Admin']))
    WITH CHECK (public.has_org_role(lab_organization_id, ARRAY['Admin']));


DROP TRIGGER IF EXISTS work_order_partner_catalog_guard ON public.lab_work_orders;
CREATE TRIGGER work_order_partner_catalog_guard
BEFORE INSERT OR UPDATE OF nume_partener, lab_organization_id ON public.lab_work_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_work_order_partner_catalog();


-- Flowrise Supabase function: public.get_work_order_reference_data(p_lab_organization_id uuid)
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.get_work_order_reference_data(p_lab_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_role text := public.effective_lab_role(p_lab_organization_id);
    v_work_types jsonb;
    v_technicians jsonb := '[]'::jsonb;
    v_prices jsonb := '[]'::jsonb;
    v_partners jsonb := '[]'::jsonb;
begin
    if v_role is null then
        raise exception 'Access denied';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', wt.id,
                'tip_lucrare', wt.tip_lucrare,
                'active', wt.active,
                'billing_mode', wt.billing_mode
            )
            order by wt.tip_lucrare, wt.id
        ),
        '[]'::jsonb
    )
    into v_work_types
    from public.lab_work_types wt
    where wt.lab_organization_id = p_lab_organization_id
      and wt.active = true;

    if v_role in ('admin','manager','dashboard') then
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'username', p.username,
                    'display_name', p.display_name,
                    'technician_name', p.technician_name
                )
                order by coalesce(p.technician_name,p.display_name,p.username)
            ),
            '[]'::jsonb
        )
        into v_technicians
        from public.organization_memberships m
        join public.profiles p
          on p.id = m.user_id
        where m.organization_id = p_lab_organization_id
          and m.status = 'active'::public.membership_status
          and lower(m.role) = 'technician'
          and p.active = true;
    end if;

    if v_role in ('admin','manager') then
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', cp.id,
                    'contract', cp.contract,
                    'tip_lucrare', cp.tip_lucrare,
                    'pret', cp.pret
                )
                order by cp.contract, cp.tip_lucrare, cp.id
            ),
            '[]'::jsonb
        )
        into v_prices
        from public.lab_contract_work_prices cp
        where cp.lab_organization_id = p_lab_organization_id;
    end if;

    -- Doctors keep their account partner; do not disclose other clinic names.
    if v_role in ('admin','manager','technician','dashboard') then
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'active', p.active
        ) order by p.name), '[]'::jsonb)
        into v_partners
        from public.lab_partners p
        where p.lab_organization_id = p_lab_organization_id
          and (p.active or v_role = 'admin');
    end if;

    return jsonb_build_object(
        'role', v_role,
        'work_types', v_work_types,
        'technicians', v_technicians,
        'contract_prices', v_prices,
        'partners', v_partners
    );
end;
$function$
;

-- Security definer: True
-- Return type: jsonb
-- Identity arguments: p_lab_organization_id uuid


GRANT SELECT, INSERT, UPDATE ON public.lab_partners TO authenticated;
REVOKE ALL ON public.lab_partners FROM anon;
REVOKE DELETE ON public.lab_partners FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_work_order_partner_catalog() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
