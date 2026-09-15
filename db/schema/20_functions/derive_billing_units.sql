CREATE OR REPLACE FUNCTION public.derive_billing_units(p_items jsonb,p_modes jsonb)
RETURNS TABLE(work_type text,billing_mode text,billing_scope text,tooth_number integer)
LANGUAGE plpgsql STABLE
SET search_path=public
AS $$
DECLARE
    v_bad text;
BEGIN
    IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array'
       OR jsonb_typeof(coalesce(p_modes,'[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'Items and billing modes must be JSON arrays';
    END IF;

    SELECT trim(item->>'work_type') INTO v_bad
    FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item
    WHERE trim(coalesce(item->>'work_type',''))=''
       OR coalesce((item->>'tooth_number')::integer,0) / 10 NOT BETWEEN 1 AND 4
       OR coalesce((item->>'tooth_number')::integer,0) % 10 NOT BETWEEN 1 AND 8
    LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Invalid billing item'; END IF;

    SELECT trim(item->>'work_type') INTO v_bad
    FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item
    LEFT JOIN LATERAL (
        SELECT mode.value
        FROM jsonb_array_elements(coalesce(p_modes,'[]'::jsonb)) WITH ORDINALITY mode(value,ordinality)
        WHERE lower(trim(mode.value->>'work_type'))=lower(trim(item->>'work_type'))
        ORDER BY mode.ordinality
        LIMIT 1
    ) matched ON true
    WHERE matched.value IS NULL
       OR coalesce(matched.value->>'billing_mode','') NOT IN ('per_tooth','per_arch','per_piece')
    LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Unknown billing mode for work type: %',v_bad; END IF;

    RETURN QUERY
    WITH resolved AS (
        SELECT trim(matched.value->>'work_type') AS resolved_type,
               matched.value->>'billing_mode' AS resolved_mode,
               (item->>'tooth_number')::integer AS resolved_tooth
        FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item
        CROSS JOIN LATERAL (
            SELECT mode.value
            FROM jsonb_array_elements(coalesce(p_modes,'[]'::jsonb)) WITH ORDINALITY mode(value,ordinality)
            WHERE lower(trim(mode.value->>'work_type'))=lower(trim(item->>'work_type'))
            ORDER BY mode.ordinality
            LIMIT 1
        ) matched
    )
    SELECT DISTINCT r.resolved_type,r.resolved_mode,
           CASE r.resolved_mode
               WHEN 'per_tooth' THEN 'tooth:' || r.resolved_tooth::text
               WHEN 'per_arch' THEN CASE WHEN r.resolved_tooth/10 IN (1,2) THEN 'arch:upper' ELSE 'arch:lower' END
               WHEN 'per_piece' THEN 'piece'
           END,
           CASE WHEN r.resolved_mode='per_tooth' THEN r.resolved_tooth ELSE NULL END
    FROM resolved r;
END;
$$;

REVOKE ALL ON FUNCTION public.derive_billing_units(jsonb,jsonb) FROM public,anon,authenticated;
