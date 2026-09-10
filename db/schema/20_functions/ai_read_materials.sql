CREATE OR REPLACE FUNCTION public.ai_read_materials()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lab uuid:=public.get_flowrise_lab_id(); v_role text:=public.effective_lab_role(v_lab); v_rows jsonb;
BEGIN
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'Materials access denied'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'ID',id,'Material',material,'Furnizor',furnizor,'UM',um,'Cantitate',cantitate,
        'Prag_Minim',prag_minim,'Observatii',observatii,'Ultima_Actualizare',ultima_actualizare
    ) order by material,id),'[]'::jsonb) INTO v_rows
    FROM public.lab_materials_inventory WHERE lab_organization_id=v_lab;
    RETURN v_rows;
END; $$;
REVOKE ALL ON FUNCTION public.ai_read_materials() FROM public;
GRANT EXECUTE ON FUNCTION public.ai_read_materials() TO authenticated;
