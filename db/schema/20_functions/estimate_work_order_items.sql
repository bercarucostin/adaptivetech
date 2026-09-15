CREATE OR REPLACE FUNCTION public.estimate_work_order_items(
    p_lab_organization_id uuid,
    p_partner_name text,
    p_requested_contract text,
    p_items jsonb,
    p_discount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
    v_role text := public.effective_lab_role(p_lab_organization_id);
    v_partner text := nullif(trim(coalesce(p_partner_name,'')),'');
    v_requested text := coalesce(nullif(trim(coalesce(p_requested_contract,'')),''),'General');
    v_discount numeric := greatest(0,least(100,coalesce(p_discount,0)));
    v_modes jsonb;
    v_lines jsonb := '[]'::jsonb;
    v_element_count integer := 0;
    v_list numeric := 0;
    v_matched_all boolean := false;
BEGIN
    IF coalesce(v_role,'') NOT IN ('admin','manager','doctor') THEN
        RAISE EXCEPTION 'Price estimate access denied';
    END IF;
    IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'Items must be a JSON array';
    END IF;

    IF v_role='doctor' THEN
        SELECT nullif(trim(p.legacy_partner_name),'') INTO v_partner
        FROM public.profiles p
        WHERE p.id=auth.uid() AND p.active=true;
        IF v_partner IS NULL THEN RAISE EXCEPTION 'Doctor partner mapping is missing'; END IF;
        v_requested:=v_partner;
        v_discount:=0;
    ELSIF v_partner IS NULL THEN
        RAISE EXCEPTION 'Partner name is required';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'work_type',types.work_type,'billing_mode',types.billing_mode
    ) ORDER BY types.work_type),'[]'::jsonb)
    INTO v_modes
    FROM (
        SELECT DISTINCT ON (lower(trim(wt.tip_lucrare)))
               wt.tip_lucrare AS work_type,wt.billing_mode
        FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item
        JOIN public.lab_work_types wt
          ON wt.lab_organization_id=p_lab_organization_id AND wt.active=true
         AND lower(trim(wt.tip_lucrare))=lower(trim(item->>'work_type'))
        ORDER BY lower(trim(wt.tip_lucrare)),wt.id
    ) types;

    v_element_count:=jsonb_array_length(coalesce(p_items,'[]'::jsonb));

    WITH units AS (
        SELECT * FROM public.derive_billing_units(p_items,v_modes)
    ), resolved AS (
        SELECT unit.work_type,unit.billing_mode,unit.billing_scope,1::numeric AS quantity,
               coalesce(price.contract,'General') AS contract,
               coalesce(price.pret,0)::numeric AS unit_price,
               price.contract IS NOT NULL AS matched
        FROM units unit
        LEFT JOIN LATERAL (
            SELECT cp.contract,cp.pret
            FROM public.lab_contract_work_prices cp
            WHERE cp.lab_organization_id=p_lab_organization_id
              AND lower(trim(cp.tip_lucrare))=lower(trim(unit.work_type))
              AND lower(trim(cp.contract)) IN (
                  lower(coalesce(v_partner,'')),lower(v_requested),'general'
              )
            ORDER BY CASE
                WHEN lower(trim(cp.contract))=lower(coalesce(v_partner,'')) THEN 0
                WHEN lower(trim(cp.contract))=lower(v_requested) THEN 1
                ELSE 2
            END,cp.id
            LIMIT 1
        ) price ON true
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'work_type',work_type,'billing_mode',billing_mode,
               'billing_scope',billing_scope,'quantity',quantity,
               'contract',contract,'unit_price',unit_price,
               'subtotal',round(unit_price*quantity,2),'matched',matched
           ) ORDER BY work_type,billing_scope),'[]'::jsonb),
           coalesce(sum(round(unit_price*quantity,2)),0),
           coalesce(bool_and(matched),false)
    INTO v_lines,v_list,v_matched_all
    FROM resolved;

    RETURN jsonb_build_object(
        'lines',v_lines,'element_count',v_element_count,
        'billing_unit_count',coalesce((SELECT sum((line->>'quantity')::numeric)
            FROM jsonb_array_elements(v_lines) line),0),
        'list_price',round(v_list,2),'discount',v_discount,
        'final_price',round(v_list*(1-v_discount/100),2),
        'matched_all',v_matched_all,'partner_name',v_partner
    );
END;
$$;

REVOKE ALL ON FUNCTION public.estimate_work_order_items(uuid,text,text,jsonb,numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.estimate_work_order_items(uuid,text,text,jsonb,numeric) TO authenticated;
