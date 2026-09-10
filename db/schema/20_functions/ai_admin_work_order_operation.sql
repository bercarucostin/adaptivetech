CREATE OR REPLACE FUNCTION public.ai_admin_work_order_operation(
    p_operation text,p_target jsonb,p_fields jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    v_lab uuid:=public.get_flowrise_lab_id(); v_op text:=lower(trim(p_operation));
    v_payload jsonb; v_result jsonb; v_ids jsonb;
BEGIN
    IF lower(coalesce(public.current_org_role(v_lab),''))<>'admin' THEN RAISE EXCEPTION 'Admin access required'; END IF;
    IF v_op='create' THEN
        v_payload:=jsonb_build_object('fields',p_fields);
    ELSE
        v_ids:=coalesce(p_target->'ids',jsonb_build_array(p_target->'id'));
        v_payload:=jsonb_build_object('ids',v_ids,'bulk_explicit',jsonb_array_length(v_ids)>1,'fields',p_fields);
    END IF;
    v_result:=public.ai_mutate_work_order(v_op,v_payload);
    IF NOT coalesce((v_result->>'ok')::boolean,false) THEN RAISE EXCEPTION '%',coalesce(v_result->>'error','Work Order operation failed'); END IF;
    RETURN v_result||jsonb_build_object('entity','work_order','operation',v_op);
END; $$;
REVOKE ALL ON FUNCTION public.ai_admin_work_order_operation(text,jsonb,jsonb) FROM public,authenticated;
