CREATE OR REPLACE FUNCTION public.adjust_material_quantity(
    p_lab_organization_id uuid,p_material_id bigint,p_mode text,p_value numeric,
    p_expected_quantity numeric DEFAULT NULL,p_request_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_role text:=public.effective_lab_role(p_lab_organization_id); v_mode text:=lower(trim(p_mode));
    v_material public.lab_materials_inventory%rowtype; v_new numeric(14,3);
    v_hash text; v_request public.ai_operation_requests%rowtype; v_result jsonb;
BEGIN
    IF v_role NOT IN ('admin','manager','technician') THEN RAISE EXCEPTION 'Material quantity update denied'; END IF;
    IF v_mode NOT IN ('set','add','subtract') THEN RAISE EXCEPTION 'Material mode must be set, add or subtract'; END IF;
    IF p_value IS NULL OR p_value<0 THEN RAISE EXCEPTION 'Quantity value must be zero or greater'; END IF;
    IF v_mode='set' AND nullif(trim(coalesce(p_request_key,'')),'') IS NOT NULL
       AND p_expected_quantity IS NULL THEN
        RAISE EXCEPTION 'Expected quantity is required for an idempotent set';
    END IF;

    IF nullif(trim(coalesce(p_request_key,'')),'') IS NOT NULL THEN
        v_hash:=md5(jsonb_build_object('material_id',p_material_id,'mode',v_mode,'value',p_value,'expected',p_expected_quantity)::text);
        INSERT INTO public.ai_operation_requests(lab_organization_id,request_key,requested_by_user_id,envelope_hash)
        VALUES(p_lab_organization_id,p_request_key,auth.uid(),v_hash) ON CONFLICT DO NOTHING;
        SELECT * INTO v_request FROM public.ai_operation_requests
        WHERE lab_organization_id=p_lab_organization_id AND request_key=p_request_key FOR UPDATE;
        IF v_request.requested_by_user_id<>auth.uid() THEN RAISE EXCEPTION 'Request key belongs to another user'; END IF;
        IF v_request.envelope_hash<>v_hash THEN RAISE EXCEPTION 'Request key was already used for another operation'; END IF;
        IF v_request.state='completed' THEN RETURN v_request.result; END IF;
    END IF;

    SELECT * INTO v_material FROM public.lab_materials_inventory
    WHERE lab_organization_id=p_lab_organization_id AND id=p_material_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material not found'; END IF;
    IF v_mode='set' AND p_expected_quantity IS NOT NULL AND v_material.cantitate<>p_expected_quantity THEN RAISE EXCEPTION 'Material quantity changed; reload before setting it'; END IF;
    v_new:=round(case v_mode when 'set' then p_value when 'add' then v_material.cantitate+p_value else v_material.cantitate-p_value end,3);
    IF v_new<0 THEN RAISE EXCEPTION 'Material quantity cannot become negative'; END IF;
    UPDATE public.lab_materials_inventory SET cantitate=v_new,ultima_actualizare=now(),
        updated_by_user_id=public.current_legacy_user_id(),updated_at=now()
    WHERE lab_organization_id=p_lab_organization_id AND id=p_material_id;
    v_result:=jsonb_build_object('ok',true,'entity','material','operation',v_mode,'material_id',p_material_id,
        'material',v_material.material,'unit',v_material.um,'old_quantity',v_material.cantitate,'new_quantity',v_new,'request_key',p_request_key);
    IF nullif(trim(coalesce(p_request_key,'')),'') IS NOT NULL THEN
        UPDATE public.ai_operation_requests SET state='completed',result=v_result,completed_at=now()
        WHERE lab_organization_id=p_lab_organization_id AND request_key=p_request_key;
    END IF;
    RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.adjust_material_quantity(uuid,bigint,text,numeric,numeric,text) FROM public;
GRANT EXECUTE ON FUNCTION public.adjust_material_quantity(uuid,bigint,text,numeric,numeric,text) TO authenticated;
