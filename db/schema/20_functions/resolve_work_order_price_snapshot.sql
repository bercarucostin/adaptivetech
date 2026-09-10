CREATE OR REPLACE FUNCTION public.resolve_work_order_price_snapshot(
    p_lab uuid,
    p_partner text,
    p_contract text,
    p_work_type text,
    p_quantity numeric,
    p_discount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_price numeric;
    v_contract text;
    v_quantity numeric := greatest(coalesce(p_quantity, 0), 0);
    v_discount numeric := greatest(0, least(100, coalesce(p_discount, 0)));
BEGIN
    IF public.effective_lab_role(p_lab) NOT IN ('admin', 'manager', 'doctor', 'technician') THEN
        RAISE EXCEPTION 'Price resolution denied';
    END IF;

    SELECT cp.pret, cp.contract
      INTO v_price, v_contract
    FROM public.lab_contract_work_prices cp
    WHERE cp.lab_organization_id = p_lab
      AND lower(trim(cp.tip_lucrare)) = lower(trim(coalesce(p_work_type, '')))
      AND lower(trim(cp.contract)) IN (
          lower(trim(coalesce(p_contract, ''))),
          lower(trim(coalesce(p_partner, ''))),
          'general'
      )
    ORDER BY CASE
        WHEN lower(trim(cp.contract)) = lower(trim(coalesce(p_contract, ''))) THEN 0
        WHEN lower(trim(cp.contract)) = lower(trim(coalesce(p_partner, ''))) THEN 1
        ELSE 2
    END, cp.id
    LIMIT 1;

    RETURN jsonb_build_object(
        'unit_price', v_price,
        'list_price', CASE WHEN v_price IS NULL THEN NULL ELSE round(v_price * v_quantity, 2) END,
        'final_price', CASE WHEN v_price IS NULL THEN NULL ELSE round(v_price * v_quantity * (1 - v_discount / 100), 2) END,
        'matched_contract', v_contract,
        'price_source', CASE WHEN v_price IS NULL THEN 'missing' ELSE 'catalog' END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_work_order_price_snapshot(uuid,text,text,text,numeric,numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_work_order_price_snapshot(uuid,text,text,text,numeric,numeric) TO authenticated;
