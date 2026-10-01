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
