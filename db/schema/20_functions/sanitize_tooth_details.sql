-- Remove obsolete clinical keys recursively, including the __case entry.
CREATE OR REPLACE FUNCTION public.sanitize_tooth_details(p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
    IF jsonb_typeof(p_details)='object' THEN
        SELECT coalesce(jsonb_object_agg(key,public.sanitize_tooth_details(value)),'{}'::jsonb)
        INTO v_result FROM jsonb_each(p_details)
        WHERE lower(key) NOT IN ('material','tip_lucrare','nr_elemente');
        RETURN v_result;
    ELSIF jsonb_typeof(p_details)='array' THEN
        SELECT coalesce(jsonb_agg(public.sanitize_tooth_details(value)),'[]'::jsonb)
        INTO v_result FROM jsonb_array_elements(p_details);
        RETURN v_result;
    END IF;
    RETURN p_details;
END; $$;
REVOKE ALL ON FUNCTION public.sanitize_tooth_details(jsonb) FROM public,authenticated;
